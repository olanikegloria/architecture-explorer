import fs from "fs";
import path from "path";

export type GraphNode = {
  id: string;
  path: string;
  label: string;
  imports: string[];
};

export type GraphEdge = {
  from: string;
  to: string;
  kind: "import";
};

export type ImportGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  indexedAt: string;
  root: string;
};

const IMPORT_RE =
  /(?:import\s+(?:[\s\S]*?)\s+from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;
const EXT_CANDIDATES = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

function walk(dir: string, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function extractImports(source: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(IMPORT_RE.source, "g");
  while ((m = re.exec(source)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function resolveImport(fromFile: string, spec: string, root: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null; // skip packages
  const base = path.resolve(path.dirname(fromFile), spec);
  if (fs.existsSync(base) && fs.statSync(base).isFile()) {
    return path.relative(root, base).replace(/\\/g, "/");
  }
  for (const ext of EXT_CANDIDATES) {
    const candidate = base + ext;
    if (fs.existsSync(candidate)) {
      return path.relative(root, candidate).replace(/\\/g, "/");
    }
  }
  return path.relative(root, base).replace(/\\/g, "/");
}

export function parseRepo(root: string): ImportGraph {
  const absRoot = path.resolve(root);
  const files = walk(absRoot);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  for (const file of files) {
    const rel = path.relative(absRoot, file).replace(/\\/g, "/");
    nodeIds.add(rel);
    const source = fs.readFileSync(file, "utf8");
    const rawImports = extractImports(source);
    const resolved: string[] = [];
    for (const spec of rawImports) {
      const target = resolveImport(file, spec, absRoot);
      if (!target) continue;
      resolved.push(target);
      edges.push({ from: rel, to: target, kind: "import" });
      nodeIds.add(target);
    }
    nodes.push({
      id: rel,
      path: rel,
      label: path.basename(rel),
      imports: resolved,
    });
  }

  // Ensure edge targets that weren't source files still appear as nodes
  for (const id of nodeIds) {
    if (!nodes.find((n) => n.id === id)) {
      nodes.push({ id, path: id, label: path.basename(id), imports: [] });
    }
  }

  return {
    nodes,
    edges,
    indexedAt: new Date().toISOString(),
    root: absRoot,
  };
}

// CLI: node/tsx parser/index.ts [path]
if (require.main === module) {
  const target = process.argv[2] || path.join(__dirname, "..", "sample-repo");
  const graph = parseRepo(target);
  console.log(JSON.stringify(graph, null, 2));
}
