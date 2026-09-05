# Architecture Explorer

**Status:** Phase 0 — planning only. Do not implement until proposal is accepted.  
**Folder:** `03-architecture-explorer`

---

## Problem

Large codebases are hard to understand. New engineers ask where authentication starts or what happens when a user creates an order — and answers are buried across files, imports, and tribal knowledge.

## Target users

Software engineers joining a codebase, staff engineers reviewing architecture, mentors onboarding juniors.

## Solution (intent)

Analyse a repository, build a dependency/feature graph (“Google Maps for a codebase”), and answer architecture questions **grounded in graph nodes and file references** — not free-form LLM guesses.

## Tech stack (planned)

- Frontend: Next.js + graph visualisation
- Parser: TypeScript compiler API + Python AST
- Backend: Node/TS and/or FastAPI for indexing APIs
- Store: PostgreSQL (+ optional graph projections)
- AI: Retrieval constrained to indexed graph + snippets; embeddings in V2

## Docs

- [PROPOSAL.md](./PROPOSAL.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [INTERVIEW.md](./INTERVIEW.md)

## Setup

Not runnable yet. Scaffold only.
