import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { parseRepo } from "../parser/index";

test("parseRepo builds import edges for sample-repo", () => {
  const root = path.join(__dirname, "..", "sample-repo");
  const g = parseRepo(root);
  assert.ok(g.nodes.length >= 4);
  assert.ok(g.edges.length >= 3);
  const fromLogin = g.edges.filter((e) => e.from.includes("login"));
  assert.ok(fromLogin.length >= 1);
});
