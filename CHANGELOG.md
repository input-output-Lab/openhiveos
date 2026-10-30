# Changelog

All notable changes to OpenHiveOS are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Version numbers follow [Semantic Versioning](https://semver.org/).

---

## [0.2.0] — 2026-10-30

Sprint 16 — task lifecycle, typed estimates, and usage analytics. "Stop the bleeding, start capturing data."

**Delivered by:** Murphy, Scout, Elizabeth (PM), Cooper (backup gate), The One (content spec)  
**Branch:** `feat/s16-l10-lifecycle-time-reporting` → `main`

### Added
- Task lifecycle history: `task_status_history` (append-only) + `audit_log` with before/after JSONB (migration 024); `tasks.started_at/completed_at/resolution/reviewer_agent_slug`; `hive.actor` session convention
- Typed estimates: `tasks.estimated_hours/billing_low/billing_high/estimate_confidence` + versioned `task_estimates` table (migration 025); create_task MCP tool now requires numeric estimates
- Usage enrichment: `llm_usage` +8 columns, `llm_models`/`llm_model_aliases` registry, `v_usage_enriched` view (migration 022)
- Versioned price list: `llm_model_prices` with single-current-row constraint + tstzrange EXCLUDE (migration 023); server-side estimated cost with `cost_source` flag (SEC-C9 v2, SEC-C11/12/13)
- Local usage collector: VS Code chatSessions/transcripts → structured usage JSON (`src/scripts/usage-collector`)
- Tool invocation analytics: `tool_invocations` +10 columns — session/task/project attribution, arg_keys + args_hash (raw values never stored), response_bytes (migration 026 + gateway enrichment)
- Agent spec v1.1.0: 2-step Session Start Gate, actual-values `report_usage` template with task_id, unified review→pending-close lifecycle, explicit approver rule (Elizabeth; Nova for Elizabeth's tasks)

### Fixed
- Status drift: single `TASK_STATUSES` source of truth in `src/types.ts`; contract test + CI gate on applied schema
- CI: dynamic migration glob loop (all migrations now apply in CI), vitest wired into CI, 4-month-stale test assertions fixed
- 100 stuck tasks cleared: 44 closed (22 auto_closed + 22 obsolete), 65 queued for owner triage

### Security
- SEC-C9 revised: `cost_usd` optional on `/internal/usage`, server computes + flags estimated cost; `cost_source` server-owned; price table has no reader surface (SEC-C12); defined degradation (SEC-C13)
- `tool_invocations` stores arg key names + SHA-256 hash only — raw values never persisted

**[0.2.0]: https://github.com/inputoutputlabs/openhiveos/releases/tag/v0.2.0**

---

## [0.1.0] — 2026-05-21

First public release. The Cron Utilities registration layer completes the v0.1 feature set across four sprints.

**Delivered by:** Murphy, Silas, Cooper, Locksmith, Clarence, Elizabeth  
**Branch:** `release/sprint-4` → `main`  
**Commit:** `9543a92`

### Added — Sprint 4: Cron Utilities

- **`create_cron`** MCP tool — registers a new cron schedule against an owned project. Validates cron expressions with `cron-parser`. Enforces tool_name allowlist (SEC-26), payload size + depth limits (SEC-27), cron-expression syntax (SEC-28), and project ownership (SEC-29).
- **`update_cron`** MCP tool — patch semantics; updates name, description, schedule, tool_name, payload, or status (`active`/`paused`) on an owned cron. Nullable fields cleared by passing `null` explicitly.
- **`query_crons`** MCP tool — open read with filter allowlist (SEC-30): `project_id`, `status`, `owner_agent_slug`. Soft-deleted crons excluded by default.
- **`delete_cron`** MCP tool — soft delete only. Sets `status = 'deleted'`. Hard deletes are prohibited.
- **`query_sprints`** MCP tool — caller-scoped sprint history. Server injects `owner_agent_slug`; no agent can read another agent's sprint records.
- **`migrations/003_crons.sql`** — `crons` table with `chk_crons_status` and `chk_crons_schedule` CHECK constraints, three indexes (project_id, owner_agent_slug, and a partial index on `status = 'active'`), and an auto-updating `updated_at` trigger.
- **`src/utilities/tool-registry.ts`** — canonical allowlist for `tool_name` field. 21 registered tool names. Compile-time exhaustive check against `index.ts` registrations.
- **`ARCH-011`** — Cron Utilities Schema ADR. Decisions: D1 (soft delete), D2 (caller-scoped `query_sprints`), D3 (Dockerfile deferred). SEC-26 through SEC-30 binding conditions.
- **Health endpoint** now returns `schema: "ok"` when the `crons` table is confirmed present. Returns HTTP 503 with `schema: "degraded"` if missing.
- **CI pipeline** updated: applies migration 003, verifies all 9 tables, checks `crons_project_id_fkey` and `crons_owner_agent_slug_fkey` foreign keys.
- **15 SOP seed files** in `seeds/sops/` covering architecture, coding, decision, devops, documentation, and QA categories.
- **`cron-parser@^4.9.0`** dependency — standard cron expression validation.

### Added — Sprint 3: Coordination Utilities

- **`create_project`**, **`update_project`**, **`query_projects`**, **`get_project_board`** MCP tools
- **`create_task`**, **`update_task`**, **`query_tasks`** MCP tools
- **`advance_sprint`** MCP tool — auto-computes `MAX(sprint_number)+1`; `UNIQUE(project_id, sprint_number)` race guard
- **`migrations/002_coordination_utilities.sql`** — `projects`, `tasks`, `sprints` tables
- **ARCH-010** — Coordination Utilities Schema ADR. SEC-21 through SEC-25 binding conditions.

### Added — Sprint 2: Auth and OS Primitives (foundation)

- Bearer token authentication — SHA-256 hash stored, plaintext never touches DB
- **`src/auth.ts`** — `authenticateRequest()` middleware; timing-safe comparison
- Agent provisioning script — `scripts/provision-agent-token.ts`
- **`migrations/001_init.sql`** — `agents`, `memories`, `thoughts`, `sops` tables + pgvector extension
- All 8 OS Primitive MCP tools registered: `get_disposition`, `set_disposition`, `store_memory`, `search_memory`, `store_thought`, `query_thoughts`, `ratify_thought`, `search_sops`

### Added — Sprint 1: Scaffold

- Node.js 20 + TypeScript strict project scaffold (ESM native, `NodeNext` module resolution)
- PostgreSQL 17 + pgvector client (`pg` + `pgvector` packages)
- MCP TypeScript SDK wired: `McpServer` + `StdioServerTransport` + `server.registerTool()`
- Health HTTP endpoint (`GET /health`) on port 3000
- ESLint + Prettier configuration (max-warnings: 0)
- GitHub Actions CI: build, lint, typecheck, migration smoke test

### Security

SEC-26 through SEC-30 binding conditions met (Locksmith formal sign-off, Sprint 4):
- **SEC-26** — `tool_name` allowlist enforced at create and update
- **SEC-27** — Payload JSONB: 16 KB size cap, 5-level nesting cap, type guard (plain objects only)
- **SEC-28** — Cron expression validated with `cron-parser` before DB write
- **SEC-29** — Ownership gate: project must be owned by caller before cron can be created
- **SEC-30** — `ALLOWED_CRON_FILTERS` compile-time exhaustive check against Zod schema

### Known limitations (Sprint 5)

- **Cron worker not yet shipped.** Cron records are stored but not executed. The execution tier (cron worker) is the Sprint 5 scope.
- `queryCronsSchema` uses Zod default (strip unknown keys) instead of `.strict()`. Logged as non-blocking O-1 by Locksmith. Target: Sprint 5.
- `query_crons` returns crons for all agents — cross-agent enumeration gap (ARCH-011 Tech Debt #2). Caller-scoping design required before Sprint 5 close.

---

*[0.1.0]: https://github.com/inputoutputlabs/openhiveos/releases/tag/v0.1.0*
