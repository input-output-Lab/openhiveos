# Changelog

All notable changes to OpenHiveOS are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Version numbers follow [Semantic Versioning](https://semver.org/).

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
