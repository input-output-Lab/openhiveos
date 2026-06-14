---
title: "ARCH-024 — External Task Sync: Bidirectional ClickUp Integration via Async Queue Worker"
date: 2026-06-13
updated: 2026-06-13
author: "Clarence"
owner: "Silas"
status: decided
tags:
  - type/architecture
  - project/openhiveos
  - domain/backend
  - domain/integrations
  - audience/technical
review_date: 2026-09-13
doc_id: "ARCH-024"
related:
  - "[[ARCH-005-agent-os-canonical-architecture]]"
  - "[[ARCH-008-openhiveos-founding-decisions]]"
  - "[[ARCH-016-integration-pattern-mcp-gateway]]"
  - "[[ARCH-023-pending-close-task-state-machine]]"
---

*This ADR documents the bidirectional ClickUp sync architecture adopted for OpenHiveOS. It retires the clickup-mcp-server dual-call pattern and introduces a persistent sync queue, an adapter-per-provider integration layer, and the system's first background worker process.*

---

## ADR-024 — External Task Sync: Bidirectional ClickUp Integration via Async Queue Worker

**Date:** 2026-06-13
**Project:** OpenHiveOS
**Status:** Decided
**Decision Owner:** Silas
**Approved by:** Elizabeth

---

## Context

OpenHiveOS agents interact with ClickUp as the team's external project management system. Until this ADR, that interaction was managed through a dedicated `clickup-mcp-server` process that agents called directly alongside their `update_task` calls — a dual-call pattern that was implicit, undocumented, and fragile. There was no inbound path: ClickUp-originated events (task creation by a stakeholder, comment threads, status changes made directly in ClickUp) had no formal ingestion route into OpenHiveOS. The system was effectively write-only toward ClickUp and blind to everything that happened inside it. As the squad grows and external contributors increasingly use ClickUp as their primary interface, this gap creates data drift, missed context, and reliability risk. The decision before the team was how to replace the dual-call pattern with a formally architected, bidirectional, and provider-agnostic integration.

---

## Decision

Adopt the **Async Queue Worker** pattern (Option B). All task state changes in OpenHiveOS that require ClickUp propagation are written to a `sync_queue` table inside the same PostgreSQL transaction as the originating `handleUpdateTask` DB write. A `SyncWorker` process polls the queue on a 10–30 second interval and dispatches the corresponding ClickUp API calls. Inbound events from ClickUp are received at a new webhook endpoint (`POST /api/webhooks/clickup`), verified with HMAC-SHA256 signature validation before any DB access, and landed in `status: triage` via an `external_task_links` join table pending agent promotion. All ClickUp-specific logic is encapsulated in an adapter at `src/integrations/clickup/`, establishing a provider-agnostic integration layer that will accommodate future providers (e.g., `src/integrations/jira/`). The `clickup-mcp-server` is retired. OpenHiveOS is the authoritative system of record on all conflict fields.

---

## Rationale

Option B is preferred over the alternatives for four compounding reasons. First, it eliminates the dual-call pattern by making sync a side-effect of the write path rather than a caller responsibility — agents no longer need to know ClickUp exists. Second, transactional pairing of the DB write and the queue insert means no ClickUp update is lost to a crash or network timeout between two separate API calls. Third, the adapter pattern makes the integration boundary explicit and testable in isolation — swapping or adding providers does not require changes to core task logic. Fourth, the `triage` landing state for inbound tasks preserves the human-in-the-loop review step before any external task becomes a real OpenHiveOS work item, preventing injection or noise pollution from ClickUp.

---

## Trade-offs Accepted

- **Sync latency:** OpenHiveOS-to-ClickUp propagation is eventually consistent (10–30 second delay) rather than synchronous. Tasks will briefly appear out of sync between systems. This is acceptable given that OpenHiveOS is the system of record and ClickUp is a view layer for external stakeholders.
- **Operational complexity:** A persistent background worker is a new category of process in the stack. It requires its own health checks, retry logic, dead-letter handling, and monitoring. Cooper must provision runbooks before the SyncWorker goes to production.
- **Triage overhead:** Every inbound ClickUp task requires agent promotion before it enters the active task set. At low inbound volume this is manageable; at scale a promotion automation rule will be needed.
- **clickup-mcp-server retirement:** Any undocumented workflows relying on the direct MCP server must be discovered and migrated before cutover. The risk is assessed as low given the tool was not formally documented as a dependency.

---

## Consequences

**Schema:**
- New table: `sync_queue` — stores pending outbound sync operations with status, provider, payload, retry count, and created/updated timestamps.
- New table: `external_task_links` — join table linking OpenHiveOS tasks to external provider task IDs. Columns include `provider`, `external_id`, `external_url`, `sync_state`, and `last_synced_at`. Not columns on `tasks` — provider-agnostic by design.
- New enum value or column: inbound tasks land in `status: triage` before agent promotion.

**Code:**
- New module: `src/integrations/clickup/` — ClickUp adapter implementing outbound API calls and inbound event parsing.
- New module structure: `src/integrations/` — provider-agnostic integration layer. Future providers follow the same pattern.
- New service: `SyncWorker` — first background worker in the OpenHiveOS process model. Polls `sync_queue`, dispatches ClickUp API calls, marks entries processed or failed.
- New route: `POST /api/webhooks/clickup` — inbound webhook. HMAC-SHA256 signature verification fires before any DB access. Rejects unverified payloads with `401`.
- Retired: `clickup-mcp-server` — no longer invoked by agents or included in the process model.

**Agent behaviour:**
- Agents no longer call ClickUp directly. `update_task` is the single write path. ClickUp sync is invisible to the caller.
- The sprint-workflow dual-call pattern (`update_task` + clickup tool call) is retired. See documentation consequences below.

**Infrastructure:**
- `SyncWorker` must be added to `ecosystem.config.cjs` (PM2 process list) and `docker-compose.yml`.
- Webhook endpoint must be registered in ClickUp workspace settings with the HMAC secret stored in the secrets vault (never in code or documentation).
- Cooper to author: SyncWorker health check runbook, dead-letter queue investigation SOP, and ClickUp webhook registration procedure.

**Documentation:**
- `sprint-workflow.md` — Retire the dual-call pattern. The ClickUp sync step is no longer a caller responsibility. Agents call `update_task` only. The SOP must remove any instruction to also call the ClickUp MCP tool.
- `bug-and-change-request-intake.md` — Add ClickUp as a formal inbound submission channel. Document the `triage` landing state: submissions arriving via ClickUp webhook require agent promotion before they enter the OpenSquad task system. Elizabeth's triage process applies to promoted tasks.
- `agent-git-discipline.md` — Add a note that external task references (ClickUp IDs, external URLs) must not be committed as hardcoded values. All external references are managed through `external_task_links` at runtime.
- New SOP required: `clickup-integration-operations.md` — covering SyncWorker health monitoring, dead-letter investigation, webhook secret rotation, and the inbound triage promotion workflow.
- This ADR supersedes any prior informal documentation of the `clickup-mcp-server` as an agent tool dependency.

---

## Security Review

**Reviewed by Locksmith — 2026-06-13. Status: CONDITIONALLY APPROVED.**

Option B is approved for implementation subject to five pre-implementation conditions and three pre-merge gates. Dev may not begin until all conditions are confirmed.

### Pre-Implementation Conditions (blocking)

| # | Condition | OWASP Ref |
|---|---|---|
| C1 | Webhook route must use `express.raw()` to buffer the raw body **before** `express.json()` runs. HMAC-SHA256 verification must operate on the original byte buffer and use `timingSafeEqual` — not string equality, not re-serialised JSON. | A02 |
| C2 | Webhook route mounted at `/webhooks/clickup` — a separate prefix **before** the `/api` auth stack — with its own dedicated rate limiter (200 req/min). Not under `/api/*`. ClickUp cannot present an agent bearer token. | A01 |
| C3 | `sync_queue` must include `clickup_event_id TEXT UNIQUE`. Handler deduplicates on this field and returns HTTP 200 on duplicate without processing (never 4xx — ClickUp will retry on error). | A04 |
| C4 | ClickUp bot account permissions scoped to minimum required lists only. Not workspace-wide. Confirmed in ClickUp admin before the integration is enabled. | Blast radius |
| C5 | nginx location block for `/webhooks/clickup` sets `client_max_body_size 256k`. | A05 |

### Pre-Merge Gates

| # | Gate | Owner |
|---|---|---|
| G1 | POST with invalid or absent HMAC → 401, no DB write | Murphy / Scout |
| G2 | POST with valid HMAC and `updated_by == CLICKUP_BOT_USER_ID` → event dropped, 200 returned, no task mutation | Murphy / Scout |
| G3 | `sync_queue.payload` does not appear in any structured log output at INFO or DEBUG level under test execution | Locksmith review |

### Critical Implementation Notes

**A02 — Raw body / HMAC trap.** `express.json()` is applied globally in `server.ts`. If `JSON.parse()` runs before HMAC verification, re-serialisation differences will silently break signature checks. The webhook route must intercept the request before the global JSON middleware. See implementation pattern in HMAC middleware using `express.raw({ type: 'application/json' })`.

**Echo loop guard scope.** `updated_by == CLICKUP_BOT_USER_ID` prevents the most obvious loop but does not prevent replay attacks (replayed legitimate events pass the guard because `updated_by` is a real user ID). `clickup_event_id` deduplication (C3) is the structural defence against replay.

**Bot account blast radius.** If `CLICKUP_BOT_API_TOKEN` is compromised, an attacker can read and write all tasks visible to the bot account and can forge inbound state by writing to ClickUp directly — triggering legitimate webhooks with attacker-controlled content that pass HMAC verification. `CLICKUP_BOT_API_TOKEN` and `CLICKUP_WEBHOOK_SECRET` must be stored as separate env vars, rotated independently, and subject to immediate rotation on suspected exposure.

**`sync_queue.payload` is sensitive operational data.** SyncWorker log output must never include payload content. Acceptable: `task_id`, `external_id`, `provider`, `status`. Unacceptable: any task field values.

**Retention.** `sync_queue` rows in `done` or `failed` state accumulate indefinitely without a cleanup policy. A TTL purge (suggested: 30 days) must be included in the initial implementation — not deferred.

---

## Rejected Alternatives

- **Option A — Synchronous inline call:** ClickUp API called synchronously inside `handleUpdateTask` before the response is returned. Rejected because: (a) a ClickUp API failure or timeout causes OpenHiveOS writes to fail — an external system's reliability determines the reliability of our own write path; (b) the dual-call problem is not solved, only relocated; (c) rollback semantics are undefined if the DB write succeeds but the ClickUp call fails.

- **Option C — Event-sourced message bus:** All state changes published to a message bus (e.g., Redis Streams, NATS); a dedicated consumer handles ClickUp publishing. Rejected for this phase because: (a) introduces a new infrastructure dependency (message broker) not currently in the stack; (b) operational overhead exceeds the team's current capacity; (c) the sync volume does not justify the complexity. Option C remains valid for a future phase if sync throughput or provider count grows materially.

---

## Amendment 1 — Provider-Agnostic Registry, PM2 Runtime, Dashboard Panel

**Date:** 2026-06-13  
**Approved by:** Richo (Integrator)

Three amendments to the original decision ratified during post-review planning:

### A1.1 — PM2 is the runtime. No separate process manager.

`SyncWorker` is registered in `ecosystem.config.cjs` as a third named PM2 process alongside `squad-api` and `mcp-gateway`. It is not launched as a standalone script, a separate Docker Compose service, or a system daemon.

```js
{
  name: 'sync-worker',
  script: 'dist/workers/sync.worker.js',
  instances: 1,
  exec_mode: 'fork',
  cwd: '/Users/richo/Sites/inputoutputco/OpenHiveOS',
  interpreter: 'node',
  autorestart: true,
  max_restarts: 10,
  min_uptime: '10s',
  output: 'logs/sync-worker.log',
  error: 'logs/sync-worker-error.log',
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  max_memory_restart: '200M',
}
```

Boot persistence follows the existing pattern: `pm2 save` after registration. The SyncWorker process respects the same `NODE_ENV` and `.env` loading as the other two processes.

### A1.2 — Provider-agnostic registry. ClickUp is optional. JIRA is planned.

The sync architecture must support multiple providers without coupling `SyncWorker` to ClickUp. A provider registry is the implementation pattern:

**Environment-driven opt-in:**
```
# ClickUp
CLICKUP_ENABLED=true
CLICKUP_API_TOKEN=...
CLICKUP_WEBHOOK_SECRET=...
CLICKUP_BOT_USER_ID=...

# JIRA (planned — Sprint N+2 or later)
JIRA_ENABLED=false
JIRA_BASE_URL=
JIRA_API_TOKEN=
JIRA_BOT_USER_ID=
```

A provider with `{PROVIDER}_ENABLED` absent or `false` is silently skipped by `SyncWorker`. It does not crash, does not log errors, and does not require its other env vars to be set. The system operates normally with zero providers enabled.

**Registry pattern (`src/integrations/registry.ts`):**
```ts
export interface IntegrationAdapter {
  provider: string
  enabled: boolean
  dispatch(row: SyncQueueRow): Promise<void>
  handleWebhook(payload: unknown): Promise<void>
}

export function getEnabledAdapters(): IntegrationAdapter[] {
  return [clickupAdapter, jiraAdapter].filter(a => a.enabled)
}
```

Each adapter (`src/integrations/clickup/index.ts`, `src/integrations/jira/index.ts`) sets `enabled` based on its env vars. `SyncWorker` iterates `getEnabledAdapters()` — it has no provider-specific code.

**JIRA is a planned provider, not a future consideration.** The schema (`external_task_links.provider`, `sync_queue` direction column, status mappings) must be designed to accommodate JIRA from the first migration. No ClickUp-specific columns. No ClickUp-specific constraint names. All provider identifiers are `TEXT` values in data, not enum types.

**Webhook routing** for inbound events is provider-scoped:
- `/webhooks/clickup` — ClickUp inbound (per Locksmith C2)
- `/webhooks/jira` — JIRA inbound (same HMAC pattern, different secret)

Each route is only registered if its provider is enabled.

### A1.3 — Dashboard integrations panel

The operator dashboard must include an **Integrations** view. This is not a Sprint N+1 nice-to-have — it is required for the integration to be operationally manageable without SSH access.

**Required on launch (Sprint N, before production):**
- Integration registry status: which providers are enabled, which are disabled
- Per-provider sync queue depth: count of `pending` + `dispatched` rows in `sync_queue` by provider
- Per-provider last sync timestamp: most recent `done_at` from `sync_queue`
- Per-provider error count: count of `failed` rows (24h window)

**Sprint N+1 (after inbound webhook is live):**
- Triage inbox: count and list of tasks in `status: triage` pending promotion
- Per-task external link indicator: link icon on task rows that have an `external_task_links` entry
- Error detail: expand a failed row to see the failure reason (no payload content — metadata only)

**Route:** `/integrations` on the dashboard, guarded by the existing operator auth. Rocket owns the component build. Data is served from a new squad-api endpoint `GET /api/integrations/status`.

---

## Amendment Log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-06-13 | Clarence | Initial — formal architecture review (Elizabeth, Silas, Murphy, Rocket, Cooper, Locksmith) |
| 1.1 | 2026-06-13 | Elizabeth | Amendment 1: PM2 runtime, provider-agnostic registry, dashboard integrations panel. Approved by Richo. |
