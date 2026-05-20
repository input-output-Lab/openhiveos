---
title: "ARCH-006 — Agent OS Product Boundary: Squad, Integration, and Deployment Model"
date: 2026-05-20
status: Decided
decision_owner: Silas
approved_by: Elizabeth
filed_by: Clarence
adr: ARCH-006
related: ARCH-001, ARCH-002, ARCH-003, ARCH-004, ARCH-005
tags:
  - type/adr
  - project/opensquad
  - domain/architecture
  - domain/product
  - domain/devops
review_date: 2026-08-20
---

# ARCH-006 — Agent OS Product Boundary: Squad, Integration, and Deployment Model

**Date:** 2026-05-20
**Project:** opensquad-mcp-server
**Status:** Decided
**Decision Owner:** Silas
**Approved By:** Elizabeth
**Filed By:** Clarence
**Related:** ARCH-001, ARCH-002, ARCH-003, ARCH-004, ARCH-005

---

## Context

ARCH-003, ARCH-004, and ARCH-005 established the Agent OS internal architecture: a two-tier model (OS Primitives + Coordination Utilities), a TypeScript module decomposition path, and a strict rule that integrations connect to the Coordination Utilities tier only. What those decisions did not resolve is the product boundary question from the outside: what does an Operator deploy? What is one Squad? Where does one company's deployment end and another's begin? Can a company run multiple Squads? How do they communicate?

The Founder surfaced six real-world verticals to stress-test the architecture against:

1. **Marketing Agency** — agents for PM, design, video, copy, campaign management; pipelines delivering work to clients
2. **Insurance Agency** — sells products from multiple carriers, renews coverages, provides client support, manages carrier relationships, handles compliance/regulatory observability
3. **Software Factory (IO Labs itself)** — multiple projects, clients, scopes, documentation, deliverables, server management, cybersecurity
4. **Finance Squad (IO Labs internal)** — accounting, tax law, planning
5. **Internal Marketing Team (IO Labs internal)** — marketing, copy, campaigns
6. **School** — student records, tuitions, uniforms, parent communications

The Founder's instincts entering the review:
- Each example could be a Squad by itself, or even more than one Squad
- openBridge can and should handle communication between Squads, even for Squads that belong to the same company
- "If we want to productize this project we need to have really clear what the OS is and what it's not"

This review answers those questions and establishes the canonical vocabulary for all future Agent OS discussions.

---

## Decision

**Option B — One-OS-Per-Squad (Federated Deployment)** is the Agent OS product boundary definition.

Each Squad is a complete, physically isolated deployment of the Agent OS: its own PostgreSQL database, its own MCP server process, its own `agents` table, its own bearer tokens, its own migrations, and its own data. The Squad is the atomic deployment unit. An Operator that needs multiple Squads (IO Labs running a Finance Squad and an Internal Marketing Squad) runs multiple independent Agent OS instances — multiple Docker Compose stacks, separate port allocations, separate sets of bearer tokens. Squads share no infrastructure by default. Communication between Squads of the same Operator goes through openBridge via Ed25519/TOFU, exactly as it does between Squads of different Operators. The OS makes no distinction between same-operator inter-Squad and cross-operator inter-Squad at the infrastructure layer.

The vote was **7/7 unanimous** — the only unanimous decision in ARCH-001 through ARCH-006. No seat dissented.

---

## Rationale

Option B is the only option that:

1. Satisfies all six verticals without qualification. Three verticals — insurance (compliance observability, data residency), school (FERPA/GDPR-K), and multi-client marketing — require physical data isolation. Application-layer partitioning (Option A) or shared Primitives (Option C in current form) cannot satisfy a regulator or a DPO for these cases. Physical isolation per Squad can.

2. Aligns with every prior architectural decision (ARCH-001 through ARCH-005) and the April 18, 2026 Constitutional Ruling without requiring any of them to be revised.

3. Uses openBridge in its designed role. Ed25519/TOFU is a peer-trust protocol for previously independent systems. Under Option B, every Squad Instance is an independent system. There is no architectural mismatch.

4. Bounds the security blast radius of a token compromise, a migration failure, or a database incident to one Squad. No cross-Squad cascading failure is possible by default.

5. Produces a deployable artifact. The ARCH-004 Decision 2A Docker Compose work is the Squad Instance deployment artifact. The product is the Squad. "Here is your Squad" is a sentence you can say to a school principal, an insurance agency's CTO, and a marketing agency owner with equal precision.

Option A is eliminated because a single application-layer bug exposes all Squads to data contamination. Option C is deferred as a future roadmap item (ARCH-007) for the same-operator, non-regulated, same-trust-domain efficiency case — it cannot be built before ARCH-005 Option 3 ships in production.

---

## Canonical Taxonomy

These terms are the authoritative vocabulary for all Agent OS discussions. Filed to `docs/glossary.md` by Clarence. Filed to the Obsidian vault by Clarence (tagged `type/standard`, `domain/architecture`, `project/agent-os`).

| Term | Definition | Example |
|---|---|---|
| **Agent OS** | The cognitive infrastructure layer — the runtime of memory, identity, SOPs, agent registry, token lifecycle, and coordination primitives — on which a Squad operates. It is not a feature set; it is the substrate beneath all features. The Agent OS has two tiers (ARCH-003): OS Primitives (stable, deprecation-protected) and Coordination Utilities (active-development pace). | The opensquad-mcp-server codebase, its PostgreSQL schema, and its MCP tool suite collectively constitute the Agent OS. |
| **Squad** | One complete, physically isolated deployment of the Agent OS, serving a defined set of agents and use cases for one Operator. The Squad is the atomic unit of the Agent OS product. A Squad has its own agent registry, its own memory store, its own task and project state, and its own bearer token authority. | IO Labs Finance Squad. IO Labs Internal Marketing Squad. A marketing agency's Client A Squad. |
| **Squad Instance** | A running deployment of a Squad — a specific, live combination of Agent OS runtime, database, bearer token authority, and agent registry currently serving traffic. One Squad has exactly one Squad Instance at a given time. The Squad Instance is what the Operator provisions, monitors, upgrades, and decommissions. | The Docker Compose stack running on port 3010 with database `opensquad_finance`, serving IO Labs Finance agents under their provisioned bearer tokens. |
| **Integration** | Any system external to the Agent OS that consumes the Coordination Utilities tier to extend agent capabilities. Integrations are architecturally prohibited from accessing the OS Primitives tier directly (ARCH-005). Integrations are not OS components. | openBridge (as an integration consumer of Utilities), nova-telegram-bridge, clickup-mcp-server. |
| **Inter-Squad Bridge** | The communication channel between two Squad Instances. In the current architecture, this role is fulfilled by openBridge via Ed25519/TOFU. An Inter-Squad Bridge is not a shared database, not an internal message bus, and not an application-layer router. It is a peer-trust handshake layer that signs, verifies, and relays messages between independent Squad Instances. | openBridge connecting an IO Labs Software Factory Squad Instance to an IO Labs Finance Squad Instance. |
| **Operator** | The entity that deploys, configures, manages, and owns one or more Squad Instances. The Operator owns the disposition profile post-deployment (Constitutional Ruling, April 18, 2026). IO Labs is simultaneously an Operator (for its own Squads under Managed Hive) and the Agent OS vendor (for external Operators under Embedded and Air-Gapped modes). | IO Labs (Managed Hive Operator). A marketing agency (Embedded Operator). A school (Air-Gapped Operator). |
| **Managed Hive** | The Constitutional Ruling deployment mode in which IO Labs operates as both the Agent OS vendor and the Operator. IO Labs retains full visibility into agent thoughts, disposition profiles, and operational metrics. Slider ownership remains with IO Labs. This is the current production state of all IO Labs agents. | IO Labs running opensquad-mcp-server on the shared production host with PM2, all IO Labs agents connected via IO Labs-provisioned bearer tokens. |
| **Self-Hosted Deployment** | A deployment mode in which the Operator downloads and operates the Squad Instance on their own infrastructure. IO Labs ships the Docker Compose artifact; the Operator runs it. IO Labs has no runtime visibility unless the Operator opts into Managed Hive. Includes both Embedded (limited IO Labs configuration path) and Air-Gapped (zero IO Labs network path) modes from the Constitutional Ruling. | A school operating their own Squad Instance on school infrastructure, student records never leaving school premises. |

---

## Consequences

### Immediate consequences (this sprint)

1. **The Squad definition is the product definition.** All product conversations, operator guides, and sales materials use the Taxonomy Table above. Any document using "tenant," "namespace," or "org" to mean "Squad" must be corrected.

2. **ARCH-004 Decision 2A (Docker Compose productization) is confirmed as the Squad Instance deployment artifact.** The Squad registry manifest format must be designed before the first multi-Squad external deployment.

3. **Tasks #1248 and #1249** (module decomposition and tool tier classification) are unaffected in scope and sequencing by ARCH-006. They proceed as planned.

4. **`docs/glossary.md` must be updated before any other documentation restructure.** The Taxonomy Table terms are filed there first. All other docs reference the glossary. (Clarence, this sprint.)

### Structural consequences (Sprint 4+)

5. **Per-Squad Docker Compose stacks require per-Squad port allocation and per-Squad DB role pairs.** ARCH-004 SEC-8 scope expands: `opensquad_migrate` and `opensquad_app` are now per-Squad role pairs (`opensquad_migrate_[squad_slug]` / `opensquad_app_[squad_slug]`). The provisioning script is the enforcement mechanism.

6. **PgBouncer enters Sprint 4 scope.** Each Squad Instance has its own PostgreSQL connection pool. Without PgBouncer, multi-Squad IO Labs deployments will exhaust `max_connections = 100` on the shared host. This is a hard operational prerequisite for running more than 2–3 Squad Instances on the current infrastructure.

7. **Squad registry manifest format must be designed and documented** before the first external Squad Instance is provisioned. The manifest is the Operator's configuration artifact — it lists Squad Instance endpoints, ports, `squad_slug` identifiers, and openBridge public keys. It must NOT contain: database passwords, bearer tokens, or any credentials. All secrets must be injected at runtime via environment variables, never committed to the manifest.

8. **Squad startup fingerprint guard (Murphy).** Each Squad Instance must validate on boot that the connected database matches the expected `squad_slug` stored in a `squad_config` table written at provisioning time. The fingerprint assertion must fail with a non-zero exit before serving any MCP request if a mismatch is detected. The fingerprint cannot be env-var-only — it requires a `squad_config` table to prevent runtime reconfiguration attacks.

9. **`GET /health` endpoint** returning `{ squad_slug, migration_version, uptime }` is required for Compose `healthcheck:` and for the Squad registry to poll liveness.

10. **Migration version minimum assertion.** Each Squad Instance boot must assert `migration_version >= MINIMUM_SUPPORTED` (a constant embedded in `src/server.ts` or `src/config.ts`). A Squad Instance running behind the minimum version must refuse to start. This prevents silent schema mismatch between the MCP tool API contract and the Squad's database.

### Deferred consequences (declared, not this sprint)

11. **ARCH-007 (Same-Operator Shared Primitives)** is the declared roadmap item for the efficiency case: same-operator, non-regulated, same-trust-domain multi-Squad Operators who want shared memory and identity without going through openBridge. Requires: ARCH-005 Option 3 delivered, memory classification layer designed, governance model for Primitives access control defined. Not scoped until Sprint 5+.

12. **Managed Hive at scale requires a management plane.** Docker Compose per Squad is the correct self-hosted artifact. It is not a fleet management system. If IO Labs wants to run dozens of client Squads as a managed service, a management plane (centralized fleet management, zero-downtime coordinated updates, centralized observability, capacity planning) must be designed in a future ADR. This is currently unscoped. The Founder must declare whether Managed Hive at scale is a near-term product commitment before Sprint 5 planning.

---

## Six-Vertical Verification Summary

| Vertical | Option B Assessment | Break Points |
|---|---|---|
| Marketing Agency | ✅ Passes — one Squad per client, physical isolation, case study cross-Squad via openBridge | None at product boundary |
| Insurance Agency | ✅ Passes — Embedded/Air-Gapped deployment, data residency Operator-controlled, audit log per Squad | openBridge inter-Squad blocked until ZTNA ADR ratified (SEC-13) |
| Software Factory (IO Labs) | ✅ Passes — multi-Squad topology (Software Factory, Cybersecurity, per-client), manageable with registry manifest | Operator management overhead grows with Squad count; tooling required at 5+ Squads |
| Finance Squad (IO Labs) | ✅ Passes — physical isolation from Software Factory, segregation-of-duties architectural not procedural | None |
| Internal Marketing Team | ✅ Passes — independent deployment, cross-Squad case studies via openBridge | None |
| School | ✅ Passes — Air-Gapped deployment, FERPA/GDPR-K compliant, student data never on IO Labs infrastructure | openBridge inter-Squad blocked until ZTNA ADR ratified (SEC-13) |

---

## Security Review — Locksmith

### Option A — Security Assessment: **UNACCEPTABLE**

Option A introduces cross-tenant data contamination as an OWASP A04:2021 (Insecure Design) vulnerability. The failure mode is a single application-layer bug in the `squad_id` middleware predicate leaking one Operator's data into another's search results. This is not a theoretical risk — it is a documented failure mode of every multi-tenant application that has relied on application-layer filtering as the sole isolation mechanism. For regulated verticals (insurance, school) the exposure is a reportable data breach. Option A is disqualified. No mitigation plan brings it to an acceptable baseline without rebuilding per-Squad physical isolation — at which point Option A becomes Option B at higher complexity.

### Option C — Security Assessment: **UNACCEPTABLE IN CURRENT FORM**

Memory contamination is the default state in Option C pre-classification. Without a memory classification layer, any agent in any Squad sharing a Primitives instance can call `search_memory` and retrieve memory entries belonging to another Squad. This is OWASP A04:2021. The blast radius of a Primitives service compromise is the entire same-operator Squad fleet. Option C is deferred to ARCH-007 with the pre-condition that a memory classification layer and access control governance model are designed and implemented before any Primitives-sharing topology goes to production.

### Option B — Security Assessment: **Acceptable with binding conditions SEC-9 through SEC-13**

#### New SEC Conditions (ARCH-006)

**SEC-9 — Squad Registry Manifest: No Secrets**
The Squad registry manifest (`squad-registry.yml` or equivalent) MUST NOT contain database passwords, bearer tokens, private keys, or any credentials. All secrets MUST be injected at runtime via environment variables (Docker Compose `env_file` or equivalent secret store). Enforcement: a pre-commit hook that scans the manifest for common secret patterns (password, token, key, secret) and blocks the commit if found. Owner: Murphy + Cooper. Gate: before the first manifest is committed.

**SEC-10 — Squad Boot Fingerprint Guard: `squad_config` Table Required**
The startup fingerprint guard CANNOT use the env var alone. A `squad_config` table MUST be written at Squad provisioning time (not runtime) and read on boot. The boot process asserts that `squad_config.squad_slug` matches the value in the environment. If there is a mismatch, the process exits non-zero before serving any MCP request. This prevents: (a) an operator wiring the wrong Compose stack to the wrong database and silently corrupting identity resolution, (b) a runtime reconfiguration attack where the env var is changed without a corresponding DB change. Owner: Murphy. Gate: before the first Squad Instance Compose file is released.

**SEC-11 — Per-Squad PostgreSQL Role Pairs**
ARCH-004 SEC-8 (two DB roles: `opensquad_migrate` and `opensquad_app`) scope expands. Under Option B, each Squad Instance MUST have its own role pair: `opensquad_migrate_[squad_slug]` and `opensquad_app_[squad_slug]`. Cross-Squad role assignment (granting `opensquad_app_finance` access to the `opensquad_marketing` database) must be architecturally impossible in the provisioning script. The provisioning script creates roles scoped to one database only and must be validated for this constraint before release. Owner: Cooper + Murphy. Gate: before the first external Squad Instance is provisioned.

**SEC-12 — Squad Instance Port Isolation**
Each Squad Instance MUST bind to a named, registered port (documented in the Squad registry manifest). No two Squad Instances on the same host may share a port. A port allocation register MUST be maintained and reviewed before each new Squad deployment. No Squad Instance may bind to `0.0.0.0` on production — it must bind to `127.0.0.1` with a reverse proxy (Nginx/Caddy) handling external exposure. Owner: Cooper. Gate: before the first external Squad Instance is provisioned.

**SEC-13 — Inter-Squad Communication Gate: ZTNA ADR Required**
Inter-Squad communication via openBridge between any two Squad Instances is PROHIBITED until the ZTNA ADR (task #674) is ratified with Locksmith sign-off. This applies to same-operator inter-Squad communication as well as cross-operator inter-Squad communication. The TOFU trust establishment between two Squad Instances creates an external peer relationship regardless of operator ownership. The ZTNA ADR must define the trust model for this peer relationship before any production traffic transits the bridge. Interim state: Squad Instances are fully functional in isolation. Cross-Squad data sharing requires human-mediated export/import until SEC-13 is closed. Owner: Silas (ZTNA ADR authorship), Locksmith (sign-off). Gate: must be named, owned, and target-sprint-assigned before ARCH-006 is marked Active.

**GTM Security Mode Declaration (Pre-Sprint 4 Requirement)**
Before Sprint 4 provisioning work begins, the Founder must declare whether IO Labs operates as a self-hosted vendor (Operator deploys their own Stack) or a managed service provider (IO Labs holds and operates Squad Instances on behalf of clients). These are not the same security model. If IO Labs holds client credentials and operates client Squads, IO Labs becomes a GDPR data processor for those clients — triggering DPA obligations, data residency controls, and audit requirements that differ materially from a self-hosted product. This is a Founder decision, not a technical decision, but it must be made before any Sprint 4 provisioning tooling is built.

---

## Rejected Alternatives

**Option A — Namespace Multi-Tenant**
Rejected. A single application-layer bug in the `squad_id` middleware predicate causes cross-Operator data contamination — OWASP A04:2021. Fails to satisfy any regulated vertical. Token model extension (`squad_id` claim on ARCH-001 tokens) creates new attack surface. Breaks ARCH-003 (adds `squad_id` to OS Primitive tables), breaks ARCH-004 Decision 1A (openbridge_app grant model incompatible with multi-tenant schema), and breaks the Constitutional Ruling (Embedded/Air-Gapped modes presuppose deployment-level isolation). The compliance retrofit cost for regulated verticals exceeds the cost of Option B by 3–5x in implementation time.

**Option C — Shared Primitives / Independent Utilities**
Deferred as ARCH-007, not rejected permanently. Not viable in current form: memory contamination is the default state (OWASP A04:2021), the shared Primitives service is a single point of failure for all same-operator Squads, and the architecture requires ARCH-005 Option 3 (two-service split) as a prerequisite. The use case it solves — same-operator, non-regulated multi-Squad shared memory efficiency — is valid and will be worth revisiting when the prerequisites are met. Pre-conditions for ARCH-007: (1) ARCH-005 Option 3 delivered and stable in production, (2) memory classification layer (`scope` field on `factory_memory`) designed and migrated, (3) governance model for Primitives access control defined, (4) Locksmith security review of the shared Primitives topology completed.

---

## Open Conditions for Active Status

ARCH-006 status is **Decided**. It becomes **Active** when all conditions below are closed.

### Technical conditions (SEC-9 through SEC-13)

| Condition | Description | Owner | Gate |
|---|---|---|---|
| **SEC-9** | Squad registry manifest: no-secrets pre-commit hook committed and passing in CI | Murphy + Cooper | Before first manifest committed |
| **SEC-10** | `squad_config` table migration written; startup fingerprint guard implemented in `src/server.ts`; boot exits non-zero on mismatch | Murphy | Before first Squad Compose file released |
| **SEC-11** | Per-Squad PostgreSQL role provisioning script: `opensquad_migrate_[slug]` + `opensquad_app_[slug]`; cross-Squad role assignment validated impossible | Cooper + Murphy | Before first external Squad Instance |
| **SEC-12** | Port allocation register established; Squad Instances bind `127.0.0.1` only; Nginx reverse proxy documented | Cooper | Before first external Squad Instance |
| **SEC-13** | ZTNA ADR: owner named, target sprint assigned, Locksmith sign-off path defined | Silas + Locksmith | Before inter-Squad communication is enabled for any Squad |

### Product / founder conditions

| Condition | Description | Owner | Gate |
|---|---|---|---|
| **PROD-1** | Squad registry manifest format designed and documented in `docs/08-squad-registry-manifest.md` | Cooper + Murphy | Before Sprint 4 |
| **PROD-2** | `GET /health` endpoint implemented: `{ squad_slug, migration_version, uptime }` | Murphy | Before Sprint 4 Docker Compose artifact |
| **PROD-3** | GTM model declared: self-hosted vendor vs managed service provider vs both | Richo (Founder) | Before Sprint 4 provisioning work begins |
| **PROD-4** | Managed Hive at scale feasibility: does the Founder commit to a management plane workstream? If yes, scoped to a future sprint. If no, explicit decision recorded. | Richo + Nova + Elizabeth | L10 agenda item — next session |

---

## Accepted Trade-offs

1. **Operational overhead grows with Squad count.** Each Squad Instance is a separate deployment — separate backup schedule, separate monitoring surface, separate migration track, separate port allocation. For IO Labs running 5+ internal Squads, this overhead is significant without a management plane. Accepted: the isolation value exceeds the operational cost at current IO Labs scale. Revisit at ARCH-007 when Squad count exceeds 5.

2. **No native cross-Squad aggregate query.** An Operator cannot query task load across all their Squads in one database call. All cross-Squad data access is mediated through openBridge messages (50–200ms per call vs <5ms direct query). Accepted: the use cases requiring high-frequency cross-Squad aggregation are not blocking at MVP. An Operator management UI with federation logic is the future answer.

3. **openBridge must be production-stable before inter-Squad workflows are enabled.** The inter-Squad communication story depends entirely on openBridge. If openBridge drops a message, a cross-Squad data request fails. Message delivery guarantee (at-least-once with acknowledgment) must be specified in the ZTNA ADR. Accepted: inter-Squad communication is blocked by SEC-13 until that ADR ships. Single-Squad deployments are fully functional without it.

4. **Migration version drift across Squad Instances.** Squad A at migration 030, Squad B at migration 028. The startup minimum version assertion prevents a mismatched server from running, but it does not automate upgrades. Coordinating upgrades across multiple Squad Instances is an Operator responsibility until an automated upgrade mechanism is built. Accepted: the minimum version gate ensures silent schema mismatch cannot occur.

---

## Action Items Summary

| # | Task | Owner | Sprint | SEC |
|---|---|---|---|---|
| 1 | `ARCH-006: File Taxonomy Table to docs/glossary.md — lock seven new terms` | Clarence | This sprint | — |
| 2 | `ARCH-006: File Taxonomy Table to Obsidian vault — tagged type/standard domain/architecture` | Clarence | This sprint | — |
| 3 | `ARCH-006: Update docs/00-architecture.md — replace single-instance diagram with per-Squad federated topology` | Silas | Sprint 4 | — |
| 4 | `ARCH-006: Design squad.manifest.json schema + startup fingerprint guard + GET /health` | Murphy | Sprint 4 | SEC-10, PROD-2 |
| 5 | `ARCH-006: Squad registry manifest — no-secrets pre-commit hook` | Murphy + Cooper | Sprint 4 | SEC-9 |
| 6 | `ARCH-006: Per-Squad PostgreSQL role provisioning script (opensquad_migrate_[slug] + opensquad_app_[slug])` | Cooper + Murphy | Sprint 4 | SEC-11, SEC-8 revised |
| 7 | `ARCH-006: PgBouncer — enter Sprint 4 scope, connection pool per Squad Instance` | Cooper | Sprint 4 | — |
| 8 | `ARCH-006: Port allocation register — document Squad Instance port strategy` | Cooper | Sprint 4 | SEC-12 |
| 9 | `ARCH-006: Squad registry manifest format — document in docs/08-squad-registry-manifest.md` | Cooper + Murphy | Sprint 4 | PROD-1 |
| 10 | `ARCH-006: ZTNA ADR — name owner, assign target sprint, define Locksmith sign-off path` | Silas + Locksmith | This sprint (named only) | SEC-13 |
| 11 | `ARCH-006: Raise GTM model declaration at next L10 (self-hosted vs managed service vs both)` | Elizabeth | Next L10 | PROD-3 |
| 12 | `ARCH-006: Raise Managed Hive at scale / management plane commitment at next L10` | Elizabeth | Next L10 | PROD-4 |
| 13 | `ARCH-006: ARCH-007 scope — Same-Operator Shared Primitives — placeholder filed with pre-conditions listed` | Silas | Sprint 5 planning | — |

---

*Filed by Clarence. Decision Owner: Silas. Approved by Elizabeth. Review date: 2026-08-20.*
