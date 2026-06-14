# ARCH-015 — LLM Usage Tracking in OpenHiveOS

---
title: "ARCH-015 — LLM Usage Tracking in OpenHiveOS"
date: 2026-05-21
updated: 2026-05-21
author: "Clarence"
owner: "Silas"
status: active
tags:
  - type/architecture
  - project/openhiveos
  - domain/backend
  - domain/security
  - domain/devops
  - audience/technical
review_date: 2026-08-21
doc_id: "ARCH-015"
related:
  - "[[ARCH-001-server-resolved-agent-identity]]"
  - "[[ARCH-008-openhiveos-founding-decisions]]"
  - "[[ARCH-012-squad-api-dashboard-architecture]]"
  - "[[ARCH-013-the-one-ethos-seal]]"
  - "[[ARCH-014-agent-onboarding-dynamic-provisioning]]"
---

*This ADR establishes the write path, storage schema, and Dashboard surface for LLM token consumption tracking inside OpenHiveOS. It is the canonical reference for Bridge integration, squad-api ingestion endpoint design, and all LLM cost analytics.*

---

## ADR — ARCH-015: LLM Usage Tracking in OpenHiveOS

**Date:** 2026-05-21
**Project:** openhiveos
**Status:** Decided
**Decision Owner:** Silas
**Approved by:** Elizabeth

---

## Context

OpenHiveOS hosts agents whose LLM token consumption must be visible in the Dashboard. Without usage data, operators cannot understand cost per agent, cost per project, or cost per task — making it impossible to budget, audit, or optimise a running squad.

A proven tracking schema already exists in the `opensquad-mcp-server` codebase (migrations 025 + 026: `llm_usage` table, `llm_model_pricing` table, three analytical views: `v_cost_by_agent_month`, `v_cost_by_project_month`, `v_cost_by_task`). The design question is not *what to store* but *how to get the data into the OpenHiveOS database* while keeping OpenHiveOS standalone-deployable and compliant with OWASP Top 10.

**The write path candidates were three:**

- **Option A** — MCP `report_usage` utility tool registered on the opensquad-mcp-server; Bridge calls it after each loop, alongside the existing `report_usage` call.
- **Option B** — A scheduled backfill cron on OpenHiveOS that pulls usage records from the opensquad squad-api at a regular interval.
- **Option C** — A native PostgreSQL schema (`005_llm_usage.sql` or `006_llm_usage.sql`, pending migration number confirmation) plus a dedicated `POST /internal/usage` ingestion endpoint on the OpenHiveOS squad-api, authenticated by a scoped bearer token. Bridge POSTs to this endpoint after each agent loop.

The review was conducted on 2026-05-21. All three options were evaluated by the full review panel including Locksmith (security seat).

---

## Prerequisites

| Gate | Status | Owner |
|---|---|---|
| **PRE-A1** (from ARCH-013/014): Fix migrate service gate — extend beyond `agents` table check to cover full migration sequence | Open | Murphy |
| **PRE-B1** (ARCH-012): Migrations `003_squad_api_role.sql` and `003_dashboard_agent.sql` applied | Open | Murphy |
| **PRE-B2** (ARCH-013): Migration `004_ethos_seal.sql` applied | Open | Murphy |
| **T-01 spike closed**: Bridge deployment to OpenHiveOS confirmed. `POST /internal/usage` calls are fire-and-forget and dark until Bridge deploys. | Open | Silas |

**Hard gate:** `005_llm_usage.sql` (or `006_llm_usage.sql`) silently will not apply without PRE-A1 being closed first. Murphy must fix the migrate service gate before this migration lands.

---

## Decision

**Option C — Native PostgreSQL schema + `POST /internal/usage` ingestion endpoint on squad-api.**

A new migration (`005_llm_usage.sql` — number to be confirmed after `003_squad_api_role`, `003_dashboard_agent`, `004_ethos_seal` sequence is verified; may become `006`) creates the `llm_usage` table in the OpenHiveOS database. The schema is adapted from the proven opensquad schema with one deliberate omission: the `llm_model_pricing` table is **not ported** (see Trade-offs Accepted).

The squad-api (port 3005, established in ARCH-012) receives a new internal router. `POST /internal/usage` is mounted there — not on the health server. The endpoint is authenticated by a dedicated `OPENHIVEOS_INGESTION_TOKEN` bearer token, validated via `crypto.timingSafeEqual` middleware before any database access. The endpoint accepts usage payloads from Bridge, validates them with Zod, and writes to `llm_usage` via the existing writer role (`GRANT INSERT ON llm_usage` to the same role used by `store-memory` and `store-thought`).

The squad-api also exposes three new public analytical endpoints, all read via the `openhiveos_reader` role:
- `GET /usage/agents` — aggregated cost by agent for current month
- `GET /usage/agents/:name` — per-agent cost detail
- `GET /usage/tasks/:id` — cost breakdown by task

These endpoints read from three analytical views (`v_cost_by_agent_month`, `v_cost_by_project_month`, `v_cost_by_task`) provisioned in the migration.

The Dashboard gains a usage view — a 6-column MVP table — reading from the squad-api `GET /usage` endpoints. The feature is provisioned but **dark** until Bridge deploys (T-01 spike).

Bridge update: after each agent loop, Bridge POSTs to `OPENHIVEOS_INGESTION_URL` + `OPENHIVEOS_INGESTION_TOKEN`. This call is parallel to the existing `report_usage` call on opensquad — fire-and-forget. Bridge does not block on the result.

---

## Rationale

### Why Option A is blocked

**Permanently blocked by Cooper (infrastructure) and Locksmith (security).** Two independent, non-overlapping reasons — either one alone is disqualifying.

**Cooper's block:** Bridge cannot call stdio-transport MCP tools externally. The opensquad-mcp-server uses stdio transport. There is no safe HTTP adapter on the health server. The MCP protocol over stdio is a local IPC contract, not an addressable network service. Attempting to wrap it in an HTTP adapter on the health server would create an unauthenticated proxy with undefined blast radius — Cooper blocked this path outright as an infrastructure anti-pattern.

**Locksmith's block:** Registering a `report_usage` MCP tool forces a new, unscoped auth surface. OWASP A01:2021 (Broken Access Control) — any agent that can call MCP tools can call `report_usage`, whether or not that agent should be writing usage data. No remediation path exists within Option A's architecture because the MCP tool surface is, by design, available to authenticated agents.

### Why Option B is blocked outright

**Permanently blocked by Locksmith on three simultaneous OWASP violations.** All three are independently disqualifying. Every remediation path transforms Option B into Option C.

- **OWASP A02:2021 (Cryptographic Failures):** The backfill cron requires an outbound credential (`OPENSQUAD_SQUAD_API_URL` + a cross-system auth token) with no defined scope. A cross-system outbound credential in an environment variable with no scoped token is a standing credential-exposure risk.
- **OWASP A10:2021 (SSRF):** `OPENSQUAD_SQUAD_API_URL` is an operator-supplied URL used by a cron to make outbound HTTP requests. This is a textbook SSRF vector. No safe remediation exists within a polling architecture.
- **OWASP A09:2021 (Security Logging and Monitoring Failures):** Silent cron failure produces zero audit trail. If the backfill cron fails — for any reason — usage data is silently lost. There is no alert, no retry guarantee, no dead-letter path. This is not remediable without adding infrastructure that makes Option B indistinguishable from Option C in scope and complexity.

### Why Option C is approved

Option C satisfies every requirement:

1. **Standalone deployability** — all data lives in the OpenHiveOS database. No outbound dependency on opensquad systems at runtime.
2. **Minimal attack surface** — `OPENHIVEOS_INGESTION_TOKEN` is a scoped bearer token for a single endpoint. It does not share the agent authentication path and cannot be used for any other operation.
3. **Write path is auditable** — every ingestion attempt passes through a rate-limited, Zod-validated, timingSafeEqual-authenticated route. Failures are HTTP errors with logged context. There is no silent failure mode.
4. **Proven schema** — the `llm_usage` table and three analytical views are directly adapted from a production schema already operating in opensquad. The risk of schema-design error is low.
5. **No new infrastructure** — squad-api (ARCH-012) already exists. Adding an internal router requires no new service, no new Docker container, and no new port.

---

## Trade-offs Accepted

1. **`llm_model_pricing` table is not ported.** The opensquad schema includes a pricing table for computing `cost_usd` server-side from token counts. This table is dead code in the Option C context: `cost_usd` is a required field in the Zod payload (SEC-C9). If `cost_usd` is absent, the endpoint returns 422. Bridge is responsible for computing cost before POSTing. The pricing table is excluded from the migration to eliminate dead code, reduce schema complexity, and avoid a maintenance burden for a table that serves no function in this write path.

2. **Replay protection via `UNIQUE (session_id, loop_index)` has a sharp edge.** If Bridge retries a failed POST with the same `(session_id, loop_index)` pair, the DB constraint returns a conflict error. The endpoint must handle this gracefully (return 409, do not return 500) so Bridge's fire-and-forget retry logic does not alarm. The conflict is not a security incident — it is expected retry behaviour. However, an attacker who learns a valid `session_id` and `loop_index` cannot inject additional cost data for that slot. This is the intended behaviour.

3. **Fire-and-forget from Bridge means no delivery guarantee.** If `POST /internal/usage` is unavailable and Bridge does not retry, usage data for that loop is lost. This is acceptable at v0.2 — Bridge retries on transient HTTP errors (5xx), but a prolonged outage will produce gaps in usage data. A dead-letter queue or persistent retry mechanism is deferred to a future sprint. Operators should be aware that usage data reflects what Bridge successfully reported, not a guaranteed ledger.

4. **Migration number is not yet confirmed.** The migration is expected to be `005_llm_usage.sql` but may be `006_llm_usage.sql` depending on whether `003_squad_api_role`, `003_dashboard_agent`, and `004_ethos_seal` consume the `003` and `004` slots as expected. Murphy must confirm the sequence before writing the migration file. Using the wrong number is not catastrophic (migrations are run in filename order) but creates a gap that requires a corrective rename.

5. **Dashboard usage view is dark until T-01 spike closes.** The squad-api routes and the migration land in this sprint. The Dashboard component is built. But the feature produces no data until Bridge is deployed to OpenHiveOS. Operators will see an empty table, not an error — the endpoints return empty arrays if `llm_usage` has no rows.

6. **Bridge usage-reporting registry design is deferred.** Nova's cross-project flag: the `POST /internal/usage` pattern is the v0.2 standard for two Squad Instances (opensquad + OpenHiveOS). The original trigger condition ("third MCP server") was incorrect — Nova's amendment (ARCH-016 F13): the real trigger is **a second Squad Instance connecting to the Bridge, OR Sprint 6 planning, whichever comes first**. The mcp-gateway abstraction (ARCH-016) means this threshold arrives faster than originally framed — every new Squad Instance that integrates with Bridge is a new `/internal/usage` destination. This is a Sprint 5+ item owned by Silas. Task: #1396 (D15).

---

## Consequences

### New files

- `migrations/005_llm_usage.sql` (or `006_llm_usage.sql` — confirm after migration sequence audit) — creates `llm_usage` table, `UNIQUE (session_id, loop_index)` constraint, `GRANT INSERT` to writer role, `GRANT SELECT` on table and views to `openhiveos_reader`, and the three analytical views: `v_cost_by_agent_month`, `v_cost_by_project_month`, `v_cost_by_task`.
- `src/routes/internal.ts` (squad-api) — internal router. Mounts `POST /internal/usage`. Auth middleware validates `OPENHIVEOS_INGESTION_TOKEN` via `crypto.timingSafeEqual`. Rate-limited separately from the dashboard rate limit (60 req/min, per SEC-C3).
- `src/routes/usage.ts` (squad-api) — public analytical router. Mounts `GET /usage/agents`, `GET /usage/agents/:name`, `GET /usage/tasks/:id`. Reads from `v_cost_by_agent_month`, `v_cost_by_project_month`, `v_cost_by_task` via `openhiveos_reader`.

### Modified files

- `src/index.ts` (squad-api) — register internal router and usage router.
- `.env.example` — add `OPENHIVEOS_INGESTION_TOKEN` (with security comment: minimum 32 bytes CSPRNG, stored as 64-character hex string; never commit a real value) and `OPENHIVEOS_INGESTION_URL` (the URL Bridge uses to reach this endpoint).
- `gitleaks.toml` — add `OPENHIVEOS_INGESTION_TOKEN` detection pattern (SEC-C7).
- Dashboard `UsageView` component (Rocket) — 6-column MVP table: Agent, Model, Provider, Prompt Tokens, Completion Tokens, Cost (USD). Reads from `GET /usage/agents`. Empty state: "No usage data yet. Usage data appears here after Bridge connects." Feature is conditionally rendered or dark behind a flag until T-01 closes.

### Files explicitly NOT created

- `src/utilities/report-usage.ts` — this file does not exist in Option C. There is no MCP tool for usage reporting. If this filename appears in any PR, it belongs to a rejected option.

### DB role grants (summary)

| Role | Permission |
|---|---|
| Writer role (existing — used by `store-memory`, `store-thought`) | `INSERT` on `llm_usage` |
| `openhiveos_reader` | `SELECT` on `llm_usage`, `v_cost_by_agent_month`, `v_cost_by_project_month`, `v_cost_by_task` |

### Operator onboarding consequence

A new env var pair must be configured before Bridge connects. Add to operator runbook (Clarence action item C16):

```bash
# Generate OPENHIVEOS_INGESTION_TOKEN
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Output is exactly 64 hex characters — use this value in .env
# Set OPENHIVEOS_INGESTION_URL to the squad-api base URL reachable by Bridge
# e.g. OPENHIVEOS_INGESTION_URL=https://api.yourdomain.com
```

Token rotation procedure (SEC-C10, required before sprint closes):

1. Generate a new token: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. Update `OPENHIVEOS_INGESTION_TOKEN` in Bridge's environment.
3. Restart Bridge.
4. Update `OPENHIVEOS_INGESTION_TOKEN` in the OpenHiveOS `.env` and restart squad-api.
5. The old token is invalidated the moment squad-api restarts with the new value. There is no revocation list — the token is compared live from the environment variable on each request.

---

## Security Review

**Locksmith — APPROVED (Option C), BLOCKED (Option A), BLOCKED OUTRIGHT (Option B).**

Option A and Option B are permanently blocked. Option C is conditionally approved subject to ten binding implementation conditions (SEC-C1 through SEC-C10). All ten must be confirmed closed in the PR comment by Locksmith before any merge to main.

| # | Condition | Risk if violated |
|---|---|---|
| **SEC-C1** | `OPENHIVEOS_INGESTION_TOKEN` — minimum 32 bytes CSPRNG, stored as raw hex (not hashed, not base64). Zod schema on startup: `z.string().min(64)` (64 hex chars = 32 bytes). | OWASP A07 — insufficient entropy; token guessable or collision-prone |
| **SEC-C2** | Token comparison uses `crypto.timingSafeEqual` on `Buffer` objects in the auth middleware. String equality (`===`) is forbidden. | OWASP A02 — timing side-channel; token extracted via timing attack |
| **SEC-C3** | Rate limit on `POST /internal/usage` is separate from dashboard rate limit. Maximum: 60 req/min. This allows for retry burst while blocking volumetric abuse. | OWASP A04 — DoS via cost-table flooding; unlimited writes degrade DB performance |
| **SEC-C4** | Zod payload validation runs before any DB write. Required: `session_id` (regex-validated), `model`, `provider`, `prompt_tokens`, `completion_tokens`, `cost_usd`. Optional: `cache_read_tokens`, `cache_creation_tokens`, `loop_index`, `task_id`. Invalid payload = 400, not 500. | OWASP A03 — injection via unvalidated payload fields reaching raw SQL |
| **SEC-C5** | `session_id` Zod field: `z.string().regex(/^[a-z][a-z0-9_-]*:[^:]+:\d{13}$/)` — exact mirror of opensquad session_id format. Malformed `session_id` = 400. | OWASP A03 — arbitrary string in session_id column; breaks analytical view assumptions; potential injection surface |
| **SEC-C6** | `UNIQUE` constraint on `(session_id, loop_index)` in migration. Duplicate insert = 409 response from endpoint, not 500. | OWASP A04 — replay injection; duplicate records inflate cost totals and distort analytics |
| **SEC-C7** | `OPENHIVEOS_INGESTION_TOKEN` added to `gitleaks.toml` with a pattern matching 64 lowercase hex characters prefixed by the env var name. | OWASP A02 — token committed to source control; permanently compromised |
| **SEC-C8** | `POST /internal/usage` does NOT accept or return any agent bearer token material. The ingestion token auth middleware must be a separate code path from `src/auth/identity.ts`. It must not reference the `agents` table at any point. | OWASP A01 — privilege confusion; ingestion token conflated with agent identity; scope boundary destroyed |
| **SEC-C9** | `llm_model_pricing` table is NOT included in the migration. If `cost_usd` is absent from the payload, return 422 (Unprocessable Entity). No server-side cost computation from token counts. | Dead code risk; future operator confusion about pricing source of truth; silent cost miscalculation if pricing table diverges |
| **SEC-C10** | Token rotation procedure documented in the operator runbook before sprint closes. Procedure: new token generated → Bridge env updated → Bridge restarted → squad-api env updated → squad-api restarted → old token invalidated. No revocation list required at v0.2. | OWASP A02 — no documented rotation = indefinite token lifetime; unrotated credentials after suspected exposure |

---

## Rejected Alternatives

### Option A — MCP `report_usage` utility + Bridge dual-call

**Rejected. Permanently blocked by Cooper (infrastructure) and Locksmith (security). Neither block is remediable within Option A's architecture.**

Bridge cannot address stdio-transport MCP tools externally. The opensquad-mcp-server is not an HTTP service — it is a local stdio process. Wrapping it in an HTTP adapter on the health server would create an unauthenticated, unscoped proxy with no auth surface design. This is the infrastructure block.

Separately, a `report_usage` MCP tool is accessible to any authenticated agent. The auth model for MCP tools in this codebase is agent-bearer scoped — not operation-scoped. Introducing a write tool on the MCP surface with no narrower scope is OWASP A01. The only remediation would be to add a separate, scoped auth layer to the MCP tool — at which point the design is no longer an MCP tool.

**Do not re-propose Option A.** Both blocks are structural, not implementation details.

### Option B — Backfill cron pulling from opensquad squad-api

**Rejected. Permanently blocked by Locksmith. Three simultaneous OWASP violations, each independently disqualifying.**

Every remediation path for any one of the three violations transforms Option B into Option C in scope and complexity. There is no minimal-change path to making a cross-system polling cron compliant with A02, A09, and A10 simultaneously. The panel reached unanimous consensus on this conclusion without deliberation.

**Do not re-propose Option B.** The block is categorical, not conditional.

---

## Open Questions

| # | Question | Owner | Target |
|---|---|---|---|
| OQ-1 | What is the confirmed migration number — `005` or `006`? Must be resolved before Murphy writes the migration file. | Murphy | Before migration is written this sprint |
| OQ-2 | Should `loop_index` in the payload be required (not optional) to fully enforce the `UNIQUE (session_id, loop_index)` replay guard? Bridge always has this value. Making it optional weakens the constraint at the application layer even if the DB constraint catches duplicates via null-null collisions. | Silas + Murphy | Before SEC-C4 is implemented |
| OQ-3 | Bridge retry strategy: how many retries, what backoff, and what happens if the ingestion endpoint is unreachable for > N minutes? Is there a local buffer, or are gaps in usage data accepted as a known limitation until T-01 closes? | Silas | T-01 spike |
| OQ-4 | ~~AMENDED (F13, 2026-05-21).~~ **RESOLVED (ARCH-022, 2026-06-12).** Per-Squad Bridge deployment — no registry required. Each Squad Instance gets its own Bridge process. Option A (multi-destination array) and Option C (central registry) permanently blocked per ARCH-022. See [[ARCH-022-bridge-usage-reporting-registry]] for full decision and operator runbook. | Silas | ✅ Resolved |
| OQ-5 | Dashboard usage view dark launch mechanism: feature flag, env var gate, or empty-state conditional render only? Rocket to confirm the approach before building `UsageView`. | Rocket | Before `UsageView` is built |

---

## Addendum: VS Code Session Identity (Non-Bridge)

**Added:** 2026-06-14 (Sprint 12, Track 3)

OpenHiveOS agents running in VS Code (via the Copilot Chat extension or local Agent SDK) do not use the Bridge transport. They self-report their LLM usage directly by calling the `report_usage` MCP tool at session end. This addendum documents the canonical session_id format for non-Bridge agents.

### Session ID Format

**Canonical format:**
```
<agent-slug>:vscode:<unix-ms-timestamp>
```

**Examples (by agent slug):**
```
murphy:vscode:1749820800000
silas:vscode:1749820800015
elizabeth:vscode:1749820800042
```

**Regex match:**
```
^[a-z][a-z0-9_-]*:[^:]+:\d{13}$
```

The middle segment (`vscode`) is the **transport discriminator**. Analytics can distinguish VS Code sessions (`:vscode:`) from Bridge sessions (`:bridge:`) by parsing this field.

### Generation Rules

1. **Generate once at session start**, before the first tool call.
   - Do NOT regenerate mid-session.
   - Do NOT use a new session_id for each loop or turn.
   - Store it: `const SESSION_ID = '<agent-slug>:vscode:<Date.now()>'` — computed once and reused.

2. **Timestamp format**: Unix epoch milliseconds (13 digits). Example: `1749820800000` = 2026-06-14 09:00:00 UTC.
   - Ensure `Date.now()` returns milliseconds, not seconds.

### report_usage Protocol at Session End

At session end (after the final user request, or when the user closes the chat), call:

```typescript
mcp_openhiveos-mu_report_usage({
  session_id: SESSION_ID,           // stored at session start
  loop_index: 0,                    // single report per session (non-Bridge protocol)
  agent_slug: '<your-slug>',        // e.g. 'murphy', 'silas'
  model: 'claude-sonnet-4-5',       // or current active model
  provider: 'anthropic',            // provider slug
  prompt_tokens: 0,                 // see "Unavailable Data" below
  completion_tokens: 0,             // see "Unavailable Data" below
  cost_usd: 0                       // see "Unavailable Data" below
})
```

**Critical:** All numeric fields are **integers**. Do not send `null` or floating-point values. `0` is valid and expected for all cost/token fields.

### Unavailable Data (VS Code Session Reporting)

VS Code agents do not have access to:
- Token counts (OpenAI API visibility is not exposed by the VS Code extension)
- LLM cost data (no real-time pricing available in the agent's environment)

**Solution:** Send `0` for all token and cost fields. This is **not a schema violation**. The `llm_usage` table accepts and correctly stores zeros. The `report_usage` Zod schema defines:
```typescript
prompt_tokens: z.number().int().nonnegative().default(0),
completion_tokens: z.number().int().nonnegative().default(0),
cost_usd: z.number().nonnegative().default(0)
```

Zeros indicate "data not available in this transport," not "zero cost/tokens consumed." Analytics queries filter appropriately.

### Transport Discriminator

Use this field in analytics to separate data sources:
```sql
-- Bridge-sourced data (live cost tracking)
SELECT * FROM llm_usage WHERE session_id LIKE '%:bridge:%'

-- VS Code-sourced data (session count tracking)
SELECT * FROM llm_usage WHERE session_id LIKE '%:vscode:%'
```

Bridge provides real token/cost data; VS Code provides session count only. Do not aggregate or compare cost across both transports without explicit filtering.

### Future Work

**Real token/cost capture for VS Code requires:**
1. Deployment of an OpenAI-instrumented Bridge process to OpenHiveOS (T-01 spike, ARCH-015 O4 resolved), OR
2. VS Code extension API expansion to expose token/cost metadata to embedded agents (out of scope, OHE team)

Until one of these occurs, VS Code session reporting is visibility-only (session count + timestamp). This is acceptable for Sprint 12 and beyond — the instrumentation layer is in place and the reporting protocol is defined; cost data will flow when the upstream visibility exists.

---

## Changelog

| Version | Date | Author | Change |
|---|---|---|---|
| v1.0 | 2026-05-21 | Clarence (ADR) / Elizabeth (facilitation) / Silas (design) / Locksmith (security review) | Initial decision — Option C selected, Options A and B permanently blocked |
| v1.1 | 2026-05-21 | Silas (F13) | OQ-4 amended — D15 trigger condition corrected per Nova's ARCH-016 cross-project flag: "third MCP server" → "second Squad Instance connects to Bridge OR Sprint 6 planning" |
| v1.2 | 2026-06-14 | Murphy (Sprint 12 T3-1) | Added VS Code Session Identity addendum — canonical session_id format, generation rules, report_usage protocol, transport discriminator |
