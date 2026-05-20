---
title: "OpenHiveOS — Inception"
date: 2026-05-20
status: active
decision_owner: richo
tags:
  - type/inception
  - project/openhiveos
  - domain/architecture
  - domain/product
---

# OpenHiveOS — Inception

## What It Is

OpenHiveOS is the open operating system for AI agent teams.

Each Squad is a hexagon — isolated, self-contained, sovereign. Hexagons tile perfectly with no gaps. That is the architecture: federated deployments with no shared state. The hive is the Operator's fleet.

## Brand

- **Logo:** IO Labs hexagon. One hexagon = one Squad. Multiple hexagons = the hive.
- **Domains:** openhiveos.com (primary) · openhiveos.io (redirect)
- **Naming convention:** continues the IO Labs "Open" prefix (openBridge → OpenHiveOS)

## Product Definition

| Term | Definition |
|---|---|
| **OpenHiveOS** | The open cognitive infrastructure layer. The OS a Squad runs on. |
| **Squad** | One complete, physically isolated OpenHiveOS deployment. Own PostgreSQL DB, own MCP server, own agent registry, own bearer tokens. The atomic product unit. |
| **Squad Instance** | A running Squad deployment — one Docker Compose stack. |
| **Operator** | Entity that deploys and manages one or more Squad Instances. |
| **Managed Hive** | IO Labs as both vendor and Operator. Full visibility, slider ownership. |
| **Self-Hosted Deployment** | Operator runs their own Squad Instance. IO Labs has no runtime visibility. |
| **Integration** | System external to OpenHiveOS consuming the Coordination Utilities tier only. Prohibited from OS Primitives. |
| **Inter-Squad Bridge** | Communication channel between Squad Instances. Protocol: openBridge (Ed25519/TOFU). |

## Architectural Foundation

All architectural decisions from the opensquad-mcp-server ARCH-001 through ARCH-006 reviews are inherited. Key policies:

- **One-OS-Per-Squad** (ARCH-006, unanimous 7/7) — physical isolation is the product definition, not a configuration option
- **OS Primitives + Coordination Utilities** tier split (ARCH-005) — Integrations connect to Utilities only
- **Bearer token auth** scoped to one Squad's agents table (ARCH-001) — unchanged
- **PostgreSQL + pgvector** as the sole DB layer
- **SSE MCP transport** (not stdio)
- **openBridge** handles inter-Squad communication — blocked until ZTNA ADR is ratified (SEC-13)
- **ARCH-007** (Shared Primitives for same-operator Squads) — declared future roadmap, not before Sprint 5+

## Stack (inherited)

Node.js 20 · TypeScript (strict) · PostgreSQL 17 + pgvector · MCP TypeScript SDK · Docker Compose · PM2

## Inception Sprint — Task Board

| # | Task | Owner | ID |
|---|---|---|---|
| 1 | Codebase strategy ADR — fork from opensquad-mcp-server vs clean scaffold | Silas | #1282 |
| 2 | Create GitHub repo input-output-lab/openhiveos with branch protection + CI | Cooper | #1283 |
| 3 | Scaffold project structure — package.json, tsconfig, Docker Compose base | Murphy | #1284 |
| 4 | Write public README — brand story, product positioning, quick-start | Clarence | #1285 |
| 5 | Port OS Primitives tool set from opensquad-mcp-server | Murphy | #1286 |
| 6 | squad.manifest.json schema — design, validate, document (ARCH-006 PROD-1) | Murphy | #1287 |
| 7 | squad_config table + boot fingerprint guard + GET /health (ARCH-006 SEC-10) | Murphy | #1288 |
| 8 | Docker Compose Squad deployment artifact — production-ready | Cooper | #1289 |
| 9 | DNS setup — openhiveos.com and openhiveos.io, holding page | Cooper | #1290 |
| 10 | File ARCH-002-openhiveos — founding architectural decisions | Silas | #1291 |

## Open Questions (Founder Seat)

These must be answered before Sprint 2 planning. Both are on the L10 agenda.

| Question | Task | Gate |
|---|---|---|
| GTM model — self-hosted vendor vs managed service vs both (PROD-3) | #1270 (opensquad-mcp-server) | Sprint 2 planning |
| Managed Hive at scale — management plane commitment (PROD-4) | #1271 (opensquad-mcp-server) | Sprint 2 planning |

## OpenSquad Registration

- **Project ID:** 70
- **Slug:** `openhiveos`
- **Type:** portfolio
- **Lead:** elizabeth
- **GitHub:** https://github.com/input-output-lab/openhiveos

> Note: Portfolio project type blocks direct sprint advancement — sprints sync via OpenBridge. Task tracking (TODO → WIP → REVIEW → DONE) works normally.
