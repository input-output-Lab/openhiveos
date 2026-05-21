---
title: "ARCH-005 — Agent OS Canonical Architecture: Two-Tier Enforcement and Greenfield Boundary"
date: 2026-05-20
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
  - "[[ARCH-001 — Server-Resolved Agent Identity]]"
  - "[[ARCH-002 — pgvector Backend PK Convention]]"
  - "[[ARCH-003 — Agent OS Two-Tier Model]]"
  - "[[ARCH-004 — Agent OS Consolidation]]"
---

# ARCH-005 — Agent OS Canonical Architecture: Two-Tier Enforcement and Greenfield Boundary

**Status:** Decided
**Date:** 2026-05-20
**Decision Owner:** Silas
**Approved By:** Elizabeth
**Filed By:** Clarence

---

## Context

ARCH-003 designated OpenSquad as the Agent OS for IO Labs — the cognitive infrastructure layer, not a PM tool. ARCH-004 made three consolidation decisions (1A: shared-DB contract, 3A: dashboard embed, 2A: Docker Compose productization), all conditional and none yet executed. Following ARCH-004, the Founder clarified a more fundamental architectural truth: the Agent OS is OpenSquad concerns only. openBridge, nova-telegram-bridge, clickup-mcp-server, and any other integration are not the OS — they are integrations that consume it. This clarification, combined with the observation that the current system is a prototype that became production before anyone asked what a deliberately designed Agent OS would look like, prompted ARCH-005.

The current system: Node.js/TypeScript, Express (used only as middleware glue), MCP TypeScript SDK, PostgreSQL 17 + pgvector, PM2, 22 MCP tools, 27 migrations, ARCH-001 bearer token auth. The ARCH-003 two-tier model (OS Primitives vs Coordination Utilities) is enforced today only by convention — the boundary exists in documentation, not in code.

---

## Decision

**Immediate decision (this sprint):** Option 1 — Surgical Refinement of the TypeScript monolith.

Implement the ARCH-003 two-tier model as enforced module boundaries within the existing codebase. Create `src/primitives/` and `src/utilities/` directory layers. Install ESLint import boundary rules (`eslint-plugin-boundaries` or equivalent) to prevent cross-tier imports. Clean up the committed dual `.ts`/`.js` build artifacts in `src/mcp/tools/`. No runtime changes, no schema changes, no auth changes, no protocol changes.

**Declared architectural target (Sprint 4+, gated):** Option 3 — Two-Service MCP Architecture.

Split the Agent OS into two independent MCP servers, one per ARCH-003 tier: an OS Primitives service (memory, identity, SOPs, agent registry, token lifecycle) and a Coordination Utilities service (tasks, crons, projects, cost tracking, cost reporting). Both run Node.js/TypeScript. Both implement ARCH-001 bearer token auth. Integrations (openBridge, nova-telegram-bridge, clickup-mcp-server) connect ONLY to the Coordination Utilities service — the OS Primitives service is architecturally inaccessible to integrations, not merely contractually.

**Pending decision (Richo, next L10):** Option 2 — Python Greenfield as a parallel 90-day R&D track.

Not a production replacement. A time-boxed clean-room implementation to answer: "what would we build if we started today?" Evaluation gate criteria and ownership must be set before any R&D work begins. Decision deferred to Richo.

---

## Rationale

Option 1 is selected for immediate execution because:

- The squad carries 8 open Locksmith conditions from ARCH-004 (SEC-1–SEC-8), a PITR gap, and an unresolved port 3002 conflict. A runtime rewrite or a two-service split under these conditions is risk stacking, not architecture.
- The module decomposition (Option 1) can begin this sprint without a dark period, without new infrastructure, without schema changes, and without touching ARCH-001 auth.
- Murphy's finding: the TypeScript embedding layer already calls the Gemini API — there are no local models in play. Python's ML ecosystem advantage materialises only if MemPalace Phase 3/4 requires a cross-encoder reranker. That is the correct trigger to revisit the language decision, not this review.
- Rocket's finding: ARCH-004 3A (dashboard embed) is a gated implementation contract written for Express/Node.js. Any option that introduces squad-api runtime uncertainty before 3A is deployed adds rework to a sprint scheduled against June 27. 3A must ship first.

Option 3 is named as the declared architectural target because:

- It is the truest implementation of ARCH-003. The process boundary makes the two-tier model real rather than aspirational.
- Integrations connecting only to the Utilities service by process isolation — not by convention — is the only answer that makes the Agent OS integration boundary durable as the number of integrations grows.
- The mission is incrementally achievable from the Option 1 baseline: extract Primitives service from the monolith, stabilise, then separate Utilities. No dark period. No rewrite.
- Nova's strategic finding: "Agent OS" is architecturally defensible under Option 3. Under Option 1, it is a label on a monolith — defensible internally, weakens under scrutiny from technical partners.

Option 2 is rejected as a production replacement at this time because:

- Cooper's finding: SEC-7 and SEC-8 (as written in ARCH-004) are explicitly invalidated by a Python greenfield. Both must be reset to zero and re-reviewed by Locksmith. A timing veto, not a permanent veto on Python.
- No Python operational precedent exists on the production host. Two runtimes means two dependency ecosystems, two CVE watch tracks, two operational disciplines.
- ARCH-001 reimplemented in a new language is a new security boundary, not an extension. A full threat model review is required before any Python auth implementation reaches production.
- At constrained squad capacity with client delivery in-flight, a 4–6 sprint rewrite is a capacity bet the squad cannot currently cover.

---

## Trade-offs Accepted

1. **Option 1's enforcement ceiling.** Module boundaries enforced by ESLint are not as strong as process isolation. A future developer can still bypass them. This is accepted as the immediate path while Option 3 is prepared.
2. **Option 3 is deferred.** The architectural ideal is the two-service model. Deferring it means another 2–3 sprints of living with a monolith where the tier boundary is convention. Accepted explicitly.
3. **Python decision is not made.** The Founder's clean-room signal is acknowledged but not actioned until Richo answers the pending question. If the answer is "yes," the clean-room will inform Option 3 implementation decisions (particularly around MemPalace Phase 3/4). Until then, no Python implementation work begins.

---

## Consequences

1. **This sprint:** Murphy and Silas execute the module decomposition — `src/primitives/` and `src/utilities/`. ESLint import boundary rules added. Dual build artifact cleanup.
2. **Before Sprint 4:** ARCH-003 Conditions 2 and 3 must be closed (Silas + Nova, 6+ days overdue). ARCH-004 SEC-1–SEC-8 must be closed. Without these, Option 3 cannot begin.
3. **Sprint 4+:** Option 3 design. Cooper adds the second MCP service to the Docker Compose 2A design. Port 3005 allocated to the Coordination Utilities service. Locksmith reviews the two-service token validation pattern before implementation.
4. **Next L10:** Richo decides on the parallel clean-room. If yes: owner named, 90-day evaluation gate criteria written, work begins outside sprint capacity.
5. **The integration boundary rule is now architectural policy, not just convention:** integrations connect to the Coordination Utilities tier only. This applies to openBridge, nova-telegram-bridge, clickup-mcp-server, and all future integrations.

---

## Security Review

Locksmith's position (from the cross-seat review):

**Option 1:** No new attack surface. ARCH-001 bearer auth is unchanged. ARCH-004 SEC-1–SEC-8 obligations remain. No new security review required before execution.

**Option 3 (declared target):** Token validation pattern must be resolved before implementation begins. Both services read from the `agents` table for bearer validation. The correct pattern is a shared validation library (imported by both services) rather than independent implementations or a gateway auth layer. A gateway auth layer would be a new attack surface and a new point of failure. Independent implementations would create two code surfaces to audit. Shared library: one auth code path, tested once, deployed to both. This is the Locksmith-approved pattern for Option 3.

**Option 2 (clean-room, if approved):** The clean-room must implement ARCH-001-equivalent auth from day one if it accepts any live agent connections. An unauthenticated parallel implementation on the same infrastructure is not acceptable. If the clean-room runs in isolation (no live agent connections, test tokens only), it may begin without a full auth review — but must be on network isolation before any live token is used against it. A new threat model is required before any Python implementation reaches production.

**Locksmith conditions inherited from ARCH-004:** SEC-1 through SEC-8 remain open and unchanged. ARCH-005 does not supersede, modify, or close any of them. The Artifact Disposition Table and SEC Condition Disposition Table below confirm their status.

---

## Artifact Disposition Table

| Artifact | Current State | ARCH-005 Impact |
|---|---|---|
| ARCH-001 (bearer token auth) | Active, production | Unchanged under Option 1 and Option 3. Requires reimplementation review under Option 2 (Python). |
| ARCH-002 (pgvector PK convention) | Active, production | Unchanged across all options. |
| ARCH-003 (two-tier model) | Active, 3 open conditions | Option 1 advances enforcement from prose to code. Option 3 advances to process boundary. |
| ARCH-004 (consolidation decisions) | Decided, 8 SEC conditions open | Unchanged. Option 3 extends the 2A Docker Compose topology from 4 to 5 services. |
| ARCH-004 3A (dashboard embed) | Decided, gated | Option 1: no impact, proceeds. Option 2 (squad-api migration): INVALIDATED, requires re-authoring. Option 3: no impact. |
| ARCH-004 2A (Docker Compose) | Decided, Sprint 4+ target | Option 3 extends from 4 services to 5. Requires Cooper re-design before Sprint 4 begins. |

---

## SEC Condition Disposition Table (ARCH-004)

| Condition | Owner | Status | ARCH-005 Impact |
|---|---|---|---|
| SEC-1 | Cooper | Open | Unchanged |
| SEC-2 | Silas + Murphy | Open | Unchanged |
| SEC-3 | Cooper + Silas | Open | Unchanged |
| SEC-4 | Rocket | Open | Unchanged under Option 1/3. Invalidated if squad-api migrates to FastAPI (Option 2). |
| SEC-5 | Murphy | Open | Unchanged |
| SEC-6 | Cooper + Murphy | Open | Unchanged |
| SEC-7 | Cooper | Open | **Reset to zero** if Option 2 is selected for production (Python image; Knex-based init container spec is invalid). Unchanged under Option 1/3. |
| SEC-8 | Cooper + Murphy | Open | **Becomes more complex** under Option 3 (two migrate-init containers or serialized ordering). Must be re-reviewed before Option 3 executes. |

---

## Rejected Alternatives

- **Option 2 (Python Greenfield as production replacement):** Rejected at this time. SEC-7 and SEC-8 are explicitly invalidated. ARCH-001 re-implementation requires a new threat model. No Python operational precedent on production host. Squad capacity is not available for a 4–6 sprint rewrite alongside client delivery. Timing veto, not a language veto.
- **Do nothing:** Rejected. The ARCH-003 two-tier model must be implemented in code, not only in prose. Convention-only enforcement degrades as developer count grows.

---

## Open Questions

*Requiring Richo's decision — to be answered at next L10.*

1. **Parallel clean-room (Option 2 R&D track):** Yes or no? If yes, name the owner and set the 90-day evaluation gate criteria.
2. **Python trigger for MemPalace:** At what MemPalace capability ceiling does the squad begin the Python migration conversation formally? (Murphy's recommendation: cross-encoder reranker requirement is the trigger.)

---

## Review Date

90-day review: **2026-08-20.**

At that date: assess Option 1 module decomposition completeness, Option 3 readiness based on ARCH-004 SEC condition closure, and Richo's clean-room decision outcome.
