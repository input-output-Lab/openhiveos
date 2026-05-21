# Architecture Review — ARCH-015: LLM Usage Tracking in OpenHiveOS

**Date:** 2026-05-21
**Project:** openhiveos
**Facilitator:** Elizabeth
**Primary Voice:** Silas
**Topic:** LLM Usage Tracking — write path, schema, and Dashboard surface

---

## Attendees

| Seat | Agent | Role |
|---|---|---|
| PM / Facilitator | Elizabeth | Business constraints, final call |
| Systems Architect | Silas | Options proposal, decision matrix |
| Backend | Murphy | Implementation feasibility, API impact |
| Frontend / UI | Rocket | Dashboard component, UX |
| DevOps / Infra | Cooper | Deployment, env vars, operational risk |
| Documentation | Clarence | Runbook, API docs, SOP impact |
| Cross-project | Nova | Bridge registry, cross-squad patterns |
| Security | Locksmith | OWASP review — binding, last voice |

---

## Problem Statement

OpenHiveOS hosts agents whose LLM token consumption must be visible in the Dashboard. Without usage data, operators cannot understand cost per agent, cost per project, or cost per task. The opensquad-mcp-server already has a proven tracking schema (migrations 025+026: `llm_usage`, three analytical views). The question: how does usage data get into the OpenHiveOS database, and where does the write path live?

---

## Constraints

**Business:**
- OpenHiveOS must be standalone-deployable — no runtime dependency on opensquad-mcp-server permitted
- Usage data must be visible in the Dashboard within v0.2 scope
- Implementation fits Sprint 3 alongside ARCH-014 delivery tasks

**Technical:**
- ARCH-012 (decided): squad-api uses `openhiveos_reader` SELECT-only DB role — cannot write
- ARCH-008 (decided): Zod config mediates all env access; any new credentials must go through it
- ARCH-008 Decision 1: StdioServerTransport is the sole MCP transport — no HTTP MCP surface
- The opensquad schema is proven — do not reinvent it from scratch
- `report_usage` in opensquad is called by the Telegram Bridge after each loop (fire-and-forget)

**Out of scope:**
- Billing or invoicing
- Cross-project usage aggregation
- Alerting on cost spikes (v0.3)

---

## Options Considered

### Option A — Native Schema + `report_usage` MCP Utility (Bridge Dual-Call)

Port `005_llm_usage.sql` into OpenHiveOS. Implement `src/utilities/report-usage.ts` mirroring opensquad's Zod schema and insert logic. Bridge dual-calls both MCP servers after each loop.

- **Effort:** Medium (~13–14h estimated)
- **Platform fit:** Aligns with primitives pattern — then Cooper identified the stdio incompatibility
- **Risk:** Bridge cannot call stdio-transport MCP tools externally. The MCP server is a local stdio process. Wrapping it in an HTTP adapter on the health server creates an unauthenticated proxy. Additionally: `report_usage` as an MCP tool is accessible to any authenticated agent — OWASP A01 unscoped write surface.
- **Status:** BLOCKED — Cooper (infrastructure block, permanent) + Locksmith (OWASP A01, permanent)

### Option B — Native Schema + Backfill Cron (Pull from opensquad)

Same migration. Cron utility `sync-llm-usage.ts` pulls aggregated data from opensquad squad-api every 15 minutes. No Bridge changes.

- **Effort:** Medium (~14–15h estimated; Murphy revised to ~20h honest)
- **Platform fit:** Aligns with existing utilities pattern, but pull semantics are architecturally backwards
- **Risk (Locksmith — three simultaneous OWASP violations):**
  - OWASP A02:2021: Cross-system outbound credential with no defined scope
  - OWASP A10:2021: `OPENSQUAD_SQUAD_API_URL` operator-supplied URL = textbook SSRF vector
  - OWASP A09:2021: Silent cron failure = zero audit trail
- **Status:** BLOCKED OUTRIGHT — all three violations independently disqualifying; every remediation path transforms B into C

### Option C — Native Schema + `POST /internal/usage` Ingestion Endpoint on squad-api

Same migration. `POST /internal/usage` mounted on squad-api (not the health server) authenticated by `OPENHIVEOS_INGESTION_TOKEN` scoped bearer token. Bridge POSTs directly after each loop. squad-api reads views via `openhiveos_reader`.

- **Effort:** Medium (~15–17h; Cooper's recommended routing saves 2–3h vs. health-server variant)
- **Platform fit:** squad-api already exists (ARCH-012); router is additive. Minimal new infrastructure.
- **Status:** CONDITIONALLY APPROVED — 10 SEC conditions (Locksmith)

---

## Decision Matrix

| Option | Effort | Platform Fit | Security Risk | Ops Complexity | Test Complexity | Result |
|---|---|---|---|---|---|---|
| **A** (MCP Utility) | Medium | Breaks stdio constraint | OWASP A01 (unscoped write) | Low (no new infra) | Medium | **BLOCKED** |
| **B** (Backfill Cron) | Medium-High | Pull semantics; cross-system URL coupling | OWASP A02 + A09 + A10 | High (silent failure, stale data) | High (cron + sync correctness) | **BLOCKED OUTRIGHT** |
| **C** (HTTP Ingestion) | Medium | Additive to squad-api; push semantics correct | Approved with 10 SEC conditions | Low (no new containers) | Medium (ingestion route + views) | **SELECTED** |

---

## Decision

**Chosen: Option C**

`POST /internal/usage` on squad-api with `OPENHIVEOS_INGESTION_TOKEN` scoped bearer token. Migration `005_llm_usage.sql` (or `006` — OQ-1). Bridge POSTs fire-and-forget after each loop, parallel to opensquad `report_usage` call. squad-api exposes `GET /usage/agents`, `GET /usage/agents/:name`, `GET /usage/tasks/:id` from analytical views. Dashboard `UsageView`: 6-column MVP table. Feature dark until Bridge deploys (T-01 spike).

Option A is permanently blocked — two independent structural reasons. Option B is permanently blocked — three OWASP class violations with no viable remediation short of becoming Option C. The panel reached unanimous consensus on Option C. No disagreement between seats on the final call.

**One notable tension resolved in review:** Silas initially recommended Option A as primary and B as fallback. Cooper's finding that stdio-transport MCP cannot be externally addressed changed the picture — Option A does not exist as a viable option in the current transport model. Clarence preferred Option B on documentability grounds; Locksmith's triple-violation ruling closed that path. Both positions were acknowledged and correctly subordinated to the security ruling.

---

## Seat Inputs Summary

### Murphy (Backend)
Option A preferred initially. Critical implementation notes for whichever option is chosen:
- session_id Zod regex must mirror opensquad exactly: `/^[a-z][a-z0-9_-]*:[^:]+:\d{13}$/`
- `UNIQUE (session_id, loop_index)` required — prevents double-insert on retry
- `llm_model_pricing` table should NOT be ported — dead code in Option C
- File goes in `src/utilities/`, not `src/primitives/` (tier discipline via ESLint)
- Migration number TBD — must confirm sequence after 003/004 slots are verified

### Rocket (Frontend)
Options A and C are frontend-equivalent. MVP `UsageView`: 6-column table (Agent, Model, Provider, Prompt Tokens, Completion Tokens, Cost USD), sorted by cost descending, 4 decimal places on USD. Empty state: "No usage data yet. Usage data appears here after Bridge connects." Option B requires an additional staleness indicator — additional UX complexity for no data-quality benefit.

### Cooper (Infra)
**Decisive finding:** Option A collapses — the OpenHiveOS MCP server uses stdio transport. Bridge cannot call stdio tools externally. Every viable Option A integration path creates a new auth surface equivalent to or worse than Option C. Option B rejected: pull semantics wrong, silent failure mode, cross-system URL dependency. Option C recommended: `POST /internal/usage` on squad-api, `OPENHIVEOS_INGESTION_TOKEN` scoped and explicit. PRE-A1 (migrate gate fix) confirmed as hard gate for this migration as well. Feature provisioning is not gated on Bridge deployment — migration + endpoint can ship now; data flows when Bridge deploys.

New `.env.example` entries for Option C:
```bash
# LLM Usage Ingestion Token — authorizes Bridge to POST usage data
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
OPENHIVEOS_INGESTION_TOKEN=

# Bridge-reachable URL for squad-api ingestion endpoint
OPENHIVEOS_INGESTION_URL=
```

### Nova (Cross-project)
**Bridge is shared platform infrastructure — changes to it affect all squads.** T-01 spike (live OpenRouter cost field not verified) blocks Options A and C from being operationally live. Option B is the only option with zero Bridge exposure — but Locksmith's ruling closes it on security grounds. Key flags: (1) Option A dual-call without a Bridge usage-reporting registry design creates a fragile standard — next MCP server will handle it differently; (2) Option C + HTTP endpoint is the correct direction but requires formalising the registry design before a third MCP server connects; (3) Registry design deferred to Sprint 5+ (Silas). T-01 must close before Bridge connects to OpenHiveOS regardless of option.

### Clarence (Documentation)
Option B was most documentable given pre-review ambiguities. However, Cooper and Locksmith resolved those ambiguities definitively — Option C, once scoped, requires only: one new env var pair documented, `openapi.yaml` update for `POST /internal/usage` + three `GET /usage` routes, and a token rotation procedure in the operator runbook (SEC-C10). These are concrete, writeable, not speculative. Token lifecycle documentation is the highest documentation risk for Option C — the runbook must include rotation procedure before sprint closes.

### Locksmith (Security — Binding)

**Option A: BLOCKED** — OWASP A01:2021 (stdio incompatibility forces unscoped HTTP surface; Cooper confirmed no safe adapter exists on health server). Permanent structural block.

**Option B: BLOCKED OUTRIGHT** — OWASP A02:2021 (cross-system credential), OWASP A10:2021 (SSRF on `OPENSQUAD_SQUAD_API_URL`), OWASP A09:2021 (silent cron failure = zero audit trail). Three simultaneous class violations. Permanent.

**Option C: CONDITIONALLY APPROVED** — 10 binding SEC conditions:

| # | Condition |
|---|---|
| SEC-C1 | `OPENHIVEOS_INGESTION_TOKEN`: min 32 bytes CSPRNG, raw hex, Zod `z.string().min(64)` |
| SEC-C2 | Token comparison: `crypto.timingSafeEqual` on Buffer. No `===`. |
| SEC-C3 | Rate limit: 60 req/min on `POST /internal/usage`, separate from dashboard limit |
| SEC-C4 | Zod validation before DB write; required: session_id, model, provider, prompt_tokens, completion_tokens, cost_usd |
| SEC-C5 | session_id: `z.string().regex(/^[a-z][a-z0-9_-]*:[^:]+:\d{13}$/)` — malformed = 400 |
| SEC-C6 | `UNIQUE (session_id, loop_index)` in migration; duplicate = 409 (replay injection prevention AND data integrity) |
| SEC-C7 | `OPENHIVEOS_INGESTION_TOKEN` registered in gitleaks.toml |
| SEC-C8 | Ingestion auth middleware must NOT reference `agents` table — separate code path from `src/auth/identity.ts` |
| SEC-C9 | `llm_model_pricing` NOT in migration; `cost_usd` required; 422 if absent |
| SEC-C10 | Token rotation procedure documented in operator runbook before sprint closes |

Locksmith note: The `UNIQUE (session_id, loop_index)` constraint (Murphy's data integrity flag) is also a security control — it prevents replay injection where a compromised Bridge floods the endpoint with duplicate records to inflate cost data. This constraint is required under SEC-C6 regardless of the data-integrity motivation for adding it.

---

## Technical Specification (Option C)

### Migration (`005_llm_usage.sql` or `006` — OQ-1)

```sql
-- llm_usage table (adapted from opensquad migration 025/026)
-- NOTE: llm_model_pricing is NOT ported — cost_usd is required in payload (SEC-C9)

CREATE TABLE llm_usage (
  id           BIGSERIAL PRIMARY KEY,
  session_id   TEXT        NOT NULL,          -- format validated in app layer (SEC-C5)
  model        TEXT        NOT NULL,
  provider     TEXT        NOT NULL,
  prompt_tokens          INTEGER NOT NULL DEFAULT 0,
  completion_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd     NUMERIC(12, 6) NOT NULL,       -- required; no server-side pricing computation (SEC-C9)
  loop_index   INTEGER,
  task_id      BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT llm_usage_session_loop_unique UNIQUE (session_id, loop_index)  -- SEC-C6
);

-- Grant INSERT to writer role (same role as store-memory, store-thought)
GRANT INSERT ON llm_usage TO openhiveos_writer; -- confirm exact role name against 001_init.sql

-- Analytical views (adapted from opensquad)
CREATE VIEW v_cost_by_agent_month AS ...;
CREATE VIEW v_cost_by_project_month AS ...;
CREATE VIEW v_cost_by_task AS ...;

-- Grant SELECT to openhiveos_reader (SEC read path)
GRANT SELECT ON llm_usage TO openhiveos_reader;
GRANT SELECT ON v_cost_by_agent_month TO openhiveos_reader;
GRANT SELECT ON v_cost_by_project_month TO openhiveos_reader;
GRANT SELECT ON v_cost_by_task TO openhiveos_reader;
```

### squad-api ingestion endpoint (`src/routes/internal.ts`)

```typescript
// Auth middleware (SEC-C2, SEC-C8)
// Validates OPENHIVEOS_INGESTION_TOKEN via crypto.timingSafeEqual
// Must NOT reference agents table (SEC-C8)

// Rate limit (SEC-C3): 60 req/min — separate limiter instance from dashboard

// Payload Zod schema (SEC-C4, SEC-C5, SEC-C9)
const UsagePayloadSchema = z.object({
  session_id: z.string().regex(/^[a-z][a-z0-9_-]*:[^:]+:\d{13}$/),  // SEC-C5
  model: z.string(),
  provider: z.string(),
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),  // required — SEC-C9
  cache_read_tokens: z.number().int().nonnegative().default(0),
  cache_creation_tokens: z.number().int().nonnegative().default(0),
  loop_index: z.number().int().optional(),   // see OQ-2
  task_id: z.number().int().optional(),
});

// On UNIQUE (session_id, loop_index) conflict: return 409 — not 500 (SEC-C6)
```

### squad-api public routes (`src/routes/usage.ts`)

- `GET /usage/agents` — reads `v_cost_by_agent_month`, returns array of `{agent, month, total_cost_usd, session_count, prompt_tokens, completion_tokens}`
- `GET /usage/agents/:name` — per-agent detail, up to 12 months
- `GET /usage/tasks/:id` — reads `v_cost_by_task` for a given task ID

All three routes: `openhiveos_reader` DB role, standard auth (dashboard bearer token).

### Dashboard `UsageView` (MVP)

| Column | Source | Notes |
|---|---|---|
| Agent | v_cost_by_agent_month.agent | |
| Model | v_cost_by_agent_month.model | |
| Provider | v_cost_by_agent_month.provider | |
| Prompt Tokens | sum(prompt_tokens) | |
| Completion Tokens | sum(completion_tokens) | |
| Cost (USD) | sum(cost_usd) | 4 decimal places |

Empty state: `"No usage data yet. Usage data appears here after Bridge connects."`

Dark-launch mechanism: OQ-5 (Rocket to confirm approach before building).

---

## Open Questions

| # | Question | Owner | Target |
|---|---|---|---|
| OQ-1 | Migration number — `005` or `006`? Confirm after 003_squad_api_role, 003_dashboard_agent, 004_ethos_seal sequence verified | Murphy | Before migration file is written |
| OQ-2 | Should `loop_index` be required (not optional) in the payload Zod schema? | Silas + Murphy | Before SEC-C4 implemented |
| OQ-3 | Bridge retry strategy for `POST /internal/usage` (retries, backoff, extended outage behaviour) | Silas | T-01 spike |
| OQ-4 | Bridge usage-reporting registry design: third-server trigger or preemptive? | Silas + Nova | Sprint 5 planning |
| OQ-5 | Dashboard dark-launch mechanism: feature flag, env var gate, or empty-state conditional only? | Rocket | Before UsageView built |

---

## Action Items

| # | Task | Owner | Due |
|---|---|---|---|
| D1 | Confirm migration number (OQ-1) — audit 003/004 migration sequence | Murphy | Before sprint implementation begins |
| D2 | `005_llm_usage.sql` (or `006`): create migration with llm_usage table, UNIQUE constraint, views, and all role grants. Verify writer role name against 001_init.sql before writing. | Murphy | Sprint 3 |
| D3 | `src/routes/internal.ts`: `POST /internal/usage` route with ingestion token auth middleware (timingSafeEqual, SEC-C2), rate limiter (60 req/min, SEC-C3), Zod validation (SEC-C4, SEC-C5), 409 on conflict (SEC-C6). Resolve OQ-2 before writing Zod schema. | Murphy | Sprint 3, after D2 |
| D4 | `src/routes/usage.ts`: `GET /usage/agents`, `GET /usage/agents/:name`, `GET /usage/tasks/:id`. Reads from views via openhiveos_reader. | Murphy | Sprint 3, after D2 |
| D5 | Register `OPENHIVEOS_INGESTION_TOKEN` env var in Zod config schema (`z.string().min(64)`) | Murphy | Sprint 3, with D3 |
| D6 | Add `OPENHIVEOS_INGESTION_TOKEN` and `OPENHIVEOS_INGESTION_URL` to `.env.example` with security comment (SEC-C4 gate) | Cooper | Sprint 3, with D3 |
| D7 | Add `OPENHIVEOS_INGESTION_TOKEN` detection pattern to `gitleaks.toml` (SEC-C7) | Cooper | Sprint 3, with D3 |
| D8 | Dashboard `UsageView` component — 6-column MVP table, empty state, dark-launch mechanism (OQ-5 resolved first) | Rocket | Sprint 3, after D4 and ARCH-012 A5/A6 |
| D9 | Bridge update: `POST /internal/usage` call after each loop (fire-and-forget, parallel to opensquad `report_usage`). Gated on T-01 spike closing. | Cooper + Murphy | T-01 gate |
| D10 | Update `openapi.yaml` with `POST /internal/usage` schema + `GET /usage/agents`, `GET /usage/agents/:name`, `GET /usage/tasks/:id` endpoints | Clarence | Before sprint closes |
| D11 | Author operator runbook section: token generation, OPENHIVEOS_INGESTION_URL setup, rotation procedure (SEC-C10), troubleshooting | Clarence | Before sprint closes |
| D12 | [MERGE GATE] Locksmith SEC gate review: SEC-C1 through SEC-C10 all confirmed before ARCH-015 code merges to main | Locksmith | PR review |
| D13 | Update PRE-A1 (ARCH-013 #1355): migration gate check must cover the new llm_usage migration number after OQ-1 confirmed | Murphy | After D1 |
| D14 | Resolve OQ-2 (loop_index required vs optional) before SEC-C4 is implemented — document decision in PR comment | Silas + Murphy | Before D3 |
| D15 | Silas files Bridge usage-reporting registry design as Sprint 5+ backlog item | Silas | Sprint 4 planning |

---

## Canonical Operator Onboarding Sequence (Updated)

| Stage | Command | ADR |
|---|---|---|
| Stage 1 | `docker compose --profile init run --rm one-init` | ARCH-013 |
| Stage 2 | `docker compose --profile init run --rm provision --write-env .env.tokens` | ARCH-014 |
| Stage 3 | `npx tsx scripts/provision-agent-token.ts dashboard` | ARCH-014 |
| Stage 4 | Generate `OPENHIVEOS_INGESTION_TOKEN`, configure `OPENHIVEOS_INGESTION_URL`, restart squad-api | ARCH-015 |
| Stage 5 | Deploy Bridge with `OPENHIVEOS_INGESTION_URL` + `OPENHIVEOS_INGESTION_TOKEN` | T-01 gate |

Stage 4 is new from ARCH-015. Stage 5 is gated on T-01 spike closing.

---

*Minutes recorded by Elizabeth. ARCH-015 decided 2026-05-21. Next in queue: ARCH-016 (Integration Pattern). Requires ARCH-012 (done) + ARCH-014 (decided).*
