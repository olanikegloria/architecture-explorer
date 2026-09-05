# Architecture — Architecture Explorer

**Status:** Planning. Subject to change after proposal review.

---

## System overview

```text
GitHub / local repo
      │
      ▼
Parser pipeline
  - files, imports, exports
  - routes / handlers heuristics
  - models / services naming heuristics
      │
      ▼
Graph store (nodes: file/symbol/route; edges: imports/calls)
      │
      ├── Visualisation UI (clickable nodes)
      └── Grounded Q&A
            retrieve subgraph + snippets
            LLM answers ONLY with citations
            refuse if evidence insufficient
```

---

## Core components

| Path | Role |
|------|------|
| `parser/` | Language-specific AST / import extraction |
| `backend/` | Index jobs, graph query API |
| `frontend/` | Interactive map, feature trace UI |
| `ai/` | Prompting, citation enforcement, refusal |
| `tests/` | Parser fixtures, graph correctness |

---

## Feature: Trace this feature (V2)

User selects a feature label (e.g. Checkout). System walks heuristically tagged nodes (UI → API → service → DB) and displays the path.

---

## Anti-hallucination rule

Every AI answer must include file paths present in the index. If retrieval confidence is low: *“I couldn’t find enough evidence in the analysed repository.”*

---

## Open questions

1. First languages: TypeScript + Python only?
2. Client-side vs server-side graph rendering limits?
