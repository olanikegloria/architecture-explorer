import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { parseRepo, type ImportGraph } from "../parser/index";
import { accounts, PLAN_PRICES, type AuthContext } from "./accounts";

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

  app.get("/billing/usage", requireAuth, (req: AuthedRequest, res) => {
    res.json(accounts.usageSnapshot(req.auth!.org_id));
  });

  app.post("/billing/checkout-session", requireAuth, (req: AuthedRequest, res) => {
    const plan = String(req.body?.plan || "team");
    if (plan !== "team" && plan !== "business") {
      res.status(400).json({ error: "plan must be team or business" });
      return;
    }
    const stripeKey = (process.env.STRIPE_SECRET_KEY || "").trim();
    const usage = accounts.setPlan(req.auth!.org_id, plan);
    const fakeSession = `cs_test_fake_${plan}_${req.auth!.org_id.slice(0, 8)}`;
    res.json({
      id: fakeSession,
      url: `https://checkout.stripe.com/c/pay/${fakeSession}`,
      mode: stripeKey ? "stripe_ready_stub" : "stub",
      plan,
      price_usd: PLAN_PRICES[plan],
      org_id: req.auth!.org_id,
      usage,
      stripe_configured: Boolean(stripeKey),
      message: stripeKey
        ? "STRIPE_SECRET_KEY detected — replace this handler with stripe.checkout.Session.create before live charges. Plan upgraded locally for demo continuity."
        : "Stub checkout: plan upgraded locally. Set STRIPE_SECRET_KEY when ready for real Stripe Checkout.",
      success_url: req.body?.success_url || "/app?checkout=success",
      cancel_url: req.body?.cancel_url || "/?checkout=cancel",
      env: {
        STRIPE_SECRET_KEY: "optional; required later for live Checkout",
        STRIPE_WEBHOOK_SECRET: "optional; invoice.paid → plan upgrade",
        STRIPE_PRICE_TEAM: "optional Price ID for Team ($69/mo)",
        STRIPE_PRICE_BUSINESS: "optional Price ID for Business ($199/mo)",
      },
    });
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
    const quota = accounts.checkAskQuota(req.auth!.org_id);
    if (!quota.allowed) {
      return res.status(402).json({
        error: "quota_exceeded",
        message: `Free tier limit of ${quota.asks_limit} asks/${quota.month} reached. Upgrade via POST /billing/checkout-session.`,
        plan: quota.plan,
        asks_used: quota.asks_used,
        asks_limit: quota.asks_limit,
        month: quota.month,
        upgrade: { team: "$69/mo", business: "$199/mo" },
      });
    }

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
    res.json({ question, ...result, org_id: req.auth!.org_id, plan: req.auth!.plan });
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
    .pricing { display: grid; gap: 1rem; }
    @media (min-width: 860px) { .pricing { grid-template-columns: repeat(3, 1fr); } }
    .plan {
      padding: 1.35rem 1.25rem; border: 1px solid var(--line); border-radius: 14px;
      background: rgba(255,255,255,.55); transition: transform .25s ease, border-color .25s;
    }
    .plan:hover { transform: translateY(-3px); border-color: rgba(42,95,143,.35); }
    .plan.featured { background: var(--steel); color: #f4f8fc; border-color: transparent; }
    .plan.featured p, .plan.featured li { color: rgba(244,248,252,.82); }
    .price { margin: .7rem 0 .85rem; font-size: 2rem; font-weight: 700; letter-spacing: -.04em; }
    .price small { font-size: .95rem; font-weight: 500; opacity: .75; }
    .plan ul { margin: 0 0 1.2rem; padding-left: 1.1rem; color: var(--muted); line-height: 1.55; font-size: .92rem; }
    .plan.featured .btn-primary { background: #f4f8fc; color: var(--steel-deep); }
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
        <a href="#pricing">Pricing</a>
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
          <a class="btn btn-ghost" href="#pricing">See pricing</a>
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
    <section class="block" id="pricing">
      <h2>Plans for onboarding and architecture reviews</h2>
      <p class="lede">Free proves grounded Q&amp;A. Team covers a squad exploring shared codebases. See docs/PRICING.md.</p>
      <div class="pricing">
        <article class="plan">
          <h3>Free</h3>
          <div class="price">$0</div>
          <ul>
            <li>1 seat · 1 repo</li>
            <li>100 asks / month</li>
            <li>Citations + refusal</li>
          </ul>
          <a class="btn btn-ghost" href="/app">Start free</a>
        </article>
        <article class="plan featured">
          <h3>Team</h3>
          <div class="price">$69 <small>/ mo</small></div>
          <ul>
            <li>Up to 10 seats · 5 repos</li>
            <li>5,000 asks / month</li>
            <li>Email support</li>
          </ul>
          <a class="btn btn-primary" href="/app">Choose Team</a>
        </article>
        <article class="plan">
          <h3>Business</h3>
          <div class="price">$199 <small>/ mo</small></div>
          <ul>
            <li>Up to 50 seats · 25 repos</li>
            <li>Unlimited asks (fair use)</li>
            <li>Priority support</li>
          </ul>
          <a class="btn btn-ghost" href="/app">Talk Business</a>
        </article>
      </div>
    </section>
    <footer>
      <div>© 2026 Architecture Explorer — free-stack SaaS foundation</div>
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
<p>Architecture Explorer (“Service”) indexes import graphs and answers architecture questions with citations for evaluation and commercial use.</p>
<h2>Accounts</h2>
<ul>
<li>You are responsible for credentials and API tokens issued to your organization.</li>
<li>Free, Team, and Business plans are subject to documented limits.</li>
</ul>
<h2>Billing</h2>
<p>Paid plans bill via Stripe when configured. Development builds may use stub checkout that upgrades the plan in the local store.</p>
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
<li><strong>Account data:</strong> email, password hash, organization name, plan, API tokens.</li>
<li><strong>Usage metering:</strong> ask counts per organization per calendar month.</li>
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
