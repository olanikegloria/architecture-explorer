# Pricing — Architecture Explorer

**Positioning:** Pay for seats and repos that need grounded architecture Q&A — not another diagram toy.

---

## Plans at a glance

| | **Free** | **Team** | **Business** |
|---|----------|----------|--------------|
| **Price** | $0 | **$69 / month** | **$199 / month** |
| **Seats** | 1 | Up to 10 | Up to 50 |
| **Repos** | 1 | Up to 5 | Up to 25 |
| **Asks / month** | 100 | 5,000 | Unlimited\* |
| **Citations + refusal** | Yes | Yes | Yes (product trust — never gated) |
| **API tokens** | 1 | Per seat | SSO-ready (roadmap) |
| **Support** | Community docs | Email (48h) | Priority |

\*Fair-use rate limits still apply on Business.

---

## Seat + repo narrative

### Free — prove grounded answers on one repo

One engineer, one repository, one hundred asks per month. Enough to index `sample-repo` (or a real tree), ask architecture questions, and see refusal when the graph has no evidence. When Free quota is hit, the API returns **HTTP 402**.

### Team ($69/mo) — onboarding / architecture review squad

Ten seats cover mentors and new hires exploring shared services. Five repos is typically “product monorepo + a few libraries.” Five thousand asks/month covers daily architecture questions without nickel-and-diming every click.

### Business ($199/mo) — multi-team understanding

Fifty seats and twenty-five repos fit a platform team serving product groups. Unlimited asks (fair use) removes quota anxiety during hiring waves and large refactors.

---

## What we meter today (MVP)

| Meter | Free limit | Notes |
|-------|------------|-------|
| `POST /ask` | **100 / calendar month / org** | Enforced; 402 when exceeded |
| Seats / repos | Soft limits in docs | Hard enforcement ships with billing webhooks |

Citations and refusal are **not** gated — they are the product trust story.

Auth required for product APIs (`/ask`, `/index`, `/graph`). Local demos may use Bearer token `demo`.

---

## Upgrade path

1. Sign up → Free org + API token  
2. Hit quota or need more seats/repos → `POST /billing/checkout-session`  
3. Stub upgrades plan in local DB; set `STRIPE_SECRET_KEY` later for live Checkout  

**Free-stack:** no paid APIs or LLM keys required.
