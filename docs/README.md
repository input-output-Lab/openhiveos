---
title: "OpenHiveOS — Documentation Index"
date: 2026-05-20
tags:
  - project/openhiveos
  - type/index
---

# OpenHiveOS — Documentation Index

This index covers all documents in the OpenHiveOS docs folder. Every architectural decision from the opensquad-mcp-server ARCH-001 through ARCH-006 reviews is inherited by OpenHiveOS and filed here as the canonical record.

---

## Project Documents

| File | Description |
|---|---|
| [00-inception.md](00-inception.md) | Project inception, product definition, brand, stack, and inception sprint task board |

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
| [ARCH-007-openhiveos-codebase-strategy.md](ARCH-007-openhiveos-codebase-strategy.md) | Option C (Selective Extraction) chosen unanimous 8/8 — fresh scaffold + per-primitive extraction from opensquad-mcp-server with SEC review; Option B blocked by Locksmith (OWASP A02:2021); SEC-14 through SEC-20 binding conditions established |

---

## Meeting Minutes — ARCH Reviews

| File | Meeting Summary |
|---|---|
| [meeting-minutes/2026-05-19-arch-review-linear-next-opensquad-positioning.md](meeting-minutes/2026-05-19-arch-review-linear-next-opensquad-positioning.md) | ARCH-003 review — Linear Next strategic positioning; Option C (Agent OS) decided 6/6; Option B vetoed by Locksmith |
| [meeting-minutes/2026-05-20-arch-review-agent-os-consolidation.md](meeting-minutes/2026-05-20-arch-review-agent-os-consolidation.md) | ARCH-004 review — openBridge service boundary, dashboard embed strategy, Docker Compose productization; eight Locksmith SEC conditions raised |
| [meeting-minutes/2026-05-20-arch-review-agent-os-canonical-architecture.md](meeting-minutes/2026-05-20-arch-review-agent-os-canonical-architecture.md) | ARCH-005 review — canonical architecture options (TypeScript monolith vs Python greenfield vs two-service split); Option 1 selected, Option 3 declared target |
| [meeting-minutes/2026-05-20-arch-review-agent-os-product-boundary.md](meeting-minutes/2026-05-20-arch-review-agent-os-product-boundary.md) | ARCH-006 review — six-vertical stress test of product boundary; Option B (federated) wins 7/7; SEC-9 through SEC-13 conditions raised |
| [meeting-minutes/2026-05-20-arch-review-openhiveos-codebase-strategy.md](meeting-minutes/2026-05-20-arch-review-openhiveos-codebase-strategy.md) | ARCH-007 review — OpenHiveOS codebase strategy; Option C (Selective Extraction) wins 8/8; Option B blocked (Locksmith + Cooper); SEC-14 through SEC-20 established |

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

*Index maintained by Clarence. Last updated: 2026-05-20 (ARCH-007 added).*
