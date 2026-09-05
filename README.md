# Architecture Explorer

**Status:** Production-ready local product (auth + import-graph Q&A)  
**Folder:** `03-architecture-explorer`  
**Free-stack:** No paid APIs or LLM keys. Local auth + JSON store.

Parse a sample TypeScript/JS repo into an import graph and answer architecture questions **only** with graph evidence + file-path citations (refuse when nothing matches).

---

## What works

- Marketing landing at `/`; product UI at `/app`
- Regex-based import parser over `sample-repo/`
- Bearer-protected `/index`, `/graph`, `/ask` (`demo` token for local eval)
- Org signup/login with API tokens
- Grounded answers with citations; explicit refusal when no graph evidence

Legal stubs: `/legal/terms`, `/legal/privacy`

## Stack

| Layer | Choice |
|-------|--------|
| Parser / API + UI | TypeScript Express + HTML |
| Store | JSON under `data/` (`accounts.json`, `graph.json`) |
| Auth | PBKDF2 password hashes + opaque API tokens |
| Tests | Node test runner |

## Quick start (local)

```bash
cd 03-architecture-explorer
npm install
npm run dev
```

Open http://localhost:8003/ (landing) and http://localhost:8003/app (product).

```bash
export TOKEN=demo

curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8003/index -d '{}'

curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8003/ask \
  -d '{"question":"Where does login authentication start?"}'

# Refuse when no evidence
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8003/ask \
  -d '{"question":"How does the payment webhook work?"}'

curl -X POST http://localhost:8003/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"buyer@acme.dev","password":"demo-pass","org_name":"Acme Eng"}'
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

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | — | Marketing landing |
| GET | `/app` | — | Graph + ask UI |
| GET | `/legal/terms`, `/legal/privacy` | — | Legal stubs |
| GET | `/health` | — | Liveness |
| POST | `/auth/signup` | — | Create org + user + API token |
| POST | `/auth/login` | — | Return API token |
| GET | `/usage` | Bearer | Asks used this month |
| POST | `/index` | Bearer | Index `sample-repo/` (or `{ "path": "..." }`) |
| GET | `/graph` | Bearer | Nodes/edges JSON |
| POST | `/ask` | Bearer | Graph-grounded answer |

Local eval: `Authorization: Bearer demo`

## Env

| Variable | Purpose |
|----------|---------|
| `DATA_DIR` | JSON persistence (default `./data`) |
| `PORT` | Default `8003` |

## Layout

```text
parser/          Import graph extraction
backend/         Express API, accounts, landing HTML
frontend/        Product UI at /app
sample-repo/     Fake login/auth/database files
tests/           Parser smoke tests
data/            accounts.json + graph.json after use
```

## Docs

- [PROPOSAL.md](./PROPOSAL.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [INTERVIEW.md](./INTERVIEW.md)
