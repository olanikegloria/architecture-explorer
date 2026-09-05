# Architecture Explorer

**Status:** Runnable MVP scaffold  
**Folder:** `03-architecture-explorer`

Parse a sample TypeScript/JS repo into an import graph and answer architecture questions **only** with graph evidence + file-path citations.

---

## What works in this MVP

- Regex-based import parser over `sample-repo/`
- `POST /index` — index sample repo into nodes/edges
- `GET /graph` — return graph JSON
- `POST /ask` — grounded Q&A; refuses when no matching nodes; cites file paths
- HTML UI: graph list + ask box

## Stack

| Layer | Choice |
|-------|--------|
| Parser | Node + TypeScript (regex imports) |
| API + UI | Express + static HTML |
| Sample | `sample-repo/` (login → auth → database) |

## Quick start (local)

```bash
cd 03-architecture-explorer
npm install
npm run dev
```

Open http://localhost:8003/

```bash
# Index + graph
curl -X POST http://localhost:8003/index -H 'Content-Type: application/json' -d '{}'
curl http://localhost:8003/graph | head

# Ask (grounded)
curl -X POST http://localhost:8003/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"Where does login authentication start?"}'

# Refuse when no evidence
curl -X POST http://localhost:8003/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"How does the payment webhook work?"}'
```

Parser CLI only:

```bash
npm run parse
```

### Tests

```bash
npm test
```

## Docker

```bash
cd 03-architecture-explorer
docker compose up --build
```

UI/API: http://localhost:8003/

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Graph + ask UI |
| POST | `/index` | Index `sample-repo/` (or `{ "path": "..." }`) |
| GET | `/graph` | Nodes/edges JSON |
| POST | `/ask` | Graph-grounded answer with citations |
| GET | `/health` | Liveness |

## Layout

```text
parser/          Import graph extraction
backend/         Express API
frontend/        Minimal HTML UI
sample-repo/     Fake login/auth/database files
tests/           Parser smoke tests
data/            Written graph.json after /index
```

## Docs

- [PROPOSAL.md](./PROPOSAL.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [INTERVIEW.md](./INTERVIEW.md)
