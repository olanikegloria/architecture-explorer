import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { parseRepo, type ImportGraph } from "../parser/index";
import { accounts, type AuthContext } from "./accounts";

const PORT = Number(process.env.PORT || 8003);
const PROJECT_ROOT = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : path.resolve(__dirname, "..");
const SAMPLE_REPO = path.join(PROJECT_ROOT, "sample-repo");
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(PROJECT_ROOT, "data");
const GRAPH_PATH = path.join(DATA_DIR, "graph.json");

type AuthedRequest = Request & { auth?: AuthContext };

let graph: ImportGraph | null = null;

function loadGraph(): ImportGraph | null {
  if (graph) return graph;
  if (fs.existsSync(GRAPH_PATH)) {
    graph = JSON.parse(fs.readFileSync(GRAPH_PATH, "utf8"));
    return graph;
  }
  return null;
}

function saveGraph(g: ImportGraph) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(GRAPH_PATH, JSON.stringify(g, null, 2));
  graph = g;
}

/** Grounded ask: refuse when no matching nodes/edges; cite file paths only. */
export function answerFromGraph(question: string, g: ImportGraph) {
  const q = question.toLowerCase();
  const keywords = q
    .split(/[^a-z0-9_/.-]+/)
    .filter(
      (w) =>
        w.length > 2 &&
        !["what", "where", "does", "the", "how", "when", "with", "from", "into", "about"].includes(w)
    );

  const matchedNodes = g.nodes.filter((n) => {
    const hay = `${n.path} ${n.label} ${n.imports.join(" ")}`.toLowerCase();
    return keywords.some((k) => hay.includes(k));
  });

  const matchedEdges = g.edges.filter((e) => {
    const hay = `${e.from} ${e.to}`.toLowerCase();
    return keywords.some((k) => hay.includes(k));
  });

  if (matchedNodes.length === 0 && matchedEdges.length === 0) {
    return {
      answered: false,
      answer:
        "I cannot answer from the indexed graph — no matching nodes or edges for your question.",
      citations: [] as string[],
      evidence: { nodes: [], edges: [] },
    };
  }

  const citations = [
    ...new Set([
      ...matchedNodes.map((n) => n.path),
      ...matchedEdges.flatMap((e) => [e.from, e.to]),
    ]),
  ];

  const importLines = matchedNodes
    .filter((n) => n.imports.length)
    .map((n) => `- ${n.path} imports: ${n.imports.join(", ")}`)
    .join("\n");

  const edgeLines = matchedEdges
    .slice(0, 12)
    .map((e) => `- ${e.from} → ${e.to}`)
    .join("\n");

  const answer = [
    `Grounded answer from import graph (${matchedNodes.length} nodes, ${matchedEdges.length} edges):`,
    "",
    "Relevant files:",
    ...citations.map((c) => `- ${c}`),
    "",
    importLines ? `Imports:\n${importLines}` : "",
    edgeLines ? `\nEdges:\n${edgeLines}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    answered: true,
    answer,
    citations,
    evidence: { nodes: matchedNodes, edges: matchedEdges },
  };
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  const ctx = accounts.resolveToken(token);
  if (!ctx) {
    res.status(401).json({
      error: "Missing or invalid Bearer token. Sign up/login or use demo token 'demo'.",
    });
    return;
  }
  req.auth = ctx;
  next();
}

export function createApp() {
  accounts.load();
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      indexed: Boolean(loadGraph()),
      product: "architecture-explorer",
    });
  });

  app.post("/auth/signup", (req, res) => {
    try {
      const { email, password, org_name } = req.body || {};
      res.json(
        accounts.signup(String(email || ""), String(password || ""), String(org_name || ""))
      );
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post("/auth/login", (req, res) => {
    try {
      const { email, password } = req.body || {};
      res.json(accounts.login(String(email || ""), String(password || "")));
    } catch (err) {
      res.status(401).json({ error: (err as Error).message });
    }
  });

  app.get("/usage", requireAuth, (req: AuthedRequest, res) => {
    res.json(accounts.usageSnapshot(req.auth!.org_id));
  });

  app.post("/index", requireAuth, (req: AuthedRequest, res) => {
    const root = (req.body?.path as string) || SAMPLE_REPO;
    const abs = path.resolve(root);
    if (!fs.existsSync(abs)) {
      return res.status(400).json({ error: `Path not found: ${abs}` });
    }
    const g = parseRepo(abs);
    saveGraph(g);
    res.json({
      ok: true,
      root: abs,
      nodes: g.nodes.length,
      edges: g.edges.length,
      indexedAt: g.indexedAt,
      org_id: req.auth!.org_id,
    });
  });

  app.get("/graph", requireAuth, (_req, res) => {
    const g = loadGraph();
    if (!g) {
      return res.status(404).json({
        error: "Graph not indexed yet. POST /index first.",
      });
    }
    res.json(g);
  });

  app.post("/ask", requireAuth, (req: AuthedRequest, res) => {
    const g = loadGraph();
    if (!g) {
      return res.status(404).json({
        error: "Graph not indexed yet. POST /index first.",
      });
    }
    const question = String(req.body?.question || "").trim();
    if (!question) {
      return res.status(400).json({ error: "question is required" });
    }
    const result = answerFromGraph(question, g);
    accounts.recordAsk(req.auth!.org_id);
    res.json({ question, ...result, org_id: req.auth!.org_id });
  });

  app.get("/", (_req, res) => {
    res.type("html").send(renderLanding());
  });

  app.get("/app", (_req, res) => {
    res.sendFile(path.join(PROJECT_ROOT, "frontend", "index.html"));
  });

  app.get("/legal/terms", (_req, res) => {
    res.type("html").send(renderLegalTerms());
  });

  app.get("/legal/privacy", (_req, res) => {
    res.type("html").send(renderLegalPrivacy());
  });

  return app;
}

function renderLanding(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Architecture Explorer — ask the graph, cite the files</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --ink: #0f1419; --paper: #eef2f7; --steel: #2a5f8f; --steel-deep: #163a5c;
      --signal: #c45c26; --line: rgba(15,20,25,.12); --muted: #5a6a7a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; font-family: "IBM Plex Sans", system-ui, sans-serif; color: var(--ink);
      background:
        radial-gradient(1100px 560px at 80% -10%, rgba(42,95,143,.18), transparent 55%),
        radial-gradient(800px 420px at -8% 40%, rgba(196,92,38,.08), transparent 50%),
        linear-gradient(180deg, #f4f7fb 0%, var(--paper) 45%, #e4ebf3 100%);
      min-height: 100vh;
    }
    .wrap { width: min(1100px, calc(100% - 2.5rem)); margin: 0 auto; }
    nav { display: flex; align-items: center; justify-content: space-between; padding: 1.25rem 0; }
    .brand { font-weight: 700; letter-spacing: -0.03em; }
    .brand span { color: var(--steel); }
    .nav-links { display: flex; gap: 1.25rem; align-items: center; font-size: .92rem; }
    .nav-links a { text-decoration: none; color: var(--muted); }
    .btn {
      display: inline-flex; text-decoration: none; border-radius: 8px; padding: .7rem 1.15rem;
      font-weight: 600; border: 1px solid transparent; transition: transform .2s ease;
    }
    .btn:hover { transform: translateY(-1px); }
    .btn-primary { background: var(--steel); color: #f4f8fc; }
    .btn-primary:hover { background: var(--steel-deep); }
    .btn-ghost { background: transparent; border-color: var(--line); color: var(--ink); }
    .hero { padding: 3rem 0 4rem; display: grid; gap: 2rem; align-items: end; }
    @media (min-width: 900px) {
      .hero { grid-template-columns: 1.05fr .95fr; min-height: calc(100vh - 5.5rem); padding-top: 2rem; }
    }
    .product { font-size: .8rem; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--steel); }
    h1 {
      margin: .35rem 0 .85rem; font-size: clamp(2.3rem, 5vw, 3.4rem); line-height: 1.05;
      letter-spacing: -.045em; max-width: 13ch;
    }
    .hero p { margin: 0 0 1.5rem; color: var(--muted); font-size: 1.08rem; line-height: 1.55; max-width: 38ch; }
    .cta-row { display: flex; flex-wrap: wrap; gap: .75rem; }
    .hero-visual {
      min-height: 300px; border-radius: 18px; overflow: hidden; color: #e7ecf3;
      background: linear-gradient(145deg, #163a5c 0%, #2a5f8f 45%, #0f1419 100%);
      box-shadow: 0 28px 56px rgba(22,58,92,.28); animation: rise .9s ease both;
    }
    .terminal { padding: 1.4rem; font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: .78rem; line-height: 1.55; }
    .dim { color: rgba(231,236,243,.55); } .hi { color: #f0c27a; } .ok { color: #7ddeb0; } .warn { color: #ffb070; }
    @keyframes rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
    @keyframes fadeup { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
    .hero-copy { animation: fadeup .7s ease both; }
    section.block { padding: 3.5rem 0; border-top: 1px solid var(--line); }
    section.block h2 { margin: 0 0 .6rem; font-size: clamp(1.55rem, 3vw, 2rem); letter-spacing: -.03em; }
    .lede { margin: 0 0 1.75rem; color: var(--muted); max-width: 48ch; line-height: 1.5; }
    .split { display: grid; gap: 1.25rem; }
    @media (min-width: 800px) { .split { grid-template-columns: 1fr 1fr; } }
    .point h3 { margin: 0 0 .4rem; font-size: 1.05rem; }
    .point p { margin: 0; color: var(--muted); line-height: 1.5; }
    footer {
      border-top: 1px solid var(--line); padding: 1.5rem 0 2.5rem; display: flex; flex-wrap: wrap;
      gap: 1rem; justify-content: space-between; color: var(--muted); font-size: .88rem;
    }
    footer a { color: var(--muted); }
  </style>
</head>
<body>
  <div class="wrap">
    <nav>
      <div class="brand">Architecture <span>Explorer</span></div>
      <div class="nav-links">
        <a href="#product">Product</a>
        <a href="/legal/terms">Terms</a>
        <a class="btn btn-primary" href="/app">Open app</a>
      </div>
    </nav>
    <header class="hero">
      <div class="hero-copy">
        <div class="product">Architecture Explorer</div>
        <h1>Ask the import graph. Cite the files — or refuse.</h1>
        <p>Index a TypeScript/JS repo into nodes and edges. Answers only from graph evidence, with file-path citations and explicit refusal when nothing matches.</p>
        <div class="cta-row">
          <a class="btn btn-primary" href="/app">Try the product</a>
          <a class="btn btn-ghost" href="#product">How it works</a>
        </div>
      </div>
      <div class="hero-visual" aria-hidden="true">
        <div class="terminal">
          <div class="dim">$ POST /ask</div>
          <div class="ok">answered: true</div>
          <div>citations: <span class="hi">app/login/page.tsx</span></div>
          <div class="dim">→ services/auth.ts → lib/database.ts</div>
          <div class="warn">no evidence → refuse (never invent)</div>
        </div>
      </div>
    </header>
    <section class="block" id="product">
      <h2>Index → ask → cite or refuse</h2>
      <p class="lede">Built for onboarding and architecture reviews. Local free stack — orgs, API tokens, and graph-grounded answers with no paid APIs.</p>
      <div class="split">
        <div class="point">
          <h3>Import graph evidence</h3>
          <p>Parse a repo into nodes and edges, then answer only from matches — with file-path citations.</p>
        </div>
        <div class="point">
          <h3>Local eval in minutes</h3>
          <p>Use Bearer token <code>demo</code>, or sign up. Refuse when the graph has no evidence.</p>
        </div>
      </div>
    </section>
    <footer>
      <div>© 2026 Architecture Explorer — local production-ready product</div>
      <div><a href="/legal/terms">Terms</a> · <a href="/legal/privacy">Privacy</a> · <a href="/app">App</a></div>
    </footer>
  </div>
</body>
</html>`;
}

function renderLegalTerms(): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Terms of Service — Architecture Explorer</title>
<style>body{margin:0;font-family:"IBM Plex Sans",system-ui,sans-serif;background:#eef2f7;color:#0f1419;line-height:1.55}
main{width:min(720px,calc(100% - 2rem));margin:2rem auto 3rem}a{color:#2a5f8f}.muted{color:#5a6a7a;font-size:.9rem}</style>
</head><body><main>
<p><a href="/">← Architecture Explorer</a></p>
<h1>Terms of Service</h1>
<p class="muted">Stub — last updated September 5, 2026. Not legal advice.</p>
<p>Architecture Explorer (“Service”) indexes import graphs and answers architecture questions with citations for evaluation and local use.</p>
<h2>Accounts</h2>
<ul>
<li>You are responsible for credentials and API tokens issued to your organization.</li>
<li>Abuse or unlawful use is prohibited.</li>
</ul>
<h2>Disclaimer</h2>
<p>The Service is provided “as is.” Graph-grounded answers assist understanding; refusal when evidence is missing does not guarantee completeness of the index.</p>
</main></body></html>`;
}

function renderLegalPrivacy(): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Privacy Policy — Architecture Explorer</title>
<style>body{margin:0;font-family:"IBM Plex Sans",system-ui,sans-serif;background:#eef2f7;color:#0f1419;line-height:1.55}
main{width:min(720px,calc(100% - 2rem));margin:2rem auto 3rem}a{color:#2a5f8f}.muted{color:#5a6a7a;font-size:.9rem}</style>
</head><body><main>
<p><a href="/">← Architecture Explorer</a></p>
<h1>Privacy Policy</h1>
<p class="muted">Stub — last updated September 5, 2026. Not legal advice.</p>
<h2>Data we store</h2>
<ul>
<li><strong>Account data:</strong> email, password hash, organization name, API tokens.</li>
<li><strong>Usage:</strong> ask counts per organization per calendar month.</li>
<li><strong>Graph data:</strong> indexed import nodes/edges from repositories you index.</li>
</ul>
<h2>Storage</h2>
<p>Local deployments persist JSON under <code>DATA_DIR</code> (for example <code>data/accounts.json</code>, <code>data/graph.json</code>). The demo Bearer token <code>demo</code> is for local evaluation only.</p>
</main></body></html>`;
}

const app = createApp();
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Architecture Explorer listening on http://localhost:${PORT}`);
  });
}

export { app };
