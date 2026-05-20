---
title: "ARCH-004 — Agent OS Consolidation: Service Boundary, Dashboard Embed, Productization"
date: 2026-05-20
status: Decided
decision_owner: Silas
approved_by: Elizabeth
filed_by: Clarence
tags:
  - type/adr
  - project/opensquad
  - project/openbridge
  - domain/architecture
  - domain/backend
  - domain/devops
  - domain/security
related:
  - "[[ARCH-001 — Server-Resolved Agent Identity]]"
  - "[[ARCH-002 — pgvector Backend PK Convention]]"
  - "[[ARCH-003 — Agent OS Two-Tier Model]]"
---

# ARCH-004 — Agent OS Consolidation: Service Boundary, Dashboard Embed, Productization

**Date:** 2026-05-20
**Project:** opensquad-mcp-server / openbridge / squad-api / squad-dashboard
**Status:** Decided
**Decision Owner:** Silas
**Approved by:** Elizabeth
**Filed by:** Clarence

---

## Context

With ARCH-003 formally designating OpenSquad as the Agent OS for IO Labs, the team entered a consolidation sprint carrying three unresolved structural questions. Each question had been deferred during the ARCH-003 review because it required cross-repository input that was not available at the time. By Sprint 3 of Phase 1, the three questions became blocking: no new infrastructure work could proceed without answers.

**Question 1 — Service Boundary:** openBridge (integration and webhook relay layer) and openSquad (MCP server and agent OS substrate) share a PostgreSQL instance but have no formal contract governing how openBridge is permitted to read openSquad data. As both systems matured, openBridge began querying `factory_tasks` and `factory_projects` directly. No governance existed. A migration in either repository could silently break the other. The team needed either a merge strategy or a formal shared-database contract before the next schema change landed.

**Question 2 — Productization Target:** The Factory has no reproducible install story. Deploying openSquad to a new environment requires tribal knowledge: PM2, manual database provisioning, environment variable archaeology, and manual migration runs. As the system moves toward external operator readiness, this becomes a product liability. The team needed a declared productization target — something an operator could follow without asking the squad — before Sprint 4 began.

**Question 3 — Dashboard Embed Strategy:** squad-dashboard (Vue 3/Vite, internal operator UI) and squad-api (Express, REST API) are deployed as separate processes. This creates two port allocations, two reverse proxy configurations, two deployment units, and a CORS configuration that grows more complex with every new API route. Cooper flagged a port conflict: google-workspace-mcp-server is also running on port 3002. Nova flagged that the milestone A estimate was authored before the embed architecture was decided, meaning the estimate is structurally invalid. The team needed a declared embed strategy before implementation could begin.

This ADR records the decisions reached across all three questions, the options that were considered and rejected, the conditions that remain open, and the named risks the team accepts by proceeding.

---

## Decisions

### Decision 1A — No Merge; Formalize a Shared-Database Contract

openBridge and openSquad remain separate repositories, separate processes, and separate deployment units. No monorepo migration. No process merge. The two systems are formally connected through a governed shared-database contract rather than through code-level integration.

**The shared-database contract is defined as follows:**

A dedicated PostgreSQL role, `openbridge_app`, is created and scoped to the minimum access required for openBridge's legitimate read operations. The grant scope is:

- `SELECT` on `factory_tasks` — permitted
- `SELECT` on `factory_projects` — permitted
- `SELECT` on `factory_crons` — permitted
- `agents` — zero grants
- `agent_thoughts` — zero grants
- `factory_memory` — zero grants
- `sops` — zero grants

The tables listed under zero grants are OS primitives as defined by ARCH-003. They are not available to any non-OS process via any SQL path. This boundary is enforced at the database level, not by application-layer convention.

**Cross-repo migration governance rule:** Each database table is owned by exactly one repository. Only the owning repository's migrations may ALTER, DROP, or RENAME that table or its columns. A table's owning repository is declared in a governance manifest (`docs/db-ownership.md`) maintained in the opensquad-mcp-server repository. This manifest is the authoritative source of truth for table ownership. Any dispute is resolved by Silas.

**CI lint requirement:** A migration linter is added to the CI pipeline for both repositories. The linter reads the governance manifest and fails any migration file from a non-owning repository that names a table outside its ownership boundary. This check runs on every pull request. It does not require human review to enforce — it is a hard gate.

---

### Decision 3A — Build-Time Embed of squad-dashboard into squad-api

squad-dashboard (Vue 3/Vite) is embedded into squad-api (Express) at build time. The dashboard build output (`dist/`) is served by squad-api via `express.static()`. The two are no longer separate deployment units.

**Implementation contract:**

- All squad-api REST routes are namespaced under `/api/`. This is a breaking change. All existing consumers must update their request paths to include the `/api/` prefix before the embed is deployed.
- The SPA fallback route serves `dist/index.html` for all paths that do not match the `/api/` prefix. The exclusion is implemented as a regex, not a string prefix match, to prevent ambiguous path resolution.
- Helmet's Content Security Policy is configured explicitly for Mermaid rendering. The implementation sequence is: test with `securityLevel: 'strict'` first. Only accept `unsafe-eval` in the CSP if strict mode is demonstrably insufficient for Mermaid to render. If `unsafe-eval` is required, it must be scoped with a nonce — a blanket `unsafe-eval` directive is not acceptable and will not pass Locksmith's security gate.
- CORS scope is controlled by an environment variable allowlist. Hardcoded origin strings are not permitted. The allowlist is validated at server startup; a missing or empty allowlist in a non-development environment is a startup error, not a silent permissive default.
- The standalone squad-dashboard deployment is deprecated immediately upon successful embed. Its PM2 entry is removed, its reverse proxy configuration is retired, and its port allocation is freed.
- `dist/` is not committed to the git repository. A `.gitignore` entry must be present in the squad-api repository explicitly excluding `dist/`. The build pipeline runs `npm run build` in the dashboard workspace before building the squad-api Docker image or PM2 bundle. The pipeline is the only mechanism that produces the `dist/` artifact.

**Port conflict resolution:** Cooper's flag that google-workspace-mcp-server is also occupying port 3002 must be resolved before squad-api's port assignment is finalized. The embed decision does not itself resolve the conflict — it creates the condition under which the conflict must be resolved rather than deferred. Port resolution is a precondition for deploy, not for design.

**Milestone A re-estimate:** Nova's flag that the milestone A estimate was authored before the embed architecture was decided is accepted as valid. A re-estimate of milestone A is required before the sprint containing the embed implementation is pointed. Nova's flag is not blocking this decision — it is recorded here as a required sequencing step.

---

### Decision 2A — Docker Compose as Productization Target (Design Now; Execute Sprint 4+)

Docker Compose is the declared productization target for the openSquad operator install model. This decision authorizes design and documentation to proceed immediately. Implementation is gated behind the open conditions listed in this ADR and does not begin before Sprint 4.

**Service topology:**

| Service | Image | Notes |
|---|---|---|
| `postgres` | pgvector official image, digest-pinned | Persistent volume. No direct external exposure. |
| `migrate-init` | Custom init container | Runs migrations once on startup, then exits. Never restarts. |
| `opensquad-mcp-server` | Built from repo | Runtime only. No DDL access. |
| `squad-api` | Built from repo, includes embedded dashboard | Serves `/api/` and static SPA. Runtime only. No DDL access. |

**Database role model:**

Two distinct database roles are used. No role overlap is permitted.

- `opensquad_migrate`: DDL-capable role. Used exclusively by the `migrate-init` init container. Has no runtime presence after migrations complete. This role is never available to the application containers.
- `opensquad_app`: DML-only role. Used by `opensquad-mcp-server` and `squad-api` at runtime. Cannot ALTER, CREATE, or DROP tables. This is the runtime principal for all application-layer database operations.

**Image security:**

Every base image is pinned to a digest (`sha256:...`), not a floating tag. Trivy image scanning is documented as a required step in the operator install guide before any image is deployed to a customer environment. The scan procedure and acceptance criteria (zero CRITICAL findings, zero HIGH findings without documented exceptions) are included in the Docker Compose deployment SOP.

**Secret handling:**

`.env` files with `chmod 600` permissions are the accepted secret delivery mechanism for the self-hosted single-server threat model. This model is appropriate for the current operator profile. A pre-commit hook is required in the repository that prevents `.env` files containing actual secret values from being committed. The hook checks for common secret patterns and fails the commit if found. This is not optional — it is a required component of the Compose install.

**Implementation gate:** This decision authorizes design documentation only. Implementation is blocked behind:

1. ARCH-003 Condition 3 (MemPalace/vector store authority) — the vector store decision determines whether the `postgres` service in Compose is the sole pgvector host or whether a second vector store service must be included in the topology.
2. Resolution of the host-native PostgreSQL question — the current PostgreSQL instance is shared with `iolabs_sdr` and `io_auth`. Containerizing the database without answering whether those systems move to Compose as well is an unacceptable operational risk. This question must be answered before Docker Compose implementation begins.

---

## Rationale

### Why 1A over merge or full process integration

The two rejected alternatives — monorepo consolidation (1B) and full process merge (1C) — each carry costs that outweigh their benefits at current scale.

**1B (monorepo)** introduces mid-sprint repository restructuring with no clear operational gain. The tooling overhead of a JavaScript/TypeScript monorepo (workspace hoisting, cross-package build ordering, CI cache invalidation) is non-trivial to set up correctly and adds ongoing maintenance burden. The primary benefit — shared code — is not a current pain point. openBridge and openSquad do not share application-layer code; they share a database. A shared-database contract solves the actual problem without the restructuring cost.

**1C (full process merge)** is incompatible with the current identity models. openSquad uses SHA-256 bearer tokens with server-resolved identity as established by ARCH-001. openBridge uses a different authentication model. Merging the two processes would require either a new unified authentication model — which triggers a new STRIDE threat model and breaks existing auth guarantees — or running two auth stacks within a single process, which is architecturally incoherent. ARCH-001 is a load-bearing security decision. It is not revisited as a side effect of an operational convenience change.

**1A** solves the specific problem: it creates a governed boundary that prevents silent breakage across repositories while preserving the operational independence of each system. The migration linter enforces the boundary automatically. The `openbridge_app` database role enforces the data access boundary at the database level. Together, these two controls mean that neither repository can accidentally violate the boundary without a hard gate failing.

### Why 3A over separate deployables or BFF

**3B (separate deployables with release coordination)** is not a decision — it is a description of the current broken state with a process layer added on top. Release coordination between two separate deployables requires synchronization effort on every deployment, creates a window of time during which dashboard and API are at different versions, and does not eliminate the CORS complexity. It was rejected because it names the symptom rather than treating the cause.

**3C (Backend for Frontend pattern)** was considered as a path to a clean API surface with dashboard-specific endpoints. It was rejected as premature optimization. The BFF pattern makes sense when the API serves multiple consumer types with meaningfully different data contracts. squad-api currently serves one consumer: squad-dashboard. Adding a BFF layer before a second consumer exists locks the API shape to the current dashboard's needs and creates an additional indirection that must be maintained. If a second consumer emerges, the BFF question should be reopened. It is not the right call now.

**3A** reduces operational surface area. One deployment unit, one port, one reverse proxy entry, one PM2 process (or one Compose service). The CORS problem is eliminated at the root — the dashboard and the API are the same origin. The build pipeline cost is real but bounded and automatable.

### Why 2A over CLI wrapper or single binary

**2B (CLI wrapper)** is a valid long-term operator experience investment. It is not a valid Sprint 4 commitment. A CLI wrapper requires argument parsing, configuration discovery logic, a help system, and test coverage across operating systems. The implementation cost for a production-quality CLI is estimated at 3–4 weeks of dedicated engineering time — effort that is not justified before the Docker Compose model has validated the install story with at least one external operator. 2B is a future option, not a rejected one.

**2C (single binary)** requires a spike to determine whether native modules used by the current stack are compatible with bundling into a single executable. The existing PM2 operational model is incompatible with a single binary deploy without replacement of the process management layer. This is not a small change. The scope of the spike alone (estimated at one full sprint) is disproportionate to the benefit at current scale. 2C is deferred, not rejected permanently.

**2A** delivers the minimum viable operator story without requiring any of those investments. A `docker compose up` install is immediately reproducible, self-contained, and testable in any environment with Docker available. It is the fastest path to an operator-ready deploy story.

---

## Trade-offs Accepted

- **1A creates two source-of-truth locations for schema knowledge.** The governance manifest (`docs/db-ownership.md`) must be kept in sync with actual migrations. If a developer forgets to update the manifest, the linter will not catch the omission — it only catches violations. Silas accepts this as a discipline cost rather than a tooling problem to solve immediately.

- **3A is a breaking API change.** Every existing consumer of squad-api must update their paths to include the `/api/` prefix. At the time of this decision, the known consumer set is limited to squad-dashboard and a small number of internal scripts. The migration cost is accepted because the architectural benefit — eliminating CORS, reducing deployment complexity — is worth it. External consumers, if any, must be notified before the change is deployed.

- **3A ties dashboard and API release cadence together.** A dashboard change requires rebuilding the API service. This is an acceptable trade at current team size and current deployment frequency. If the dashboard and API begin evolving at significantly different rates, 3A should be revisited.

- **2A's Docker Compose model is a single-operator architecture.** It is not extensible to multi-tenancy without replacement. The team accepts that if OpenSquad is commercialized as a SaaS product, the Docker Compose install model will be superseded — not upgraded — by a multi-tenant deployment architecture. This is a named, accepted constraint, not an oversight.

- **2A leaves the host-native DB in place until the host-native PostgreSQL question is resolved.** If Docker Compose implementation begins before that question is answered, the Compose `postgres` service and the host-native instance will coexist, creating a split-brain risk for whichever system uses both. The implementation gate exists precisely to prevent this scenario. Cooper and Silas own the resolution.

---

## Consequences

**Architecture:**
- The `openbridge_app` PostgreSQL role must be created and grants applied before any new cross-repo queries are added to openBridge. Backfilling the role after additional grants have been made informally is harder than provisioning it correctly once.
- The governance manifest (`docs/db-ownership.md`) is a new required artifact. It must be authored, reviewed by Silas, and merged before any migration that touches a cross-repo-visible table.
- The migration linter CI check is a new required pipeline step. It is not optional and is not subject to bypass without Silas approval.
- squad-api routes are namespaced under `/api/` effective from the first release that includes the embedded dashboard. There is no grace period for existing consumers — this is a hard cutover.
- The SPA fallback route regex must be tested with at least three edge cases before merge: a path starting with `/api/`, a path with `/api/` in a non-prefix position, and a path with no prefix. The test cases must be committed alongside the route implementation.

**Security:**
- The `openbridge_app` role must be provisioned by a migration in the opensquad-mcp-server repository. The openBridge repository does not own any migrations that touch the `agents` schema or the `opensquad_app`/`opensquad_migrate` roles.
- Locksmith's SEC-1 through SEC-8 conditions (documented below) must all be in a resolved or formally accepted state before Docker Compose implementation ships to an external operator.
- CSP configuration for Mermaid is a security-adjacent implementation decision. The test-strict-first rule is mandatory. Any deviation from it — including skipping straight to `unsafe-eval` because strict mode is assumed to fail — requires Locksmith's explicit written approval.
- CORS allowlist validation at startup is a hard requirement. The application must not start in a non-development environment with an empty or absent CORS allowlist.

**Operations:**
- The standalone squad-dashboard PM2 entry and reverse proxy configuration are deprecated. Cooper owns the deprecation in the deployment runbook.
- Port 3002 conflict (google-workspace-mcp-server) must be resolved before squad-api is assigned its final port. Cooper flags this conflict; Cooper resolves it with Silas's approval.
- The 24-hour PITR gap is a named risk for the Docker Compose model. If the postgres service fails without point-in-time recovery configured, up to 24 hours of agent memory, task state, and cost data may be unrecoverable. This is not acceptable at production scale. Cooper and Silas own remediation in Sprint 2.

**Documentation (Clarence owns):**
- ARCH-004 filed and linked from `docs/README.md` and `docs/00-architecture.md`.
- `docs/db-ownership.md` is authored as a new artifact, listing every table and its owning repository. This document is required before any migration touching a cross-repo-visible table is merged.
- The squad-api deployment runbook (`docs/05-deployment.md`) is updated to document the embedded dashboard build pipeline, the `/api/` prefix requirement, and the SPA fallback configuration.
- A Docker Compose operator install guide is authored as a new artifact (`docs/10-docker-compose-install.md`). It includes: prerequisites, service topology, environment variable reference, the two-role database model, the Trivy scan procedure, secret handling with `chmod 600`, and the pre-commit hook setup. This document is the productization deliverable.
- The Project Glossary is updated to formally define: "shared-database contract," "owning repository," "migration linter," "opensquad_migrate role," "opensquad_app role," and "SPA fallback."

---

## Open Conditions (Locksmith Security Review — SEC-1 through SEC-8)

The following eight conditions were raised by Locksmith during the security review of this ADR. The ADR status is Decided, meaning the architectural direction is confirmed. These conditions do not block the design phase. They are hard gates before any component covered by this ADR ships to an external operator environment. Each condition must be marked resolved or formally risk-accepted before the relevant component is deployed.

**SEC-1 — CORS allowlist validation:**
The CORS origin allowlist must be validated at application startup. An empty, absent, or wildcard allowlist in a non-development environment must cause the process to exit with a non-zero code and a descriptive error message. A wildcard allowlist in production is a critical security defect. Status: **Open.**

**SEC-2 — CSP strict-mode-first protocol:**
Mermaid CSP configuration must follow the test-strict-first sequence defined in Decision 3A. Any PR that configures `unsafe-eval` without a documented strict-mode failure rationale and Locksmith's written approval will not pass the Locksmith gate. Status: **Open.**

**SEC-3 — `openbridge_app` role scope audit:**
Before the `openbridge_app` role is provisioned in the shared database, Locksmith requires a written confirmation from Silas that the grant scope — SELECT on `factory_tasks`, `factory_projects`, `factory_crons` only — reflects the complete set of access openBridge requires and that no additional grants will be added informally after provisioning. Any expansion of the grant scope is a schema change requiring a new migration and a new Locksmith review. Status: **Open.**

**SEC-4 — Migration linter coverage verification:**
The migration linter CI check must be tested against at least two known-bad migration examples before it is considered production-ready: (a) a migration from openBridge that names an opensquad-owned table, and (b) a migration that uses a table alias to obscure the ownership violation. If the linter does not catch case (b), its coverage must be documented as a known limitation. Status: **Open.**

**SEC-5 — `dist/` gitignore verification:**
The `.gitignore` entry excluding `dist/` from the squad-api repository must be verified by running `git status` after a local build and confirming that no `dist/` artifacts appear as untracked files. A screenshot or terminal output confirming clean status is required as merge evidence. This check prevents the accidental commit of compiled frontend assets that may contain secrets interpolated at build time. Status: **Open.**

**SEC-6 — Pre-commit hook coverage:**
The pre-commit hook that prevents secret values from being committed in `.env` files must be tested against a sample `.env` containing a realistic API key pattern before the Docker Compose install guide is published. The hook must also be tested for bypass resistance: `git commit --no-verify` is a known bypass path. The operator install guide must explicitly warn operators that `--no-verify` disables the protection. Status: **Open.**

**SEC-7 — `opensquad_migrate` role isolation:**
The `opensquad_migrate` role must not be present in the runtime environment after migrations complete. The init container must exit after running migrations, and the `opensquad_migrate` credentials must not be present in the environment of any long-running service container. The Docker Compose service definition must not pass `MIGRATE_DB_URL` or equivalent to `opensquad-mcp-server` or `squad-api`. Status: **Open.**

**SEC-8 — Trivy scan acceptance criteria:**
The Trivy image scan acceptance criteria — zero CRITICAL findings, zero HIGH findings without documented exceptions — must be enforced in the build pipeline, not merely documented in the operator guide. If a CRITICAL or HIGH finding is present at build time, the pipeline must fail. Documented exceptions require Locksmith's written approval and a named remediation timeline. Status: **Open.**

---

## Named Accepted Risks

**Risk 1 — 24-Hour PITR Gap:**
The current backup strategy does not provide point-in-time recovery. A database failure can result in up to 24 hours of unrecoverable data loss: agent memory entries, task state changes, cost tracking records, and thought entries. This risk is accepted as a sprint trade-off. Cooper and Silas own remediation in Sprint 2. If Sprint 2 closes without a PITR solution in place, this risk escalates to a blocker for any external operator deployment.

**Risk 2 — Hybrid Host-Native DB Model:**
If Docker Compose implementation proceeds before the host-native PostgreSQL question is resolved, the Factory will operate with a split database model: some services using the Compose `postgres` container, others using the host-native instance. This creates ambiguity about which instance is authoritative, complicates backup procedures, and introduces a silent data inconsistency risk. The implementation gate on Decision 2A exists specifically to prevent this scenario. If the gate is bypassed, this risk becomes active immediately.

**Risk 3 — Docker Compose is Not a SaaS Architecture:**
Docker Compose is a single-operator deployment model. It cannot be extended to multi-tenant SaaS without replacement. The team accepts this constraint. If OpenSquad is commercialized as a hosted service, the productization work done under Decision 2A will not transfer — it will be superseded. This is a deliberate architectural choice appropriate for the current operator profile, not an oversight.

---

## Sequencing Dependencies

The following dependencies must be resolved in order. Proceeding out of sequence introduces the risks named above.

1. **1A requires ARCH-003 Condition 2 to be closed** (tier boundary governance). The migration linter's determination of what constitutes a governance violation depends on the tier boundary authority being named. Without Condition 2 closed, disputes about migration linter failures have no resolution path.

2. **2A requires ARCH-003 Condition 3 to be closed** (MemPalace/vector store authority). The Docker Compose service topology cannot be finalized until the vector store decision is made. If ChromaDB becomes a co-equal or authoritative vector store, it must appear as a service in the Compose topology. If pgvector remains sole authority, the topology is as specified in Decision 2A.

3. **2A requires the host-native PostgreSQL question to be answered** before implementation begins. This question is cross-project: `iolabs_sdr` and `io_auth` share the current host-native PostgreSQL instance. Moving the database to a Compose service without involving those projects is not an option. Silas and Cooper own the cross-project conversation.

4. **3A requires milestone A to be re-estimated** before the sprint containing the embed implementation is pointed. Nova's flag is accepted. The re-estimate must reflect the build pipeline work, the `/api/` prefix migration work, and the CSP configuration work.

5. **3A requires port 3002 to be unambiguously assigned** before squad-api's Compose service definition is written. Cooper owns the resolution; it is a precondition for writing the Compose file, not just for deployment.

---

## Security Review

**Reviewed by:** Locksmith
**Date:** 2026-05-20
**Outcome:** Decisions 1A, 3A, and 2A approved with conditions. SEC-1 through SEC-8 are binding open conditions.

Decision 1A introduces a new database role and a new governance mechanism. The grant scope is correctly minimal. The CI linter is the correct enforcement mechanism. Locksmith's concern is that the linter's coverage against alias-based violations (SEC-4) is unverified. Until SEC-4 is verified, the linter should be treated as a best-effort control, not a hard gate.

Decision 3A introduces CSP configuration and CORS configuration as new security-relevant implementation points. Both are correctness-sensitive. The strict-mode-first protocol for CSP (SEC-2) and the startup validation requirement for CORS (SEC-1) are the primary security concerns. Neither is blocking design; both are blocking deployment.

Decision 2A's Docker Compose model introduces the `opensquad_migrate` / `opensquad_app` role separation as a new security control. This is the correct model. Locksmith's concern is isolation: the migrate role must not leak into the runtime environment (SEC-7). The pre-commit hook (SEC-6) and Trivy pipeline enforcement (SEC-8) are standard hardening requirements for any operator-distributed artifact.

No new attack surface is introduced by any of these decisions that is not addressed by the corresponding SEC condition. The ARCH-001 bearer token auth model is unchanged. The ARCH-003 OS primitive access restrictions are reinforced by the `openbridge_app` role grant scope.

---

## Rejected Alternatives

**Option 1B — Monorepo consolidation:**
Rejected. Mid-sprint repository restructuring with no clear benefit at current scale. Monorepo tooling overhead (workspace hoisting, cross-package build ordering, CI cache invalidation) is non-trivial. The actual shared resource between openBridge and openSquad is a database, not application code. Decision 1A solves the database sharing problem directly without requiring a repository restructuring.

**Option 1C — Full process merge:**
Rejected. Incompatible authentication models. openSquad uses SHA-256 bearer tokens with server-resolved identity (ARCH-001). Merging the two processes would require either a new unified authentication model — which triggers a new STRIDE threat model and invalidates ARCH-001 — or operating two authentication stacks within a single process. Neither option is acceptable. ARCH-001 is a load-bearing security decision. It cannot be revised as a side effect of an operational convenience change.

**Option 3B — Separate deployables with release coordination:**
Rejected. Release coordination between separate deployables does not eliminate the underlying problems: dual-port allocation, reverse proxy complexity, CORS configuration, and version skew windows. It adds process overhead on top of an architecture that remains structurally broken. This option describes the current state with additional meetings scheduled around it.

**Option 3C — Backend for Frontend pattern:**
Rejected as premature. The BFF pattern is appropriate when an API serves multiple consumer types with different data contracts. squad-api currently serves one consumer. Introducing a BFF indirection before a second consumer exists optimizes for a future that may not arrive and locks the current API shape to the dashboard's present needs. The option is not permanently rejected — it should be reconsidered if a second consumer type with meaningfully different data requirements emerges.

**Option 2B — CLI wrapper:**
Deferred, not rejected. A production-quality CLI wrapper requires argument parsing, configuration discovery, a help system, error handling, and cross-platform test coverage. Estimated implementation cost: 3–4 weeks. This investment is not justified before the Docker Compose model has validated the operator install story with at least one external operator. 2B remains a valid future option and should be revisited after the first external operator deployment.

**Option 2C — Single binary:**
Deferred, not rejected. Requires a compatibility spike to determine whether native modules in the current stack are compatible with single-binary bundling. The existing PM2 operational model is incompatible with a single binary without replacing the process management layer. Spike cost is estimated at one full sprint. Disproportionate to benefit at current scale. Should be revisited if the operator profile shifts toward environments where Docker is not available.

---

*ARCH-004 authored by Clarence. Technical rationale provided by Silas. Security ruling by Locksmith (SEC-1 through SEC-8). Infrastructure and port conflict flags by Cooper. Timeline and estimate flags by Nova. Approved by Elizabeth.*
*Review date: 2026-08-20 (90 days) or upon Sprint 4 commencement, whichever is sooner.*
