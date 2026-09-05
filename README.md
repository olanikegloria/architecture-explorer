# Architecture Explorer

**Status:** SaaS foundation (auth, metering, commercial docs) on a runnable import-graph MVP  
**Folder:** `03-architecture-explorer`  
**Free-stack:** No paid APIs or LLM keys. Local auth + JSON store. Billing checkout is a stub that upgrades the plan in the local DB (set `STRIPE_SECRET_KEY` later for real Stripe).

Parse a sample TypeScript/JS repo into an import graph and answer architecture questions **only** with graph evidence + file-path citations (refuse when nothing matches).

---

## Path to selling

| Stage | What ships here | Next production step |
|-------|-----------------|----------------------|
| **1. Prove value** | Landing `/`, product `/app`, index + grounded ask | Index real monorepos from CI/checkout |
| **2. Capture account** | `POST /auth/signup` + `/auth/login` → API token; orgs in `data/accounts.json` | Managed Postgres + password reset |
| **3. Meter Free** | 100 asks/mo; **HTTP 402** on quota | Soft alerts + in-app upgrade CTA |
| **4. Take payment** | `POST /billing/checkout-session` stub (upgrades plan locally) | Real Stripe Checkout + webhooks |
| **5. Close Team/Business** | Pricing/Sales docs; seat+repo narrative | Enforce seats/repos; SSO for Business |

Commercial docs:

- [docs/PRICING.md](./docs/PRICING.md) — Free / Team ($69) / Business ($199)
- [docs/SALES.md](./docs/SALES.md) — ICP, demo script, objections

Legal stubs: `/legal/terms`, `/legal/privacy`

---

## What works

- Marketing landing at `/`; product UI at `/app`
- Regex-based import parser over `sample-repo/`
- Bearer-protected `/index`, `/graph`, `/ask` (`demo` token for local eval)
- Org signup/login; ask metering; checkout stub
- Grounded answers with citations; explicit refusal when no graph evidence

## Stack

| Layer | Choice |
|-------|--------|
| Parser / API + UI | TypeScript Express + HTML |
| Store | JSON under `data/` (`accounts.json`, `graph.json`) |
| Auth | PBKDF2 password hashes + opaque API tokens |
| Billing | Stub checkout (optional `STRIPE_SECRET_KEY` later) |
| Tests | Node test runner |

## Quick start (local)

```bash
cd 03-architecture-explorer
npm install
npm run dev
```

Open http://localhost:8003/ (landing) and http://localhost:8003/app (product).

### Commercial demo flow

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

curl -X POST http://localhost:8003/billing/checkout-session \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"plan":"team"}'
```

Free orgs that exceed **100 asks/month** receive **402**.

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
| GET | `/billing/usage` | Bearer | Plan + ask usage |
| POST | `/billing/checkout-session` | Bearer | Stub checkout; upgrades plan locally |
| POST | `/index` | Bearer | Index `sample-repo/` (or `{ "path": "..." }`) |
| GET | `/graph` | Bearer | Nodes/edges JSON |
| POST | `/ask` | Bearer | Graph-grounded answer; meters usage; 402 on Free limit |

Local eval: `Authorization: Bearer demo`

## Env

| Variable | Purpose |
|----------|---------|
| `DATA_DIR` | JSON persistence (default `./data`) |
| `PORT` | Default `8003` |
| `STRIPE_SECRET_KEY` | Optional; documented for live Checkout later |

## Layout

```text
parser/          Import graph extraction
backend/         Express API, accounts, landing HTML
frontend/        Product UI at /app
docs/            PRICING.md, SALES.md
sample-repo/     Fake login/auth/database files
tests/           Parser smoke tests
data/            accounts.json + graph.json after use
```

## Docs

- [PROPOSAL.md](./PROPOSAL.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [INTERVIEW.md](./INTERVIEW.md)
- [docs/PRICING.md](./docs/PRICING.md)
- [docs/SALES.md](./docs/SALES.md)
