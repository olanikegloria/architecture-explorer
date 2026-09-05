import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { parseRepo, type ImportGraph } from "../parser/index";

const app = express();
const PORT = Number(process.env.PORT || 8003);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const SAMPLE_REPO = path.join(PROJECT_ROOT, "sample-repo");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const GRAPH_PATH = path.join(DATA_DIR, "graph.json");

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(PROJECT_ROOT, "frontend")));

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

function answerFromGraph(question: string, g: ImportGraph) {
  const q = question.toLowerCase();
  const keywords = q
    .split(/[^a-z0-9_/.-]+/)
    .filter((w) => w.length > 2 && !["what", "where", "does", "the", "how", "when", "with", "from", "into", "about"].includes(w));

  const matchedNodes = g.nodes.filter((n) => {
    const hay = `${n.path} ${n.label} ${n.imports.join(" ")}`.toLowerCase();
    return keywords.some((k) => hay.includes(k));
  });

  // Also match edges when question mentions auth/login/database patterns
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

app.get("/health", (_req, res) => {
  res.json({ status: "ok", indexed: Boolean(loadGraph()) });
});

app.post("/index", (req, res) => {
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
  });
});

app.get("/graph", (_req, res) => {
  const g = loadGraph();
  if (!g) {
    return res.status(404).json({
      error: "Graph not indexed yet. POST /index first.",
    });
  }
  res.json(g);
});

app.post("/ask", (req, res) => {
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
  res.json({ question, ...answerFromGraph(question, g) });
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "frontend", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Architecture Explorer listening on http://localhost:${PORT}`);
});
