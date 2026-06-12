---
title: "ARCH-022 — Bridge Usage-Reporting Registry Design"
date: 2026-06-12
updated: 2026-06-12
author: "Silas"
owner: "Silas"
status: decided
tags:
  - type/architecture
  - project/openhiveos
  - domain/backend
  - domain/devops
  - audience/technical
review_date: 2026-09-12
doc_id: "ARCH-022"
related:
  - "[[ARCH-015-llm-usage-tracking]]"
  - "[[ARCH-016-integration-pattern-mcp-gateway]]"
  - "[[ARCH-008-openhiveos-founding-decisions]]"
---

*This ADR resolves ARCH-015 OQ-4 (D15): the Bridge usage-reporting registry design for multi-Squad deployments. It is the canonical reference for how Bridge routes usage records when more than one Squad Instance is running.*

---

## ADR — ARCH-022: Bridge Usage-Reporting Registry Design

**Date:** 2026-06-12
**Project:** openhiveos
**Status:** Decided
**Decision Owner:** Silas
**Approved by:** Silas (architectural ruling — Operator confirmation required before Operator fleet deployment)

---

## Context

ARCH-015 established `POST /internal/usage` as the write path for LLM usage data. The current implementation hardcodes a single destination:

```
OPENHIVEOS_INGESTION_TOKEN  →  one Squad Instance at POST /internal/usage
```

ARCH-015 OQ-4 deferred the multi-instance question: *"Before a third MCP server connects a Bridge to a new instance, a registry design is required."*

The trigger condition has now fired: Sprint 6 planning window has passed (amended trigger per Nova, F13, 2026-05-21). The design must be documented before a second Squad Instance connects to Bridge.

---

## Architectural Constraint

OpenHiveOS is federated by design (ARCH-008):

> *One Squad = one physically isolated OS instance. The Operator runs a fleet; each instance is autonomous.*

This constraint is not advisory. A registry that creates shared state between Squad Instances violates the founding architecture. Any design that routes records through a central service, shared DB, or shared token pool is permanently blocked by this constraint — the same way Option B was blocked in ARCH-015.

---

## Decision

**Option B: Per-Squad Bridge deployment — no registry required.**

Each Squad Instance gets its own Bridge process, configured independently with that Squad's `OPENHIVEOS_INGESTION_TOKEN` and `OPENHIVEOS_INGESTION_URL`.

```
Squad A:  Bridge-A  →  POST https://squad-a.example.com/internal/usage
Squad B:  Bridge-B  →  POST https://squad-b.example.com/internal/usage
```

No shared state. No central routing service. No registry. Each Bridge is a zero-config deployment artifact identical in structure to the reference implementation (ARCH-016).

---

## Rejected Option: Multi-Destination Registry Array (Option A)

> Bridge holds a list of `{ url: string, token: string }` destinations. On each usage report, it POSTs to all destinations that match the `agent_slug` prefix.

**Blocked. Reasons:**

1. **Violates ARCH-008 federated isolation.** Agent slugs are Squad-local identifiers, not globally unique. `agent_slug = "murphy"` means different things in Squad A and Squad B. Prefix matching across Squads is unsound.

2. **No audit boundary.** A single Bridge process with access to multiple ingestion tokens is a credential fan-out risk. If Bridge is compromised, all Squad Instances are exposed simultaneously.

3. **Operationally fragile.** One slow or down Squad Instance causes Bridge retry storms that affect all other Squad Instances in the list. The ARCH-015 fire-and-forget design does not isolate failures across destinations.

4. **Implies a shared Bridge lifecycle.** Bridge must be upgraded for each new Squad — defeating the purpose of having a registry.

**Do not re-propose Option A.** The block is categorical.

---

## Rejected Option: Central Registry Service (Option C)

> Bridge queries a registry endpoint to resolve the destination URL and token before each POST.

**Blocked.** This introduces a new single point of failure with no defined owner, deployment model, or security model. It is also a third-order dependency that violates the principle that each Squad Instance is independently deployable.

---

## Implementation

No code changes are required to OpenHiveOS. The current `POST /internal/usage` implementation in `src/squad-api/routes/internal.ts` is correct for a single-Squad deployment and scales to multi-Squad by replication, not by modification.

**Operator runbook for multi-Squad Bridge deployment:**

1. Deploy Squad B as a new independent OpenHiveOS stack (existing operator install SOP)
2. Provision a new `OPENHIVEOS_INGESTION_TOKEN` for Squad B (existing `provision/` scripts)
3. Deploy a new Bridge process pointing at Squad B's ingestion URL and token:

```env
# Bridge for Squad B
OPENHIVEOS_INGESTION_URL=https://squad-b.example.com/internal/usage
OPENHIVEOS_INGESTION_TOKEN=<squad-b-token>
# All other Bridge config remains unchanged
```

4. Each Bridge instance manages one Squad. No shared state between them.

---

## Interim Accommodation (≤ 3 Squads, single host)

If an Operator is running multiple Squads on a single host during a pilot phase and cannot run separate Bridge processes, the following interim configuration is acceptable until separate Bridge deployments are feasible:

- Run one Bridge process per Squad as separate PM2 processes with distinct names and env files
- Use `ecosystem.config.cjs` app entries to manage each independently
- This is an operational choice, not an architectural exception

The interim accommodation does not change the architectural standard. Per-Squad Bridge remains the binding model.

---

## Environment Variables

No new environment variables are introduced. The existing variables remain canonical:

| Variable | Description |
|----------|-------------|
| `OPENHIVEOS_INGESTION_URL` | Full URL of the target Squad's `POST /internal/usage` endpoint |
| `OPENHIVEOS_INGESTION_TOKEN` | Squad-scoped write-only token (SEC-C8 — separate from agent tokens) |

---

## Closes

- ARCH-015 OQ-4 (D15) — Bridge usage-reporting registry design
- Task #1396 — filed as Sprint 5+ backlog item, now resolved

---

## Changelog

| Version | Date | Author | Change |
|---------|------|--------|--------|
| v1.0 | 2026-06-12 | Silas | Initial decision — per-Squad Bridge deployment, no registry required, Option A and C permanently blocked |
