---
title: "ARCH-006 Architecture Review — Agent OS Product Boundary"
date: 2026-05-20
type: meeting-minutes
tags:
  - type/meeting-minutes
  - project/opensquad
  - domain/architecture
  - domain/product
---

# ARCH-006 Architecture Review — Agent OS Product Boundary

**Date:** 2026-05-20
**Facilitator:** Elizabeth
**Primary Voice:** Silas
**Attendees:** Elizabeth, Silas, Murphy, Rocket, Cooper, Clarence, Nova, Locksmith
**Topic:** Agent OS Product Boundary — Vertical Use Case Stress Test
**ADR Filed:** [docs/ARCH-006-agent-os-product-boundary.md](../ARCH-006-agent-os-product-boundary.md)

---

## Agenda

1. Pre-meeting context load (ARCH-003/004/005 decisions)
2. Elizabeth frames the problem
3. Silas proposes three options
4. Cross-seat review (Murphy → Rocket → Cooper → Clarence → Nova → Locksmith)
5. Silas synthesises decision matrix
6. ADR authorship (Clarence)
7. Memory sync, task creation, minutes

---

## Problem Statement (Elizabeth)

ARCH-003, 004, and 005 established the Agent OS internal architecture but left the product boundary question unanswered from the outside. The Founder surfaced six real-world verticals to stress-test:

1. **Marketing Agency** — PM, design, video, copy, campaign management; pipelines to clients
2. **Insurance Agency** — sells from multiple carriers, renews, supports clients, manages carrier relationships, compliance/regulatory observability
3. **Software Factory (IO Labs)** — projects, clients, docs, deliverables, server management, cybersecurity
4. **Finance Squad (IO Labs internal)** — accounting, tax law, planning
5. **Internal Marketing Team (IO Labs internal)** — marketing, copy, campaigns
6. **School** — students, tuitions, uniforms, parent communications

**Founder's instincts entering review:**
- Each could be a Squad by itself, or more than one Squad
- openBridge should handle communication between Squads, even same-company
- "If we want to productize this we need to have really clear what the OS is and what it's not"

**Open Richo question from ARCH-004/005 this review answers:** Is the Agent OS ever a multi-tenant product? **Answer: No. The Agent OS is a federated product — one Squad = one independent deployment.**

---

## Options Considered

### Option A — Namespace Multi-Tenant

One Agent OS deployment serves all Squads via `squad_id` partitioning on all tables. One PostgreSQL instance, one MCP server, one migration track. Logical isolation only.

**Vertical stress test result:** Fails for insurance (data residency, compliance auditability), school (FERPA/GDPR-K), and multi-client marketing (cross-client contamination risk). Only passes for non-regulated same-company internal use.

**Effort:** Low short-term / High for compliance retrofit.
**Alignment:** Breaks ARCH-003, ARCH-004 Decision 1A, ARCH-001, Constitutional Ruling.
**Security:** OWASP A04:2021 — one middleware bug leaks all tenants.

### Option B — One-OS-Per-Squad (Federated Deployment) ← SELECTED

Each Squad = complete, physically isolated Agent OS deployment: own PostgreSQL DB, own MCP process, own `agents` table, own bearer tokens, own migrations. Squad is the atomic deployment unit. Multi-Squad operators run multiple Docker Compose stacks. Inter-Squad communication (same-operator or cross-operator) via openBridge Ed25519/TOFU.

**Vertical stress test result:** Passes all six verticals without qualification.

**Effort:** Medium — ARCH-004 2A Docker Compose is the Squad artifact; new work = Squad registry manifest + Operator onboarding.
**Alignment:** Full alignment with ARCH-001 through ARCH-005, Constitutional Ruling.
**Security:** Acceptable with SEC-9–SEC-13 binding conditions.

### Option C — Shared Primitives / Independent Utilities

Same-operator Squads share one OS Primitives service; each Squad has its own Utilities service. Requires ARCH-005 Option 3 (two-service split) as prerequisite.

**Vertical stress test result:** Fails regulated verticals (insurance compliance, school FERPA/GDPR-K, multi-client marketing) in current pre-classification form.

**Effort:** High. Prerequisite: ARCH-005 Option 3 delivered.
**Alignment:** Partial — requires memory classification layer not yet designed.
**Security:** UNACCEPTABLE in current form. Memory contamination is default state. Deferred as ARCH-007.

---

## Cross-Seat Review

### Murphy — Backend

- ARCH-001 bearer token model is **unchanged under Option B** — tokens scoped to one Squad's `agents` table, no `squad_id` claim needed.
- Startup fingerprint guard must use a `squad_config` table (written at provisioning time), NOT env var alone — prevents runtime reconfiguration attack.
- `GET /health` endpoint needed: `{ squad_slug, migration_version, uptime }`.
- Migration minimum version constant in `src/config.ts` — boot refuses if DB behind.
- Tasks #1248 and #1249 (module decomposition, tool tier classification) **unaffected in scope**.
- **Preference: Option B.**

### Rocket — Frontend

- No impact on June 27 Milestone A (squad-api + squad-dashboard embed).
- `VITE_SQUAD_API_URL` (baked at build time) is correct for per-Squad dashboard. Multi-Squad Operator view = `OperatorPortalView` — simple page linking to each Squad's dashboard URL, read from manifest.
- Runtime URL injection (`window.__SQUAD_API_URL__`) recommended to remove per-Squad build artifact requirement.
- **Preference: Option B.**

### Cooper — DevOps/Infra

- **PgBouncer is non-negotiable for Sprint 4.** Without it, multiple Squad Instances on current host (max_connections = 100) will exhaust connections.
- SEC-8 scope expands significantly: `opensquad_migrate` / `opensquad_app` (global) become per-Squad pairs (`opensquad_migrate_[slug]` / `opensquad_app_[slug]`).
- Squad registry manifest must be designed before first external Squad Instance provisioned.
- Option A disqualified on operational grounds: cannot write Squad-isolated restore runbook from a shared schema dump.
- **Preference: Option B.**

### Clarence — Documentation

- Option A: highest documentation burden, lowest credibility — cannot explain to a compliance officer why data is "safe" behind an invisible filter.
- Option B: mental model is clean — one Squad = one Docker Compose stack, inter-Squad = openBridge. Taxonomy Table maps directly.
- Option C: two communication mental models in one operator guide. Architecture doesn't exist yet.
- `docs/glossary.md` must be updated FIRST, before any other doc restructure (ARCH-003 rule).
- Four Taxonomy Table gaps to fix: (1) no antonym for Managed Hive → propose "Self-Hosted Deployment"; (2) one-Squad-per-deployment rule must be explicit, not implied; (3) no data residency statement; (4) "currently" in Inter-Squad Bridge definition signals provisionality.
- **Preference: Option B.**

### Nova — Cross-Project Strategy

**Two confirmed conflicts:**

1. **openBridge ZTNA gate (task #674) blocks same-operator inter-Squad communication.** The Founder's position that openBridge handles same-company inter-Squad communication is architecturally correct under Option B — but is operationally blocked until the ZTNA ADR is ratified. Marketing agency (multi-client Squads) and insurance agency (compliance + carrier Squads) cannot have cross-Squad data flows until SEC-13/ZTNA closed.

2. **ARCH-004 Decision 1A `openbridge_app` shared-DB contract has no model for multi-Squad instances.** Needs an amendment when inter-Squad flows are enabled.

**Strategic gaps:**
- Taxonomy Table must be filed in Obsidian vault as org-wide standard — not just `docs/glossary.md`.
- GTM model is undeclared in the ADR. Self-hosted and managed service are different security models, different GDPR obligations, different operational infrastructure. The Founder must answer before Sprint 4 provisioning.
- Managed Hive at scale requires a management plane (not Docker Compose). This must be scoped or explicitly deferred.

### Locksmith — Security (Binding)

**Option A: UNACCEPTABLE.** OWASP A04:2021. Cross-tenant data contamination is a single middleware bug away. Token `squad_id` extension creates new attack surface. No mitigation plan brings it to acceptable baseline without rebuilding per-Squad physical isolation.

**Option C: UNACCEPTABLE in current form.** Memory contamination is the default state — OWASP A04:2021. Shared Primitives blast radius = entire same-operator Squad fleet. Deferred to ARCH-007 with pre-conditions required.

**Option B: Acceptable with five new SEC conditions:**

| Condition | Summary |
|---|---|
| **SEC-9** | Squad registry manifest no-secrets pre-commit hook |
| **SEC-10** | squad_config table boot fingerprint guard (NOT env-var-only) |
| **SEC-11** | Per-Squad PostgreSQL role pairs — cross-Squad assignment architecturally impossible |
| **SEC-12** | 127.0.0.1 binding only, port register, Nginx reverse proxy |
| **SEC-13** | Inter-Squad via openBridge PROHIBITED until ZTNA ADR ratified |

**GTM security mode declaration required** before Sprint 4 provisioning — self-hosted vs managed service have different GDPR data processor obligations.

---

## Decision Matrix

| Dimension | Option A | Option B | Option C |
|---|---|---|---|
| Effort | Low→High | **Medium** | High |
| Platform Fit | Breaks ARCH-003, 004, 001, Constitutional Ruling | **Full alignment** | Requires ARCH-005 Option 3 |
| Security Risk | CRITICAL — A04:2021 | **Acceptable with SEC-9–13** | UNACCEPTABLE in current form |
| Ops Complexity | Low (false simplicity) | **Medium** | High |
| Test Complexity | High | **Medium** | High |
| Regulated Verticals | Fails 3 of 6 | **Passes all 6** | Fails regulated verticals |
| Votes | 0/7 | **7/7** | 0/7 |

**First unanimous decision in ARCH-001 through ARCH-006.**

---

## Decision

**Option B — One-OS-Per-Squad (Federated Deployment).**

**The product definition:** The Agent OS is what a Squad runs on. A Squad is a deployment unit. The Operator is the entity that manages one or more Squads. One Squad = one Docker Compose stack = one physical database.

**Elizabeth's call:** Squad converges. Option B confirmed. No override needed.

---

## Canonical Taxonomy (locked)

| Term | Definition |
|---|---|
| **Agent OS** | Cognitive infrastructure layer — memory, identity, SOPs, agent registry, token lifecycle, coordination primitives. Two tiers: OS Primitives (stable) + Coordination Utilities (active pace). |
| **Squad** | One complete, physically isolated Agent OS deployment for one Operator. The atomic product unit. |
| **Squad Instance** | A running Squad deployment — own DB, own MCP process, own tokens, own agents table. |
| **Integration** | System external to the Agent OS, consuming Utilities tier only. Prohibited from Primitives access. |
| **Inter-Squad Bridge** | Communication channel between Squad Instances. Currently: openBridge (Ed25519/TOFU). |
| **Operator** | Entity that deploys, manages, and owns one or more Squad Instances. |
| **Managed Hive** | IO Labs as both vendor and Operator. Full visibility, slider ownership. |
| **Self-Hosted Deployment** | Operator downloads and runs the Squad Instance on their own infrastructure. IO Labs has no runtime visibility. |

---

## Open Conditions for Active Status

### Technical (SEC-9–SEC-13)

| Condition | Owner | Gate |
|---|---|---|
| SEC-9 — Manifest no-secrets pre-commit hook | Murphy + Cooper | Before first manifest committed |
| SEC-10 — Squad boot fingerprint | Murphy | Before first Squad Compose file released |
| SEC-11 — Per-Squad PostgreSQL role pairs | Cooper + Murphy | Before first external Squad Instance |
| SEC-12 — Port isolation + 127.0.0.1 binding | Cooper | Before first external Squad Instance |
| SEC-13 — ZTNA ADR owner + target sprint named | Silas + Locksmith | Before inter-Squad comms enabled |

### Product / Founder (PROD-1–PROD-4)

| Condition | Owner | Gate |
|---|---|---|
| PROD-1 — Squad registry manifest format documented | Cooper + Murphy | Before Sprint 4 |
| PROD-2 — GET /health endpoint implemented | Murphy | Before Sprint 4 Docker Compose artifact |
| PROD-3 — GTM model declaration (self-hosted vs managed) | Richo | Before Sprint 4 provisioning work |
| PROD-4 — Managed Hive at scale / management plane commitment | Richo + Elizabeth | Next L10 |

---

## Action Items

| # | Task | Owner | Task ID | Sprint |
|---|---|---|---|---|
| 1 | File Taxonomy Table to docs/glossary.md | Clarence | #1269 | This sprint |
| 2 | File Taxonomy Table to Obsidian vault | Clarence | #1272 | This sprint |
| 3 | Update docs/00-architecture.md — per-Squad federated diagram | Silas | #1273 | Sprint 4 |
| 4 | squad.manifest.json schema + squad_config fingerprint guard + GET /health | Murphy | #1276 | Sprint 4 |
| 5 | SEC-9: no-secrets pre-commit hook | Murphy + Cooper | #1277 | Sprint 4 |
| 6 | SEC-11: per-Squad PostgreSQL role provisioning script | Cooper + Murphy | #1275 | Sprint 4 |
| 7 | PgBouncer — design and enter Sprint 4 scope | Cooper | #1278 | Sprint 4 |
| 8 | SEC-12: port allocation register + 127.0.0.1 binding | Cooper | #1280 | Sprint 4 |
| 9 | PROD-1: docs/08-squad-registry-manifest.md | Cooper + Murphy | #1279 | Sprint 4 |
| 10 | SEC-13: ZTNA ADR — name owner, target sprint, sign-off path | Silas + Locksmith | #1281 | This sprint |
| 11 | PROD-3: Raise GTM model at next L10 | Elizabeth | #1270 | Next L10 |
| 12 | PROD-4: Raise Managed Hive at scale at next L10 | Elizabeth | #1271 | Next L10 |
| 13 | ARCH-007 scope placeholder — Same-Operator Shared Primitives | Silas | #1274 | Sprint 5 planning |

---

## Key Decisions Carried Forward

1. **openBridge role is now formally defined:** Inter-Squad Bridge. Not an integration in this role. Not an internal bus. A peer-trust handshake relay via Ed25519/TOFU. Its integration role (consuming Utilities tier) remains separate.

2. **ARCH-003 Conditions 2+3 remain overdue** — these gate ARCH-005 Option 3 which gates ARCH-007. Silas + Nova obligation. No new deadline set this session — Elizabeth must surface at L10.

3. **ARCH-004 SEC conditions (SEC-1–SEC-8) all remain open** — not affected by ARCH-006 except SEC-8 (scope expanded to per-Squad pairs under SEC-11).

4. **ARCH-007 is declared as a future ADR** — Same-Operator Shared Primitives — with four pre-conditions before it can be opened.

5. **The Founder's "clean-room" licence (ARCH-005) has been answered operationally:** Option B is the product boundary. The Python greenfield question (ARCH-005 deferred item) remains open — Elizabeth must raise at next L10.

---

*Minutes filed by Elizabeth. Review closed 2026-05-20. All artifacts in docs/ARCH-006-agent-os-product-boundary.md.*
