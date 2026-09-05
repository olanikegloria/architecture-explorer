# Sales playbook — Architecture Explorer

---

## ICP (ideal customer profile)

| Dimension | Fit |
|-----------|-----|
| **Company** | 15–200 engineers; TypeScript/JS monorepos or multi-package apps |
| **Buyer** | Eng Manager, Staff+ architect, or DevEx lead owning onboarding time |
| **Champion** | IC who already draws import diagrams on whiteboards for new hires |
| **Trigger** | Hiring wave, large refactor, “tribal knowledge” incidents |
| **Anti-ICP** | Tiny single-file repos; orgs already deep in enterprise ADRs with no appetite for a focused graph layer |

**One sentence:** Teams that lose days answering “where does X start?” without inventing answers from an LLM.

---

## Pain

1. **Onboarding archaeology** — New hires grep and ask Slack; maps go stale.  
2. **LLM hallucination risk** — Generic chatbots invent modules and call chains.  
3. **Diagrams without questions** — Static graphs don’t answer “where does login auth start?”

Our wedge: **import graph first; answers only with citations; refuse when no evidence.**

---

## Demo script (12–15 minutes)

### 0. Setup

- Open landing `/` → **Open app** → `/app`  
- Bearer token: `demo`

### 1. Problem frame (2 min)

> “Most AI coding assistants will invent a payment webhook. We answer from the import graph — or we say we can’t.”

Show Free → Team pricing.

### 2. Index + grounded ask (5 min)

```bash
export TOKEN=demo
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8003/index -d '{}'

curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8003/ask \
  -d '{"question":"Where does login authentication start?"}'

curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8003/ask \
  -d '{"question":"How does the payment webhook work?"}'
```

Narrate citations on the first ask; refusal on the second.

### 3. Commercial motion (4 min)

```bash
curl -X POST http://localhost:8003/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"buyer@acme.dev","password":"demo-pass","org_name":"Acme Eng"}'

curl -X POST http://localhost:8003/billing/checkout-session \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"plan":"team"}'
```

Stub upgrades plan locally. Optionally burn Free quota until **402**.

### 4. Close

> “Team at $69/mo covers a squad and five repos — same grounded ask loop, with seats and quota that match onboarding reality.”

---

## Objection handling

| Objection | Response |
|-----------|----------|
| “We already have Sourcegraph / Cody.” | Complementary wedge: **strict graph grounding + refusal** as the trust story; start Free on one repo. |
| “Regex imports are incomplete.” | Honest MVP scope; still enough to demo citation/refusal. Deeper parsers are roadmap. |
| “$69 for a graph tool?” | You’re buying **onboarding time and fewer invented answers**, not pretty nodes. |

---

## Qualification questions

1. How long until a new hire can answer “where does auth start?” without Slack?  
2. Do you already use LLM chat on the codebase — what’s still wrong?  
3. Seat count for the squad that would ask weekly?
