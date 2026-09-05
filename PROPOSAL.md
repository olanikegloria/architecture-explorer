# PROJECT PROPOSAL — 03 Architecture Explorer

**Status:** Awaiting review. Do not implement until accepted.  
**Working name:** Architecture Explorer  
**One-liner:** Google Maps for a codebase — graph from static analysis; AI answers only with file citations.

---

## PROBLEM

Understanding a large codebase is often harder than writing new code. Engineers ask:

- Where does authentication start?
- What happens when a user creates an order?
- Which modules depend on this service?

READMEs drift; diagrams rot; LLM chat without indexing invents architecture.

---

## TARGET USER

- Engineers onboarding to a repo
- Staff/senior engineers explaining systems
- Interviewers assessing system-design-from-code skill (as portfolio demo)

---

## WHY THEY CARE

Faster mental models reduce onboarding time and accidental breakage. Grounded answers beat hallucinated architecture blogs.

---

## EXISTING ALTERNATIVES

| Alternative | Strength | Gap |
|-------------|----------|-----|
| Sourcegraph, GitHub code search | Search / nav | Not always feature-trace visualisation |
| Dependency Cruiser, Madge, pydeps | Graphs | Limited Q&A productisation |
| Copilot/ChatGPT on repo | Fluent answers | Hallucination risk without graph grounding |
| Manual diagrams | Clear when fresh | Rot |

---

## OUR DIFFERENTIATOR

1. **Graph is the source of truth**; AI is constrained to retrieved subgraph + snippets.
2. **Feature trace** UX (“trace checkout”) as advanced mode.
3. Explicit **refusal** when evidence is insufficient.
4. Dual demonstration of **software engineering (parsers/graphs)** and **AI engineering (grounding)**.

---

## MVP

- Ingest a TS/JS and/or Python repo (start with one language if needed — recommend **TypeScript first**, Python second)
- Build import/module dependency graph
- Interactive visualisation (click node → file metadata)
- Q&A: “How does X work?” returns path + file references from index
- Refuse when retrieval is weak

**Non-goals:** Full call-graph for all languages, perfect runtime behaviour, editing code.

---

## V2

- “Trace this feature” heuristics (routes → services → DB)
- Embeddings over chunks for better retrieval
- Multi-language monorepo support
- Compare two commits’ architecture deltas

---

## V3

- Team annotations on nodes
- Security-sensitive path highlighting
- PR “architecture impact” summary

---

## TECH STACK

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | Next.js + graph lib (e.g. React Flow / Sigma — decide at build) | Interactive maps |
| Parser | TS Compiler API; Python `ast` | Real static analysis |
| Backend | Node/TS for TS graph; optional FastAPI for Python service | Fit parsers |
| DB | PostgreSQL | Nodes/edges + jobs |
| AI | Ollama + citation-enforcing prompts | Grounded Q&A |

---

## ARCHITECTURE

See [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## AI COMPONENT

- Answer only with retrieved nodes/snippets
- Mandatory file path citations
- No-answer behaviour when graph lacks coverage

Eval: citation precision, refusal correctness on unanswerable questions.

---

## SECURITY

- Private repo tokens handled like other projects
- Do not execute analysed code in MVP (parse only)
- Size limits on repos indexed

---

## SCALABILITY

| Scale | Plan |
|-------|------|
| 10 | Full graph in memory/Postgres for medium repos |
| 10k | Incremental indexing, graph sharding, async jobs |
| 1M | Distributed indexers; approximate visualisation; query federation |

---

## TESTING

- Parser fixtures with known graphs
- Graph query unit tests
- AI eval: answerable vs unanswerable sets
- UI smoke for large-graph performance caps

---

## DEPLOYMENT

- Docker Compose
- CI: lint, parser tests, build

---

## ESTIMATED COMPLEXITY

**High** — visualisation and grounding quality matter more than feature count.

---

## RISKS

| Risk | Mitigation |
|------|------------|
| Graph noise | Module-level graph first; symbols later |
| Language coverage | Explicit MVP languages |
| Hallucination | Hard citation requirement + refusal |
| Overlap with Sourcegraph story | Emphasise feature-trace + grounded Q&A pedagogy |

---

## ACCEPTANCE

- [ ] Language MVP choice approved (TS first recommended)
- [ ] Anti-hallucination bar approved
- [ ] **I accept this** / revise / cut
