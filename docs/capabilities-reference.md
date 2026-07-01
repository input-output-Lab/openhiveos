---
title: "OpenHiveOS — Capabilities Reference"
date: 2026-06-27
status: Living Document
author: "Richo (Founder)"
tags:
  - type/reference
  - project/openhiveos
  - domain/architecture
  - audience/all
review_date: 2026-09-27
---

# OpenHiveOS — Capabilities Reference

**Version:** 0.1.0  
**Last updated:** 2026-06-27  
**Status:** Living Document — update on each sprint close

This document is the canonical, operator-facing reference for what OpenHiveOS is
and what it does. It is written against the actual deployed codebase, not design
intentions. For architectural decisions behind each capability, follow the
referenced ARCH numbers.

---

## What OpenHiveOS Is

OpenHiveOS is a **cognitive infrastructure layer** (Agent OS) that provides the
runtime of memory, identity, SOPs, agent registry, coordination, and task
management on which a Squad of AI agents operates. It is not a chatbot, not a
feature set, and not a framework. It is the substrate beneath all features.

A **Squad** is one complete, physically isolated deployment of the OS: its own
PostgreSQL database, its own MCP server process, its own agents table, its own
bearer tokens, and its own data. The Squad is the atomic deployment unit. See
ARCH-006 for the full product boundary ruling.

The OS is designed to be **domain-agnostic** — it has been validated against six
distinct verticals (marketing agency, insurance agency, software factory, finance
squad, internal marketing, school) with no structural changes required per
vertical. See ARCH-006.

---

## Deployment Topology

OpenHiveOS runs as a multi-service stack. In production the stack is managed by
Docker Compose; in development by PM2.

| Service | Description | Default Port |
|---|---|---|
| `mcp` | One MCP stdio server process per agent. Each agent runs as its own isolated process with its own `AGENT_TOKEN`. | stdio |
| `squad-api` | Express HTTP server serving the Dashboard SPA and the Squad API REST layer. | 3005 |
| `mcp-gateway` | SSE bridge between external integrations and the MCP stdio server. Enables HTTP/SSE clients to call MCP tools. | 3008 |
| `squad-runner` | Python multi-agent pipeline runner (external to this repo). Receives workflow dispatch from `trigger_workflow`. | 3010 |
| `postgres` | PostgreSQL 16 with pgvector extension. Single instance per Squad. | 5432 |

Agents are not services in the deployment sense — they are `AGENT_TOKEN`-scoped
processes. A Squad with 10 agents runs 10 `mcp` processes, each with one
identity, one tool allowlist, and one closed-over `agentSlug`.

---

## OS Primitives Tier

The Primitives tier is stable and deprecation-protected (ARCH-003). Tools in
this tier are available to all agents and will not be removed without a superseding
ADR. The five foundational tables (`agents`, `sops`, `memories`, `thoughts`,
`dispositions`) are the OS core.

### Agent Identity & Authentication

**Mechanism:** Process-level `AGENT_TOKEN` environment variable, validated at
boot via `crypto.timingSafeEqual` against a `token_hash` stored in the `agents`
table. Identity is resolved once at process startup and closed over in all MCP
tool handler registrations. No per-request token lookup occurs. See ARCH-008
Decision 7.

**Token rotation:** Supports a `previous_token_hash` with a `previous_token_expires_at`
window, enabling zero-downtime token rotation.

**Boot guards:** Three pre-flight checks run before the MCP server accepts any
connections:
1. **Fingerprint guard** — verifies that all required tables exist in Postgres
2. **Ethos Seal check** — HMAC-SHA256 comparison between `ethos.seal.json` and
   the `ethos_seals` table row. Fail is `process.exit(1)` — no degraded mode.
   See ARCH-013.
3. **Identity resolution** — `AGENT_TOKEN` validated and `agentSlug` resolved
   before any tool handler runs.

### Memory (`store_memory` / `search_memory`)

Agents store and retrieve persistent memories. Memories are embedded using
**Gemini text-embedding-004** (768 dimensions, pgvector cosine similarity) and
retrieved via a **hybrid ranking pipeline**: pgvector cosine retrieval as the
floor, followed by **Okapi BM25 re-ranking** over the candidate set.

Final score formula:

```
score = 0.6 × cosine_similarity + 0.4 × bm25_normalized
```

Memories are scoped to an agent via `agent_slug`. Optional `metadata` JSONB
supports structured filtering at query time.

**Storage:** `memories` table with pgvector index + GIN index on `metadata`.

### Thoughts (`store_thought` / `query_thoughts` / `ratify_thought`)

A thought is an agent's in-flight cognitive output — observations, plans,
concerns, flags. Thoughts have a lifecycle:

- `auto_persist_candidate` — flagged for potential promotion to memory
- `must_surface` — requires human or peer-agent attention before the session ends
- `ratified_at` — stamped when another agent (or the same agent) validates the
  thought

Thoughts use the same Gemini 768d embedding + BM25 hybrid retrieval as memories.
Ratification identity is always server-resolved from the bearer token — the
calling agent cannot self-assert a ratifying identity.

**Storage:** `thoughts` table with pgvector index, session/type compound indexes,
and a ratification queue index.

### Dispositions (`get_disposition` / `set_disposition`)

Each agent has a disposition profile: two continuous floats (`assertiveness`,
`energy`) plus a free-text `disposition_note`. Dispositions capture the agent's
current behavioral state — they are operator-mutable and agent-readable.

**Storage:** `dispositions` table (1:1 with `agents`).

### SOP Knowledge Base (`search_sops`)

Standard Operating Procedures are ingested as structured documents and embedded
at ingest time. Agents search the SOP corpus via the same hybrid ranking
pipeline used for memory search.

SOP ingest (`src/sops/ingest.ts`) accepts markdown files with gray-matter
frontmatter, extracts category and agent scope, generates the Gemini embedding,
and upserts by `source_path`.

**Storage:** `sops` table with pgvector index, category index, and unique
source_path index.

### Ethos Seal (`get_company_ethos`)

A tamper-evident identity anchor for the Squad's operator. The Ethos Seal is
an HMAC-SHA256 signed JSON artifact (`ethos.seal.json`) provisioned at Squad
init time. The signature is verified on every boot before any agent can
authenticate. Agents can read the company ethos content via the `get_company_ethos`
MCP tool. See ARCH-013.

---

## Coordination Utilities Tier

The Utilities tier is at active-development pace (ARCH-003). These tools are
the operational surface through which agents manage work. They connect to the OS
Primitives tier but are not part of the deprecation-protected core.

### Projects & Portfolio Matrix

Projects are the top-level unit of work. Every project has four scoring fields
that form the portfolio matrix:

| Field | Values | Meaning |
|---|---|---|
| `business_value` | 1 / 3 / 5 | How much value does this project deliver? |
| `strategic_fit` | 1 / 3 / 5 | How well does this align with strategic goals? |
| `effort` | 1 / 3 / 5 | How costly is this to execute? |
| `risk_index` | 1 / 3 / 5 | How likely is this to fail or cause harm? |

ROI score is computed on read (never stored):

$$\text{roi\_score} = \frac{\text{business\_value} \times \text{strategic\_fit}}{\text{effort}}$$

`null` on any field means "not yet scored." The 1/3/5 categorical scale is
enforced at the database (`CHECK`), Zod schema, and TypeScript type levels
simultaneously. See ARCH-021.

**MCP tools:** `create_project`, `query_projects`, `get_project_board`, `update_project`  
**REST:** `GET /api/projects`, `GET /api/projects/:slug`, `GET /api/projects/:slug/sprints`, `PATCH /api/projects/:slug`

### Tasks

Tasks belong to a project and track individual units of deliverable work. The
task state machine:

```
todo → wip → review → done
              ↓           ↓
           rework    pending-close
```

`pending-close` is a holding state that requires an explicit close confirmation
before the task is archived. See ARCH-023.

Tasks support an optional `github_pr_url` field and free-text `notes`. External
links to provider task systems (ClickUp, JIRA) are tracked in the separate
`external_task_links` table — not as columns on the task itself.

**Task metadata** (`metadata JSONB NOT NULL DEFAULT '{}'`) provides
operator-defined classification. Keys and values are set by the operator or
agent — no vocabulary is enforced by the OS. The column is GIN-indexed and
queryable via JSONB containment (`@>`) in both the MCP `query_tasks` tool and
the REST `GET /api/tasks?metadata=` filter.

Recommended (non-enforced) key conventions:

| Key | Type | Set By |
|---|---|---|
| `tags` | `string[]` | Agents / operators |
| `priority_label` | `string` | Agents / operators |
| `type` | `string` | Agents / operators |
| `source_provider` | `string` | Integration adapters (e.g. `'clickup'`) |
| `source_priority` | `string` | Integration adapters |
| `source_tags` | `string[]` | Integration adapters |

The ClickUp inbound adapter populates `source_provider`, `source_priority`, and
`source_tags` automatically on task creation from webhooks.

**MCP tools:** `create_task`, `query_tasks`, `update_task`  
**REST:** `GET /api/tasks`, `GET /api/tasks/:id`

### Sprints (`query_sprints` / `advance_sprint`)

Sprints group tasks into time-boxed delivery windows. `advance_sprint` closes
the current sprint and opens the next one, moving incomplete tasks forward
per the configured carry-over policy.

**REST:** `GET /api/projects/:slug/sprints`

### Crons (`create_cron` / `query_crons` / `update_cron` / `delete_cron`)

Agents register scheduled tool invocations against any registered MCP tool.
A cron stores a `schedule` (cron expression), a `tool_name`, and an optional
`payload`. The **CronWorker** polls for due crons, acquires `FOR UPDATE SKIP LOCKED`
row locks to prevent double-fire, and dispatches to the **ToolDispatcher**.

Currently registered handlers in the ToolDispatcher:
- `trigger_workflow` — forwards a typed payload (`triage` | `sprint`) to the
  squad-runner HTTP server at `127.0.0.1:3010/run`.

**Storage:** `crons` table. `last_run_at` and `next_fire_at` updated on each
execution. See ARCH-011.

---

## Background Workers

All workers implement graceful shutdown on `SIGTERM` — they finish the current
batch before exiting.

| Worker | Poll Interval | Responsibility |
|---|---|---|
| `CronWorker` | Configurable (default per cron schedule) | Executes due crons via ToolDispatcher. Uses `FOR UPDATE SKIP LOCKED` to prevent double-fire. |
| `SyncWorker` | Polls `sync_queue` | Dispatches outbound task sync to external providers (ClickUp). At-least-once delivery. Max 3 retries with exponential backoff. |
| `InboundWorker` | 10s poll | Processes `inbound_events` rows (from webhook intake). Routes to provider adapter. At-least-once delivery. |
| `ToolDispatcher` | Event-driven | Routes `RegisteredToolName` invocations to registered handler functions. No tool = no-op, not an error. |

---

## External Integrations

Integration architecture is **provider-agnostic** via the `IntegrationAdapter`
interface. Providers are opt-in via `{PROVIDER}_ENABLED` env var. The system
operates normally with zero providers enabled. See ARCH-024.

### ClickUp (Live)

- **Inbound webhook:** `POST /clickup` with HMAC-SHA256 signature verification.
  Events are deduped by `clickup_event_id` and written to `inbound_events` for
  async processing by InboundWorker.
- **Triage inbox:** Inbound ClickUp tasks surface via `GET /api/integrations/triage`.
  Operators review and promote items via `PATCH /api/integrations/triage/:id/promote`.
- **Outbound sync:** Task state changes are queued in `sync_queue` and dispatched
  asynchronously by SyncWorker. OpenHiveOS is the system of record; ClickUp is
  the view layer. Sync latency: 10–30 seconds (eventual consistency, accepted
  per ARCH-024).
- **Task linking:** Each OpenHiveOS task can be linked to one ClickUp task per
  provider via `external_task_links` (`task_id`, `provider`, `external_id`,
  `external_url`, `sync_state`).
- **Integration status:** `GET /api/integrations/status`

### JIRA (Stub — not yet live)

Adapter registered in the integration registry. Client and status-map stubs
implemented. Not enabled until a future sprint activates the config and
inbound handler.

---

## LLM Usage Tracking

Agents call `report_usage` after each loop to record model, token counts, and
cost. Data is ingested via the `POST /internal/usage` endpoint (separate
`ingestionAuth` middleware, rate-limited independently of the agent API). See
ARCH-015.

**REST:** `GET /api/usage/agents`, `GET /api/usage/agents/:name`, `GET /api/usage/tasks/:id`  
**Storage:** `llm_usage` table + `tool_invocations` table (fire-and-forget, per-call telemetry).

---

## MCP Tool Surface (23 tools)

All tools are registered on the MCP stdio server and gated by the process-level
`AGENT_TOKEN`. Tool access is controlled by tool-assignment in `squad.manifest.json`
— the manifest is the access gate, not endpoint ownership.

| Category | Tools |
|---|---|
| **Memory** | `store_memory`, `search_memory` |
| **Thoughts** | `store_thought`, `query_thoughts`, `ratify_thought` |
| **Disposition** | `get_disposition`, `set_disposition` |
| **SOPs** | `search_sops` |
| **Identity** | `get_company_ethos` |
| **Projects** | `create_project`, `query_projects`, `get_project_board`, `update_project` |
| **Tasks** | `create_task`, `query_tasks`, `update_task` |
| **Sprints** | `query_sprints`, `advance_sprint` |
| **Crons** | `create_cron`, `query_crons`, `update_cron`, `delete_cron` |
| **Telemetry** | `report_usage` |

---

## Squad API — REST Surface

The Squad API is an Express HTTP server that serves both the Dashboard SPA (static
files) and the REST API consumed by the Dashboard and external tools. All `/api`
routes require agent bearer auth. The `/internal` prefix uses a separate
ingestion token and rate limiter.

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Service health check. Returns `status`, `db`, `version`. |
| `GET` | `/api/agents` | List all agents in the squad manifest. |
| `GET` | `/api/agents/:slug` | Get a single agent by slug. |
| `GET` | `/api/ethos-seal` | Read the active Ethos Seal record. |
| `GET` | `/api/projects` | List all projects with ROI scores. Filterable by `status`, `owner_agent_slug`. |
| `GET` | `/api/projects/:slug` | Get a single project board with task counts and task list. |
| `GET` | `/api/projects/:slug/sprints` | List sprints for a project. |
| `PATCH` | `/api/projects/:slug` | Update portfolio matrix fields (`business_value`, `strategic_fit`, `effort`, `risk_index`). |
| `GET` | `/api/tasks` | List tasks. Filterable by `project_id`, `status`, `assignee_agent_slug`. |
| `GET` | `/api/tasks/:id` | Get a single task with external link details. |
| `GET` | `/api/thoughts` | Query agent thoughts. |
| `GET` | `/api/sops` | List and search SOPs. |
| `GET` | `/api/usage/agents` | LLM usage summary per agent. |
| `GET` | `/api/usage/agents/:name` | LLM usage detail for a specific agent. |
| `GET` | `/api/usage/tasks/:id` | LLM usage attributed to a specific task. |
| `GET` | `/api/integrations/status` | Active integration adapter status. |
| `GET` | `/api/integrations/triage` | Inbound external task triage inbox. |
| `PATCH` | `/api/integrations/triage/:id/promote` | Promote a triage item into a project task. |
| `POST` | `/clickup` | ClickUp webhook intake (HMAC-verified, rate-limited). |
| `POST` | `/internal/usage` | LLM usage ingestion (ingestion token auth). |

---

## Dashboard (packages/dashboard)

A Vue 3 SPA served by the Squad API. Built with Vite and Tailwind CSS v4 (CSS-first
configuration via `@tailwindcss/vite`). Design tokens follow the IO Labs
neo-brutal Surface B spec via custom CSS properties (`--io-*`).

| View | Description |
|---|---|
| Dashboard Home | Projects overview widget. Summary stats. |
| Projects | Full project list with ROI scores and status. |
| Portfolio Chart | Bubble chart of all projects on the ROI matrix (Chart.js + vue-chartjs). |
| Agents | Agent roster from the squad manifest. Agent detail full-page route. |
| Tasks | Task list with status filtering. |
| Triage Inbox | External task queue from ClickUp. Promote-to-project action. |
| LLM Usage | Usage analytics per agent and per task. |
| Org Chart | Visual agent relationship map. |

---

## MCP Gateway (packages/mcp-gateway)

An SSE bridge that allows HTTP clients (external integrations, the Telegram
bridge, etc.) to call MCP tools without speaking the MCP stdio protocol directly.
Runs as a sidecar service (`openhiveos-mcp-gateway` in Docker Compose). See
ARCH-016.

---

## Database Schema

PostgreSQL 16 + pgvector. 15 tables across 19 migrations.

| Table | Purpose | Tier |
|---|---|---|
| `agents` | Agent identity, token hashes, active flag | OS Primitive |
| `memories` | Agent long-term memory store (pgvector) | OS Primitive |
| `thoughts` | Agent in-flight cognitive output (pgvector) | OS Primitive |
| `sops` | Standard Operating Procedures (pgvector) | OS Primitive |
| `dispositions` | Agent behavioral state (assertiveness, energy) | OS Primitive |
| `ethos_seals` | Operator identity anchor (HMAC-SHA256) | OS Primitive |
| `projects` | Project registry with portfolio matrix scoring | Coordination Utility |
| `tasks` | Task state machine per project | Coordination Utility |
| `sprints` | Time-boxed delivery windows | Coordination Utility |
| `crons` | Scheduled tool invocations | Coordination Utility |
| `llm_usage` | LLM token and cost records per agent/model | Telemetry |
| `tool_invocations` | Per-call tool telemetry (fire-and-forget) | Telemetry |
| `external_task_links` | Provider-agnostic task-to-external-system links | Integration |
| `sync_queue` | Outbound provider sync queue (async worker) | Integration |
| `inbound_events` | Inbound webhook event queue (async worker) | Integration |

---

## Known Gaps (as of 2026-06-27)

These are documented here to make the gap between capability and completeness
visible — not as defects requiring immediate action, but as honest constraints
on what agents and operators can rely on today.

| Gap | Impact | Tracked In |
|---|---|---|
| No project-level external reference links (`project_links`) | Agents cannot query a project's repo, staging environment, or external system anchor. Visibility requires human memory or manual search. | Backlog |
| Nova has no MCP read tools (`tools: []` in manifest) | Strategic synthesis is built from narrative memory, not live DB state. Reports cannot be grounded in current project data. | Backlog |
| Test coverage: 8.6% (49/65 files at zero coverage) | No automated regression signal. Breakage is detected in production, not CI. | S15 backlog |
| No E2E test framework | All route-level and UI-level behavior is manually verified. | S15 backlog |
| No pre-deploy git status gate | Production code can run uncommitted (confirmed: 4 items currently uncommitted). | Immediate |
| JIRA adapter is a stub | JIRA integration is registered but not operational. | Future sprint |
