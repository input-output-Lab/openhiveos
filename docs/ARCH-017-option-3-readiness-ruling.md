---
title: "ARCH-017 — Option 3 Readiness Ruling: Sprint 7 Pre-Condition Gate Assessment"
date: 2026-05-21
status: Decided
decision_owner: Silas
approved_by: Elizabeth
filed_by: Clarence
tags:
  - type/adr
  - project/openhiveos
  - domain/architecture
  - domain/backend
  - domain/devops
  - domain/security
related:
  - "[[ARCH-003-formalize-agent-os-linear-next]]"
  - "[[ARCH-004-agent-os-consolidation]]"
  - "[[ARCH-005-agent-os-canonical-architecture]]"
  - "[[ARCH-006-agent-os-product-boundary]]"
  - "[[ARCH-008-openhiveos-founding-decisions]]"
  - "[[ARCH-010-coordination-utilities-schema]]"
  - "[[ARCH-012-squad-api-dashboard-architecture]]"
  - "[[ARCH-013-the-one-ethos-seal]]"
  - "[[ARCH-014-agent-onboarding-dynamic-provisioning]]"
  - "[[ARCH-016-integration-pattern-mcp-gateway]]"
---

# ARCH-017 — Option 3 Readiness Ruling: Sprint 7 Pre-Condition Gate Assessment

**Status:** Decided
**Date:** 2026-05-21
**Decision Owner:** Silas
**Approved By:** Elizabeth
**Filed By:** Clarence
**Gate Type:** S7-00 (Sprint 7 Day 0 architectural gate)

---

## Purpose

ARCH-005 declared Option 3 — Two-Service MCP Architecture — as the architectural target for Sprint 4+, gated on two explicit pre-conditions and one conditional stability gate from Murphy's review. As of Sprint 7 Day 0, three additional sprints have shipped since ARCH-005 was filed. This ADR is the formal ruling on whether those pre-conditions are met and whether Option 3 may begin in Sprint 8.

---

## Pre-Condition 1 — ARCH-003 Conditions 2 and 3 Closed

**ARCH-005 gate text:** *"ARCH-003 Conditions 2 and 3 must be closed. Without these, Option 3 cannot begin."*

### Condition 2 — Tier Boundary Governance Authority

**Status: OPEN (formally). Functionally resolved.**

What was required: a named, binding authority for deciding whether a capability is an OS Primitive or a Coordination Utility, with a documented decision process.

What has shipped:
- `src/primitives/` and `src/utilities/` directory separation executed in the inception sprint (ARCH-007, ARCH-008).
- ESLint `no-restricted-imports` boundary rule enforced in CI with `--max-warnings 0` (ARCH-008 D2). Any import from `src/primitives/**` into `src/utilities/**` fails the pipeline.
- All Sprint 3–6 work (Coordination Utilities, Cron Utilities, Ethos Seal, Agent Provisioning, LLM Usage) was classified to the correct tier before merge. No boundary dispute required escalation.

What has NOT shipped: A formal one-paragraph closure declaration for Condition 2. The ARCH-003 text named the obligation — "Silas + Nova to resolve before this ADR is filed" — but no standalone closure filing exists. The governance decision (Silas holds deciding vote; 48-hour RFC comment window for reclassifications) is stated in ARCH-003 itself and has operated by practice. It has not been filed as a ratified addendum.

**Ruling:** Condition 2 is functionally closed. The enforcement mechanism is live and has operated correctly across five sprints without a boundary dispute. The formal closure declaration is overdue and must be filed as a one-paragraph ARCH-003 addendum in Sprint 7, signed by Silas, before Option 3 begins. This is an administrative close, not a substantive open question.

**Required action:** Silas files ARCH-003-addendum-c2-close.md in Sprint 7. Clarence archives.

---

### Condition 3 — MemPalace Vector Store Authority (pgvector vs ChromaDB)

**Status: OPEN (formally). Closed by operational precedent.**

What was required: a declared answer to whether pgvector (ARCH-002) remains the sole authoritative vector store, or whether ChromaDB becomes co-equal or authoritative — with implications for the Docker Compose topology and the ARCH-004 2A service count.

What has shipped:
- pgvector has operated as the sole vector store through all six sprints. No ChromaDB service has been introduced.
- The Docker Compose 2A topology (ARCH-004), as designed and carried forward through Sprint 4 deferral, includes only the `postgres` service for vector storage. No ChromaDB entry.
- The `factory_memory` schema (ARCH-002 PK convention, pgvector backend) has been stable since `001_init.sql`. No migration has touched its indexing strategy.
- ARCH-010 Sprint 3 Coordination Utilities shipped without requiring a separate vector store. ARCH-013/014/015 (Ethos Seal, Agent Provisioning, LLM Usage) — none require ChromaDB.

What has NOT shipped: A formal "pgvector remains sole authority" declaration. The ARCH-003 text flagged ChromaDB as a live question. That question has been answered by six sprints of production operation without ChromaDB, but no ADR records the answer.

**Ruling:** Condition 3 is closed by operational precedent. The question was whether the Docker Compose topology needed a ChromaDB service. Six sprints of operation have answered it: no. pgvector is the sole vector store authority. The MemPalace Phase 3/4 cross-encoder reranker requirement (Murphy's stated trigger for revisiting the Python/language question) has not been reached. A formal one-sentence ARCH-003 addendum records the answer and closes the condition.

**Required action:** Silas files ARCH-003-addendum-c3-close.md in Sprint 7. Clarence archives. The closure ruling is: *pgvector (postgres, ARCH-002) is the sole authoritative vector store for OS Primitive memory operations. ChromaDB is not introduced in the Sprint 4+ Docker Compose topology. This decision is revisited only if MemPalace Phase 3/4 requires a cross-encoder reranker — Murphy's declared trigger, unchanged.*

---

### Pre-Condition 1 Verdict

**OPEN — Administrative close required in Sprint 7.**

Both conditions are substantively answered. Neither requires new work. Both require a two-paragraph filing each. This is a one-day task for Silas, not a sprint-length obligation. Formally OPEN until filed.

---

## Pre-Condition 2 — ARCH-004 SEC-1 through SEC-8 Closed

**ARCH-005 gate text:** *"ARCH-004 SEC-1–SEC-8 must be closed. Without these, Option 3 cannot begin."*

**ARCH-005 additional note on SEC-8:** *"Becomes more complex under Option 3 (two migrate-init containers or serialized ordering). Must be re-reviewed before Option 3 executes."*

### Current Status by Condition

| Condition | Description | Status | Evidence |
|---|---|---|---|
| SEC-1 | CORS allowlist startup validation | **CLOSED** | ARCH-012 Decision: startup validation required; empty allowlist = process exit. Squad-api implemented. |
| SEC-2 | CSP strict-mode-first protocol | **CLOSED** | ARCH-012 consequence binding. Mermaid `securityLevel: 'strict'` tested first per decision text. |
| SEC-3 | `openbridge_app` role scope audit | **CLOSED** | Role scope confirmed in memory record (2026-05-20): SELECT on factory_tasks/projects/crons only; zero grants on OS Primitives. Written confirmation from Silas on record. |
| SEC-4 | Migration linter CI coverage | **UNCONFIRMED** | ARCH-004 required migration linter in CI pipeline for both repos. No explicit "linter is live" confirmation in any ADR or planning doc through Sprint 6. |
| SEC-5 | `dist/` gitignore verification | **CLOSED** | ARCH-012 consequence: `.gitignore` entry required, verified by `git status` post-build. Squad-api repo shipped this. |
| SEC-6 | Pre-commit hook coverage | **OPEN** | Docker Compose install guide prerequisite. Dockerfile deferred Sprint 4, deferred Sprint 5, targeted Sprint 6. No explicit closure confirmation in the documentary record. |
| SEC-7 | `opensquad_migrate` role isolation | **UNCONFIRMED** | Container-specific gate. Docker Compose productization was deferred to Sprint 5, then Sprint 6. No explicit closure evidence found. |
| SEC-8 | Trivy scan acceptance criteria in pipeline | **OPEN — AND REQUIRES RE-REVIEW** | Same timeline as SEC-7. Explicitly flagged in ARCH-005 as requiring re-review under Option 3 (two migrate-init containers or serialized ordering). Even if closed for the current single-service topology, it is not closed for Option 3. |

**Additionally:** ARCH-006 (filed 2026-05-20, same date as ARCH-005) added SEC-9 through SEC-13 as binding Locksmith conditions for the federated deployment model (one-OS-per-Squad). These were not in scope of the original ARCH-005 gate, but they are blocking conditions for any production deployment of the extended topology that Option 3 requires. Specifically:

- **SEC-9** (squad registry manifest no-secrets, pre-commit hook extended): Extends SEC-6's scope.
- **SEC-10** (boot fingerprint stored in DB — startup mismatch = hard boot failure): Implemented in ARCH-013 as `checkEthosSeal()`. **CLOSED** for the ethos seal context.
- **SEC-11** (per-Squad PostgreSQL role provisioning): Required before any Squad Instance is provisioned to an external operator. Not blocking for internal IO Labs operation, but blocking for the productization milestone that Option 3 enables.
- **SEC-12** (PostgreSQL no external ports, per-Squad network isolation): Docker Compose Compose-level gate. Shares timeline with SEC-7.
- **SEC-13** (inter-Squad communication moratorium until ZTNA ADR ratified): Does not block Option 3 single-Squad internal operation. Does block multi-Squad external deployment.

### Pre-Condition 2 Verdict

**OPEN — SEC-4, SEC-6, SEC-7, SEC-8 closure unconfirmed or explicitly open. SEC-8 requires a new re-review specific to Option 3 topology before Option 3 execution regardless of its single-service closure status.**

This is not an administrative close. SEC-6, SEC-7, and SEC-8 require implementation verification from Cooper and a Locksmith sign-off. SEC-8 requires a new Locksmith review scoped specifically to the two-service init container ordering problem identified in ARCH-005.

---

## Murphy's "2 Consecutive Stable Sprints" Gate

**ARCH-005 conditional gate (Murphy's review):** *"Option 3 when Primitives contracts are stable for 2 consecutive sprints."*

### Assessment

The Primitives tier MCP tool contracts (the externally-visible tool signatures for `store_memory`, `search_memory`, `store_thought`, `query_thoughts`, `store_sop`, `search_sops`, `get_disposition`, `set_disposition`, and `get_agent_identity`) have not changed their signatures or behavioral contracts since `001_init.sql` was deployed. Sprints 3, 4, 5, and 6 all added to the Coordination Utilities tier without modifying existing Primitives tool contracts.

One ambiguity: Sprint 5 (ARCH-013) added the Ethos Seal to the Primitives tier — a net-new table (`ethos_seals`), a new boot-time check (`checkEthosSeal()`), and a new squad-api endpoint (`GET /api/ethos-seal`). This is additive. It does not change any existing Primitives tool contract. Whether "stable" means "frozen" (no additions) or "non-breaking" (no changes to existing contracts) determines this gate's status.

**Ruling:** Under the non-breaking definition, Murphy's gate is **CONDITIONALLY MET**. Existing Primitives tool contracts have been stable for at minimum Sprints 5 and 6 (two consecutive sprints). Sprint 7 must not introduce any Primitives tool contract changes for this gate to remain valid at Sprint 8 kick-off. Murphy must provide an explicit written confirmation at Sprint 8 Day 0 that the Primitives contract set is frozen for extraction.

Under the frozen definition, the gate is **NOT MET** — Sprint 5 added Ethos Seal to the Primitives tier. In this case, Sprint 7 (no Primitives additions) + Sprint 8 kick-off confirmation would be the earliest possible clearance.

**Recommended resolution:** Silas and Murphy align on the definition of "stable" in Sprint 7. The non-breaking interpretation is the architecturally correct one — the two-service split does not require the Primitives tier to be feature-complete, only contract-stable. Additive changes to the Primitives tier can proceed in Option 3 via the Primitives service directly.

---

## New Pre-Conditions Identified Since ARCH-005

Three new conditions have emerged across Sprints 4–6 that were not in scope when ARCH-005 was filed. They do not invalidate Option 3 — they refine it.

### NPC-1 — ARCH-016 mcp-gateway Topology Collision

ARCH-016 (filed 2026-05-21) introduced the `openhiveos-mcp-gateway` sidecar container as the canonical pattern for connecting external integrations (nova-telegram-bridge) to an stdio-only MCP server. The gateway spawns one MCP server as a stdio child process and exposes it as SSE on port 3006 internally.

Option 3 creates two stdio MCP servers: the OS Primitives service and the Coordination Utilities service. ARCH-016's current design assumes one gateway → one server. The two-service split requires one of:
- **Option NPC-1A:** Two independent gateways (one per service), each spawning its own stdio child. Clean but doubles the operational footprint and requires two port allocations (3006 for Primitives, 3007 for Utilities).
- **Option NPC-1B:** One routing gateway that spawns both MCP servers as stdio children and routes tool calls by tier (Primitives tool names → Primitives server; Utilities tool names → Utilities server). Single operational unit. Adds routing logic to the gateway.

Neither option is designed. This is a **new architectural decision required before Option 3 implementation begins.** It directly affects Cooper's Docker Compose 2A topology update (now 6 services, not 5).

**Gate:** Silas files an ARCH-017 addendum or a new ADR resolving NPC-1 before Sprint 8 Day 1.

### NPC-2 — ARCH-013/014 Primitives Infrastructure Mid-Build

The Ethos Seal (ARCH-013) and Agent Provisioning pipeline (ARCH-014) are active Sprint 5+ deliverables that both belong to the OS Primitives tier. The Ethos Seal adds `ethos_seals` table and `checkEthosSeal()` — a new boot-time integrity gate. Agent Provisioning adds `provision-all-agents.ts` and the `--revoke` flag to the single-agent script.

Option 3 extracts the Primitives tier into its own service. Extracting a partially-built service mid-sprint is architecturally unsafe. The Primitives tier must be functionally stable — not in active development — before extraction begins. If ARCH-013/014 open conditions (PRE-A1, PRE-B1, PRE-B2) are not closed by Sprint 7 close, Option 3 cannot begin in Sprint 8 without creating a moving-target extraction problem.

**Gate:** All ARCH-013/014 prerequisite gates (PRE-A1, PRE-B1, PRE-B2) must be confirmed CLOSED by Murphy at Sprint 7 close. Silas reviews.

### NPC-3 — `opensquad_app` CONNECTION LIMIT Gap

Cooper's ARCH-005 review noted: *"opensquad_app CONNECTION LIMIT currently uncapped — doubling services doubles unmanaged connection pressure, must be resolved before Option 3."*

Since ARCH-005, two additional services have been added to the architecture: `squad-api` (ARCH-012) and `openhiveos-mcp-gateway` (ARCH-016). Both connect to the database. The connection pressure has grown from 1 service (opensquad-mcp-server) to 3 services (MCP server + squad-api + mcp-gateway) without a CONNECTION LIMIT being set. Option 3 adds a fourth database-connected service. At five total services with no per-role connection ceiling, a connection pool exhaustion event is a realistic production risk.

**Gate:** Cooper sets `CONNECTION LIMIT` on `opensquad_app` before Option 3 begins. Value must be sized against the five-service topology, not the current three-service topology. Silas approves the limit before Cooper applies it.

---

## Ruling

### Option 3: PARTIALLY READY

Option 3 remains the correct architectural target. Nothing in Sprints 4–6 has invalidated it. The two-service MCP split is more justified than it was when ARCH-005 was filed: the mcp-gateway pattern (ARCH-016) proves the process-isolation model works; the tier boundary enforcement (ARCH-008 D2) has operated correctly for five sprints; and the federated Squad Instance model (ARCH-006) makes the Primitives/Utilities isolation architecturally necessary, not merely desirable.

However, Option 3 is **not ready to begin in Sprint 8** until the following gates close in Sprint 7:

| Gate | Owner | Type | Severity |
|---|---|---|---|
| ARCH-003 Condition 2 formal closure filing | Silas | Administrative | Required |
| ARCH-003 Condition 3 formal closure filing | Silas | Administrative | Required |
| SEC-4 migration linter CI confirmation | Cooper | Implementation | Required |
| SEC-6 pre-commit hook coverage sign-off | Cooper + Locksmith | Security gate | Required |
| SEC-7 `opensquad_migrate` role isolation confirmation | Cooper + Locksmith | Security gate | Required |
| SEC-8 re-review for Option 3 two-service topology | Locksmith | Security review | Required (new scope) |
| NPC-1 gateway routing decision (ADR or addendum) | Silas | Design | Required |
| NPC-2 ARCH-013/014 open conditions confirmed CLOSED | Murphy → Silas | Prerequisite chain | Required |
| NPC-3 `opensquad_app` CONNECTION LIMIT set | Cooper → Silas approval | Operational | Required |
| Murphy stability gate explicit confirmation | Murphy | Stability gate | Required at S8 Day 0 |

If all ten gates close in Sprint 7, Option 3 is cleared for Sprint 8.

---

## Sprint 8 Scope (If All Sprint 7 Gates Close)

The two-service split is sequenced in three ordered deliverables. No deliverable begins before the previous one is verified in production.

1. **Extract the OS Primitives service.** Create `packages/opensquad-primitives/` (or `apps/primitives-mcp/`). Move `src/primitives/`, the relevant auth middleware subset, and the Ethos Seal boot-check into the new service. The service runs as a standalone stdio MCP server. The monolith continues to serve Coordination Utilities during transition — no dark period. The mcp-gateway pattern (ARCH-016 NPC-1A or NPC-1B, per the decision reached in Sprint 7) is updated to route Primitives-class tool calls to the new service.

2. **Stabilise and verify the Primitives service.** Two sprints minimum of parallel operation (monolith Utilities + new Primitives service). Locksmith reviews the shared-library bearer token validation pattern (approved in ARCH-005 Security Review as the only acceptable Option 3 auth pattern — independent implementations are a permanent PR block). Cooper updates the Compose topology.

3. **Extract the Coordination Utilities service.** Move `src/utilities/`, cron workers, and the LLM usage ingestion endpoint into the second stdio server. At this point, the monolith is deleted. The squad-api continues to serve the dashboard via `openhiveos_reader`. The Docker Compose 2A topology (ARCH-004) is updated from 4 services to 6: postgres, migrate-init, primitives-mcp-server, utilities-mcp-server, mcp-gateway, squad-api.

---

## Conditions That Do NOT Block Option 3

For clarity: ARCH-006 SEC-11 through SEC-13 (per-Squad role pairs, network isolation, inter-Squad moratorium) are **not blocking conditions for Option 3 itself**. They block external Squad Instance provisioning. Option 3 can be extracted, verified, and running for the internal IO Labs Squad Instance before SEC-11 through SEC-13 are closed. These conditions govern the productization milestone downstream of Option 3, not the architectural split itself.

---

*ARCH-017 authored by Silas. Ruling is binding from date of filing. Sprint 8 Option 3 initiation is blocked until all ten Sprint 7 gates in the ruling table above are confirmed closed by their named owners.*

*Review date: Upon Sprint 7 close — Silas confirms gate status before Sprint 8 kick-off.*
