---
title: "OpenHiveOS — Documentation Index"
date: 2026-05-20
tags:
  - project/openhiveos
  - type/index
---

# OpenHiveOS — Documentation Index

This index covers all documents in the OpenHiveOS docs folder. Every architectural decision from the OpenSquad MCP Server ARCH-001 through ARCH-006 reviews is inherited by OpenHiveOS and filed here as the canonical record.

---

## Project Documents

| File | Description |
|---|---|
| [00-inception.md](00-inception.md) | Project inception, product definition, brand, stack, and inception sprint task board |

---

## Tool Reference Guides

Agent-usable guides for interacting with the MCP tool surface. Start here if you want to call a tool.

| File | Description |
|---|---|
| [coordination-utilities-reference.md](coordination-utilities-reference.md) | Complete input/output reference for all 8 Coordination Utility tools: `create_project`, `update_project`, `query_projects`, `get_project_board`, `create_task`, `update_task`, `query_tasks`, `advance_sprint` |
| [cron-utilities-reference.md](cron-utilities-reference.md) | Complete input/output reference for all 5 Cron Utility tools: `create_cron`, `update_cron`, `query_crons`, `delete_cron`, `query_sprints`. Covers the cron expression format, tool_name allowlist (SEC-26), and the soft-delete model. |

---

## Architectural Decision Records (ADRs)

| File | Decision Summary |
|---|---|
| [ARCH-001-server-resolved-agent-identity.md](ARCH-001-server-resolved-agent-identity.md) | Agent identity is resolved server-side from the bearer token — the caller cannot lie about who they are |
| [ARCH-002-pgvector-backend-pk-convention.md](ARCH-002-pgvector-backend-pk-convention.md) | MemPalace rows use a deterministic UUID soft reference in `metadata` JSONB — not a foreign key — to enable stable upserts without schema changes |
| [ARCH-003-formalize-agent-os-linear-next.md](ARCH-003-formalize-agent-os-linear-next.md) | OpenSquad formally designated Agent OS — two-tier model (OS Primitives + Coordination Utilities) adopted, 6/6 votes in response to Linear Next launch |
| [ARCH-004-agent-os-consolidation.md](ARCH-004-agent-os-consolidation.md) | Three consolidation decisions: shared-DB contract with openBridge (1A), build-time dashboard embed into squad-api (3A), Docker Compose productization target (2A) |
| [ARCH-005-agent-os-canonical-architecture.md](ARCH-005-agent-os-canonical-architecture.md) | TypeScript module decomposition (`src/primitives/` + `src/utilities/`) selected immediately; two-service MCP split declared as Sprint 4+ architectural target |
| [ARCH-006-agent-os-product-boundary.md](ARCH-006-agent-os-product-boundary.md) | One-OS-Per-Squad (federated deployment) is the product definition — unanimous 7/7 across all seats; Squad is the atomic deployment unit |
| [ARCH-007-openhiveos-codebase-strategy.md](ARCH-007-openhiveos-codebase-strategy.md) | Option C (Selective Extraction) chosen unanimous 8/8 — fresh scaffold + per-primitive extraction from OpenSquad MCP Server with SEC review; Option B blocked by Locksmith (OWASP A02:2021); SEC-14 through SEC-20 binding conditions established |
| [ARCH-009-sop-seeding-operator-onboarding.md](ARCH-009-sop-seeding-operator-onboarding.md) | SOP seeding via `seeds/sops/` `.md` files ingested at boot; two-namespace model (core/operator); agentic-first authoring standard; operator onboarding UX; 4/4 unanimous. Deferred to Onboarding Sprint. |
| [ARCH-010-coordination-utilities-schema.md](ARCH-010-coordination-utilities-schema.md) | Coordination Utilities schema: `projects`, `tasks`, `sprints` tables + 8 utility query contracts; SEC-21–25 binding conditions; deferred FK activation on `memories`/`thoughts`; cron tier deferred to Sprint 4. Accepted. |
| [ARCH-011-cron-utilities-schema.md](ARCH-011-cron-utilities-schema.md) | Cron Utilities schema: `crons` table, soft-delete model (D1), caller-scoped `query_sprints` (D2), Dockerfile deferred (D3); SEC-26–30 binding conditions. Accepted 2026-05-20. |
| [ARCH-012-squad-api-dashboard-architecture.md](ARCH-012-squad-api-dashboard-architecture.md) | Squad API + Dashboard: 4-service Compose topology, Express/TypeScript ESM on port 3005, Vue 3 SPA embedded at build time, agent bearer token auth (`dashboard` principal), `openhiveos_reader` SELECT-only DB role. Option A unanimous; Options B and C blocked. SEC-A1 through SEC-A6 binding merge gates. Decided 2026-05-21. |
| [ARCH-013-the-one-ethos-seal.md](ARCH-013-the-one-ethos-seal.md) | The One inside OpenHiveOS: `ethos_seals` DB table + `scripts/one-init.ts` CLI + exported `ethos.seal.json`. HMAC-SHA256 v0.2 interim (Ed25519 required v0.3). Boot-time integrity check blocks on drift. `GET /api/ethos-seal` metadata default. `counter_thought` stays optional (Richo Option S). Option A unanimous; Options B and C blocked. SEC-B1 through SEC-B10 binding. Decided 2026-05-21. |
| [ARCH-014-agent-onboarding-dynamic-provisioning.md](ARCH-014-agent-onboarding-dynamic-provisioning.md) | Agent Onboarding + Dynamic Provisioning: `provision-all-agents.ts` sibling script + targeted additions to `provision-agent-token.ts`. `ON CONFLICT DO NOTHING` default batch; `--force-rotate --confirm` for rotation. `--write-env` mandatory for batch (SEC-C3). `PROVISION_ENV_DIR` path allowlist. DB sentinel gate enforces `one-init` → `provision` ordering. SHA-256 confirmed (not bcrypt). Canonical operator onboarding sequence: Stage 1 `one-init`, Stage 2 `provision`, Stage 3 `dashboard`. Option A permanently blocked (OWASP A02); Option C deferred to v0.3. SEC-C1 through SEC-C8 binding. Decided 2026-05-21. |
| [ARCH-015-llm-usage-tracking.md](ARCH-015-llm-usage-tracking.md) | LLM Usage Tracking: `POST /internal/usage` ingestion endpoint on squad-api + `005_llm_usage.sql` schema (or `006` — OQ-1). Option A permanently blocked: Cooper (stdio-transport incompatibility — Bridge cannot call MCP tools externally) + Locksmith (OWASP A01 unscoped write surface). Option B permanently blocked: Locksmith (OWASP A02 cross-system credential + A10 SSRF + A09 silent cron failure — three simultaneous class violations). Option C: scoped `OPENHIVEOS_INGESTION_TOKEN` bearer auth, `crypto.timingSafeEqual`, Zod validation, `UNIQUE (session_id, loop_index)` replay guard. No `llm_model_pricing` table. 3 analytical views (`v_cost_by_agent_month`, `v_cost_by_project_month`, `v_cost_by_task`). Feature provisioned-but-dark until Bridge deploys (T-01 spike). SEC-C1 through SEC-C10 binding. Bridge registry design deferred to Sprint 5+ (Nova). Canonical onboarding Stages 4+5 added. Decided 2026-05-21. |
| [ARCH-016-integration-pattern-mcp-gateway.md](ARCH-016-integration-pattern-mcp-gateway.md) | Integration Pattern: `openhiveos-mcp-gateway` sidecar container (port 3006, Compose-internal only) as the canonical pattern for connecting external integrations (nova-telegram-bridge, openBridge) to a stdio-bound Squad Instance. Option A permanently blocked: Murphy (OWASP A09 — ARCH-001 dual-process identity race) + Locksmith (OWASP A09 — audit trail integrity). Option B permanently blocked: Locksmith (OWASP A01 — `openhiveos_reader` elevation destroys ARCH-015 PoLP). Bridge connects via `SSEClientTransport` to gateway; gateway spawns MCP subprocess via `StdioClientTransport`. `MCP_GATEWAY_TOKEN` as `?token=` query param, `crypto.timingSafeEqual`. SEC-D1 through SEC-D11 binding (SEC-D3 log token redaction is highest implementation risk). `integration` Compose profile. Stage 6 added to canonical operator onboarding. openBridge stays external PM2 — does NOT enter Compose stack (SEC-13). 3 open questions E1–E3. Decided 2026-05-21. |

---

## Meeting Minutes — ARCH Reviews

| File | Meeting Summary |
|---|---|
| [meeting-minutes/2026-05-19-arch-review-linear-next-opensquad-positioning.md](meeting-minutes/2026-05-19-arch-review-linear-next-opensquad-positioning.md) | ARCH-003 review — Linear Next strategic positioning; Option C (Agent OS) decided 6/6; Option B vetoed by Locksmith |
| [meeting-minutes/2026-05-20-arch-review-agent-os-consolidation.md](meeting-minutes/2026-05-20-arch-review-agent-os-consolidation.md) | ARCH-004 review — openBridge service boundary, dashboard embed strategy, Docker Compose productization; eight Locksmith SEC conditions raised |
| [meeting-minutes/2026-05-20-arch-review-agent-os-canonical-architecture.md](meeting-minutes/2026-05-20-arch-review-agent-os-canonical-architecture.md) | ARCH-005 review — canonical architecture options (TypeScript monolith vs Python greenfield vs two-service split); Option 1 selected, Option 3 declared target |
| [meeting-minutes/2026-05-20-arch-review-agent-os-product-boundary.md](meeting-minutes/2026-05-20-arch-review-agent-os-product-boundary.md) | ARCH-006 review — six-vertical stress test of product boundary; Option B (federated) wins 7/7; SEC-9 through SEC-13 conditions raised |
| [meeting-minutes/2026-05-20-arch-review-openhiveos-codebase-strategy.md](meeting-minutes/2026-05-20-arch-review-openhiveos-codebase-strategy.md) | ARCH-007 review — OpenHiveOS codebase strategy; Option C (Selective Extraction) wins 8/8; Option B blocked (Locksmith + Cooper); SEC-14 through SEC-20 established |
| [meeting-minutes/2026-05-20-sprint-3-planning.md](meeting-minutes/2026-05-20-sprint-3-planning.md) | Sprint 3 kick-off — Coordination Utilities tier scope confirmed; ARCH-010 architecture session; Richo decisions on `advance_sprint` semantics and sprint goal history; task board created |
| [meeting-minutes/2026-05-20-sprint-4-planning.md](meeting-minutes/2026-05-20-sprint-4-planning.md) | Sprint 4 kick-off — Cron Utilities tier scope confirmed; ARCH-011 architecture session; Richo decisions on soft delete (D1), caller-scoped sprints (D2), Dockerfile deferral (D3); SEC pre-flight and blocker F-1 cleared; v0.1.0 Definition of Done established |
| [meeting-minutes/2026-05-21-arch-review-squad-api-dashboard.md](meeting-minutes/2026-05-21-arch-review-squad-api-dashboard.md) | ARCH-012 review — Squad API + Dashboard service boundary, port assignment, auth model; Option A unanimous (5/5 seats); Options B and C blocked; SEC-A1 through SEC-A6 binding; PRE-1 and PRE-2 hard gates; 10 action items assigned |
| [meeting-minutes/2026-05-21-arch-review-the-one-ethos-seal.md](meeting-minutes/2026-05-21-arch-review-the-one-ethos-seal.md) | ARCH-013 review — The One inside OpenHiveOS: Ethos Seal storage, CLI provisioning, Dashboard surface; Option A unanimous (5/5 seats); Options B and C blocked; SEC-B1 through SEC-B10 binding; PRE-A1 hard gate; 15 action items assigned; ARCH-014 unblocked |
| [meeting-minutes/2026-05-21-arch-review-agent-onboarding-dynamic-provisioning.md](meeting-minutes/2026-05-21-arch-review-agent-onboarding-dynamic-provisioning.md) | ARCH-014 review — Agent Onboarding + Dynamic Provisioning; Option B unanimous (5/5 + Locksmith approved); Option A permanently blocked (OWASP A02); Option C deferred to v0.3; SHA-256 confirmed correct; SEC-C1 through SEC-C8 binding; PRE-A1 confirmed as gate for both ARCH-013 and ARCH-014; 15 action items assigned |
| [meeting-minutes/2026-05-21-arch-review-llm-usage-tracking.md](meeting-minutes/2026-05-21-arch-review-llm-usage-tracking.md) | ARCH-015 review — LLM Usage Tracking; Option C unanimous (only viable option); Option A permanently blocked (Cooper: stdio-transport incompatibility + Locksmith: OWASP A01 unscoped write); Option B permanently blocked (Locksmith: OWASP A02+A10+A09 — three simultaneous class violations); SEC-C1 through SEC-C10 binding; Bridge registry design deferred to Sprint 5+; PRE-A1 now gates ARCH-013, ARCH-014, and ARCH-015 simultaneously; 15 action items D1–D15 assigned |
| [meeting-minutes/2026-05-21-arch-review-integration-pattern-mcp-gateway.md](meeting-minutes/2026-05-21-arch-review-integration-pattern-mcp-gateway.md) | ARCH-016 review — Integration Pattern (nova-telegram-bridge + Compose profile); Option C unanimous (7/7); Option A blocked (Murphy: ARCH-001 dual-process identity race + Locksmith: OWASP A09); Option B blocked permanently (Locksmith: OWASP A01 — `openhiveos_reader` elevation); SEC-D1 through SEC-D11 binding; SEC-D3 (log token redaction) highest implementation risk; port 3006 confirmed free (Cooper); ARCH-015 D15 trigger condition amended (Nova); openBridge stays external PM2; 3 open questions E1–E3; 17 action items F-series assigned |

---

## Canonical Taxonomy

The following terms are locked by ARCH-006 and govern all OpenHiveOS documentation. See [ARCH-006](ARCH-006-agent-os-product-boundary.md) for full definitions.

| Term | One-line definition |
|---|---|
| **Agent OS** | The cognitive infrastructure layer — memory, identity, SOPs, agent registry, token lifecycle, coordination primitives |
| **Squad** | One complete, physically isolated Agent OS deployment — the atomic product unit |
| **Squad Instance** | A running Squad deployment (one Docker Compose stack, own DB, own tokens) |
| **Integration** | Any system external to the Agent OS, consuming the Coordination Utilities tier only |
| **Inter-Squad Bridge** | Communication channel between Squad Instances (currently: openBridge via Ed25519/TOFU) |
| **Operator** | Entity that deploys and manages one or more Squad Instances |
| **Managed Hive** | IO Labs as both vendor and Operator — full visibility, slider ownership |
| **Self-Hosted Deployment** | Operator runs their own Squad Instance on their own infrastructure |

---

*Index maintained by Clarence. Last updated: 2026-05-21 (ARCH-016 decided — Integration Pattern: `openhiveos-mcp-gateway` sidecar. Option C: dedicated mcp-gateway container, port 3006 Compose-internal, `integration` Compose profile. Options A and B permanently blocked. Stage 6 added to canonical operator onboarding. ADR and meeting minutes added. E1–E3 open questions pending Sprint 4).*
