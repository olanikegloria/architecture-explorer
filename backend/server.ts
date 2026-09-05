import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { parseRepo, type ImportGraph, type GraphNode, type GraphEdge } from "../parser/index";
import { accounts, type AuthContext } from "./accounts";
import { groundedComplete } from "../ai/ollamaClient";

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

/** Grounded ask: refuse when no matching nodes; cite file paths only. */
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

  if (matchedNodes.length === 0) {
    return {
      answered: false,
      answer:
        "I cannot answer from the indexed graph - no matching nodes for your question.",
      citations: [] as string[],
      evidence: { nodes: [] as GraphNode[], edges: [] as GraphEdge[] },
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

/** Fan-in: how many import edges point at each file. */
export function computeHotspots(g: ImportGraph, limit = 10) {
  const fanIn = new Map<string, number>();
  for (const n of g.nodes) fanIn.set(n.path, 0);
  for (const e of g.edges) {
    fanIn.set(e.to, (fanIn.get(e.to) || 0) + 1);
  }
  return [...fanIn.entries()]
    .map(([path, fan_in]) => ({ path, fan_in }))
    .sort((a, b) => b.fan_in - a.fan_in || a.path.localeCompare(b.path))
    .slice(0, limit);
}

function layerOf(filePath: string): "ui" | "api" | "service" | "db" | "other" {
  const p = filePath.replace(/\\/g, "/").toLowerCase();
  if (/(^|\/)(app|pages|components)\//.test(p) || p.includes("/page.")) return "ui";
  if (/(^|\/)api\//.test(p)) return "api";
  if (/(^|\/)services?\//.test(p)) return "service";
  if (
    /(^|\/)(lib\/)?database/.test(p) ||
    /(^|\/)db\//.test(p) ||
    /database\.(ts|js|tsx|jsx)$/.test(p)
  ) {
    return "db";
  }
  return "other";
}

/** Heuristic UI → api → service → db path using sample-repo-style naming. */
export function traceFeature(feature: string, g: ImportGraph) {
  const tokens = feature
    .toLowerCase()
    .split(/[^a-z0-9_/.-]+/)
    .filter((w) => w.length > 1);

  const matchFeature = (p: string) => {
    const hay = p.toLowerCase();
    return tokens.length === 0 || tokens.some((t) => hay.includes(t));
  };

  const byLayer: Record<"ui" | "api" | "service" | "db", string[]> = {
    ui: [],
    api: [],
    service: [],
    db: [],
  };
  for (const n of g.nodes) {
    const layer = layerOf(n.path);
    if (layer === "other") continue;
    if (matchFeature(n.path) || matchFeature(n.label)) {
      byLayer[layer].push(n.path);
    }
  }

  // Prefer feature-matched nodes; fall back to any node in that layer so a chain can form.
  const pick = (layer: "ui" | "api" | "service" | "db") => {
    if (byLayer[layer].length) return byLayer[layer][0];
    const any = g.nodes.find((n) => layerOf(n.path) === layer);
    return any?.path || null;
  };

  const steps = [
    { layer: "ui" as const, path: pick("ui") },
    { layer: "api" as const, path: pick("api") },
    { layer: "service" as const, path: pick("service") },
    { layer: "db" as const, path: pick("db") },
  ].filter((s) => s.path);

  const pathStr = steps.map((s) => `${s.layer}:${s.path}`).join(" → ");
  const deterministic = steps.length
    ? `Heuristic feature trace for "${feature}":\n${pathStr}`
    : `No UI/api/service/db layers matched for feature "${feature}".`;

  return {
    feature,
    steps,
    path: pathStr,
    answer: deterministic,
    citations: steps.map((s) => s.path!).filter(Boolean),
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

  app.post("/ask", requireAuth, async (req: AuthedRequest, res) => {
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

    if (!result.answered || result.evidence.nodes.length === 0) {
      return res.json({
        question,
        ...result,
        ai_provider: "fallback",
        org_id: req.auth!.org_id,
      });
    }

    const evidence = [
      "MATCHED NODES:",
      ...result.evidence.nodes.map(
        (n) => `- ${n.path} imports=[${n.imports.join(", ")}]`
      ),
      "MATCHED EDGES:",
      ...result.evidence.edges
        .slice(0, 20)
        .map((e) => `- ${e.from} → ${e.to}`),
      "DETERMINISTIC SUMMARY:",
      result.answer,
    ].join("\n");

    const ai = await groundedComplete({
      task:
        "Answer the architecture question using ONLY the import-graph evidence. " +
        "Cite file paths that appear in evidence. If evidence is thin, say so.",
      evidence,
      question,
    });

    res.json({
      question,
      answered: true,
      answer: ai.ok && ai.text ? ai.text : result.answer,
      citations: result.citations,
      evidence: result.evidence,
      ai_provider: ai.provider,
      org_id: req.auth!.org_id,
    });
  });

  app.get("/hotspots", requireAuth, (_req, res) => {
    const g = loadGraph();
    if (!g) {
      return res.status(404).json({
        error: "Graph not indexed yet. POST /index first.",
      });
    }
    const limit = Math.min(50, Math.max(1, Number(_req.query.limit) || 10));
    res.json({
      hotspots: computeHotspots(g, limit),
      indexedAt: g.indexedAt,
    });
  });

  app.post("/trace", requireAuth, async (req: AuthedRequest, res) => {
    const g = loadGraph();
    if (!g) {
      return res.status(404).json({
        error: "Graph not indexed yet. POST /index first.",
      });
    }
    const feature = String(req.body?.feature || "").trim();
    if (!feature) {
      return res.status(400).json({ error: "feature is required" });
    }
    const traced = traceFeature(feature, g);
    let explanation = traced.answer;
    let ai_provider: "ollama" | "fallback" = "fallback";

    if (traced.steps.length > 0) {
      const evidence = [
        `FEATURE: ${feature}`,
        `HEURISTIC PATH: ${traced.path}`,
        "STEPS:",
        ...traced.steps.map((s) => `- ${s.layer}: ${s.path}`),
        "GRAPH EDGES (sample):",
        ...g.edges
          .filter((e) => traced.citations.includes(e.from) || traced.citations.includes(e.to))
          .slice(0, 15)
          .map((e) => `- ${e.from} → ${e.to}`),
      ].join("\n");

      const ai = await groundedComplete({
        task:
          "Explain this UI→api→service→db feature trace briefly. " +
          "Use only the listed files; do not invent layers or files.",
        evidence,
        question: `How does feature "${feature}" flow through the codebase?`,
      });
      if (ai.ok && ai.text) explanation = ai.text;
      ai_provider = ai.provider;
    }

    res.json({
      ...traced,
      explanation,
      ai_provider,
      org_id: req.auth!.org_id,
    });
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
  <title>Architecture Explorer - ask the graph, cite the files</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Source+Sans+3:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #f7f1e8; --panel: #fffaf4; --text: #1c1917; --muted: #78716c;
      --accent: #c45c26; --accent-hover: #a34a1c;
      --border: rgba(28,25,23,.1); --shadow: 0 10px 32px rgba(28,25,23,.06);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; font-family: "Source Sans 3", system-ui, sans-serif; color: var(--text);
      background: var(--bg);
      min-height: 100vh; -webkit-font-smoothing: antialiased;
    }
    .wrap { width: min(880px, calc(100% - 3rem)); margin: 0 auto; }
    nav {
      display: flex; align-items: center; justify-content: space-between;
      padding: 2rem 0 1.5rem; border-bottom: 1px solid var(--border);
    }
    .brand { font-family: "Fraunces", Georgia, serif; font-weight: 600; letter-spacing: -0.02em; font-size: 1.15rem; }
    .brand span { color: var(--accent); }
    .nav-links { display: flex; gap: 1.5rem; align-items: center; font-size: .9rem; }
    .nav-links a { text-decoration: none; color: var(--muted); }
    .nav-links a:hover { color: var(--accent); }
    .btn {
      display: inline-flex; text-decoration: none; border-radius: 999px; padding: .7rem 1.35rem;
      font-weight: 600; font-size: .9rem; border: 1px solid transparent;
      transition: background .15s ease, color .15s ease;
    }
    .btn-primary { background: var(--accent); color: #fffaf4; }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-ghost { background: transparent; border-color: var(--border); color: var(--text); }
    .btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
    .hero { padding: 5rem 0 4rem; }
    .product {
      font-size: .75rem; font-weight: 600; letter-spacing: .14em;
      text-transform: uppercase; color: var(--accent); margin-bottom: 1.25rem;
    }
    h1 {
      margin: 0 0 1.25rem; font-family: "Fraunces", Georgia, serif;
      font-size: clamp(2.4rem, 5.5vw, 3.6rem); line-height: 1.12;
      letter-spacing: -.03em; max-width: 16ch; font-weight: 600;
    }
    .lede { margin: 0 0 2rem; color: var(--muted); font-size: 1.15rem; line-height: 1.65; max-width: 40ch; }
    .cta-row { display: flex; flex-wrap: wrap; gap: .85rem; }
    .features {
      padding: 3rem 0 4.5rem; border-top: 1px solid var(--border);
      display: grid; gap: 2rem;
    }
    @media (min-width: 720px) { .features { grid-template-columns: repeat(3, 1fr); gap: 2.5rem; } }
    .feature {
      padding: 0; background: transparent; border: none; border-radius: 0;
    }
    .feature h3 {
      margin: 0 0 .65rem; font-family: "Fraunces", Georgia, serif;
      font-size: 1.15rem; font-weight: 600; color: var(--text);
    }
    .feature p { margin: 0; color: var(--muted); font-size: .95rem; line-height: 1.6; }
    footer {
      border-top: 1px solid var(--border); padding: 2rem 0 3rem; display: flex; flex-wrap: wrap;
      gap: 1rem; justify-content: space-between; color: var(--muted); font-size: .85rem;
    }
    footer a { color: var(--muted); text-decoration: none; }
    footer a:hover { color: var(--accent); }
  </style>
</head>
<body>
  <div class="wrap">
    <nav>
      <div class="brand">Architecture <span>Explorer</span></div>
      <div class="nav-links">
        <a href="#features">Features</a>
        <a href="/legal/terms">Terms</a>
        <a class="btn btn-primary" href="/app">Open app</a>
      </div>
    </nav>
    <header class="hero">
      <div class="product">Architecture Explorer</div>
      <h1>Ask the import graph. Cite the files - or refuse.</h1>
      <p class="lede">Index a TypeScript/JS repo into nodes and edges. Answers only from graph evidence, with file-path citations and explicit refusal when nothing matches.</p>
      <div class="cta-row">
        <a class="btn btn-primary" href="/app">Open app</a>
        <a class="btn btn-ghost" href="#features">See features</a>
      </div>
    </header>
    <section class="features" id="features">
      <div class="feature">
        <h3>Import graph</h3>
        <p>Parse a repo into nodes and edges so architecture questions start from real structure.</p>
      </div>
      <div class="feature">
        <h3>Cite or refuse</h3>
        <p>Answers only from graph matches - with file-path citations, or an explicit refusal.</p>
      </div>
      <div class="feature">
        <h3>Local eval</h3>
        <p>Use Bearer token <code>demo</code>, or sign up. Free local stack - no paid APIs.</p>
      </div>
    </section>
    <footer>
      <div>© 2026 Architecture Explorer</div>
      <div><a href="/legal/terms">Terms</a> · <a href="/legal/privacy">Privacy</a> · <a href="/app">App</a></div>
    </footer>
  </div>
</body>
</html>`;
}

function renderLegalTerms(): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Terms of Service - Architecture Explorer</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet"/>
<style>body{margin:0;font-family:"Source Sans 3",system-ui,sans-serif;background:#f7f1e8;color:#1c1917;line-height:1.55}
main{width:min(720px,calc(100% - 2rem));margin:2rem auto 3rem}a{color:#c45c26}h1{font-family:"Fraunces",Georgia,serif}.muted{color:#78716c;font-size:.9rem}</style>
</head><body><main>
<p><a href="/">← Architecture Explorer</a></p>
<h1>Terms of Service</h1>
<p class="muted">Stub - last updated September 5, 2026. Not legal advice.</p>
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
<title>Privacy Policy - Architecture Explorer</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet"/>
<style>body{margin:0;font-family:"Source Sans 3",system-ui,sans-serif;background:#f7f1e8;color:#1c1917;line-height:1.55}
main{width:min(720px,calc(100% - 2rem));margin:2rem auto 3rem}a{color:#c45c26}h1{font-family:"Fraunces",Georgia,serif}.muted{color:#78716c;font-size:.9rem}</style>
</head><body><main>
<p><a href="/">← Architecture Explorer</a></p>
<h1>Privacy Policy</h1>
<p class="muted">Stub - last updated September 5, 2026. Not legal advice.</p>
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
