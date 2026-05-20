---
title: "ARCH-007 — OpenHiveOS Codebase Strategy"
date: 2026-05-20
status: Accepted
decision_owner: Murphy
approved_by: Elizabeth
filed_by: Clarence
adr: ARCH-007
related:
  - "[[ARCH-001-server-resolved-agent-identity]]"
  - "[[ARCH-002-pgvector-backend-pk-convention]]"
  - "[[ARCH-003-formalize-agent-os-linear-next]]"
  - "[[ARCH-004-agent-os-consolidation]]"
  - "[[ARCH-005-agent-os-canonical-architecture]]"
  - "[[ARCH-006-agent-os-product-boundary]]"
tags:
  - type/adr
  - project/openhiveos
  - domain/architecture
  - domain/backend
  - domain/devops
  - domain/security
review_date: 2026-08-20
---

# ARCH-007 — OpenHiveOS Codebase Strategy

> **Decision:** Option C — Selective Extraction
> **Vote:** Unanimous (8/8 — Elizabeth, Silas, Murphy, Rocket, Cooper, Clarence, Nova, Locksmith)
> **Status:** Accepted — binding from date of filing

---

## 1. Context

ARCH-001 through ARCH-006 have resolved the product definition, internal architecture, agent identity model, and deployment topology for OpenHiveOS — the productized, public-facing Agent OS (Project ID: 70).

One foundational question remained unresolved before the inception sprint could execute: **how does the OpenHiveOS repository come into existence, and what must be true before the first line of production code ships?**

This ADR answers that question. It is the gate for the following sprint tasks:

| Task | Title |
|------|-------|
| #1283 | GitHub repo creation — branch protection + CI |
| #1284 | Scaffold project structure |
| #1286 | Port OS Primitives tool set |
| #1287 | squad.manifest.json schema |
| #1288 | squad_config table + boot fingerprint guard + GET /health |

Three options were evaluated. One is accepted. One is conditionally acceptable. One is blocked.

---

## 2. Options Evaluated

### Option A — Greenfield Scaffold

Fresh scaffold with ARCH-001 bearer token auth **reimplemented from scratch**. All 8 OS Primitives written net-new, with no code derived from opensquad-mcp-server.

**Assessment:** Conditionally acceptable. Not selected as primary path.

Auth reimplementation from scratch introduces avoidable risk under OWASP A07:2021 — subtle timing oracle vulnerabilities, entropy assumptions, and missing validation paths that a supervised extraction eliminates. Option A remains available on a **per-primitive basis** if Option C's extraction proves infeasible for a specific primitive, but that determination requires Locksmith approval before the fallback is exercised.

---

### Option B — Structured Fork After ARCH-005 Option 1 Checkpoint

Fork opensquad-mcp-server after ARCH-005 Option 1 is complete, perform a squash-and-verify pass to strip IO Labs internal history, and publish the sanitised result as the OpenHiveOS public repository.

**Status: BLOCKED — Two independent binding determinations.**

**Block 1 — Locksmith (binding security determination):**
The git history of the opensquad-mcp-server production system on a public GitHub repository is an unacceptable security risk under OWASP A02:2021. Squash verification cannot be performed at scale with confidence on a public repository. The blast radius of a missed secret is a live IO Labs production credential exposure. No mitigation makes Option B acceptable. This block is binding and cannot be overridden by team vote.

**Block 2 — Cooper (infrastructure determination):**
The public-from-day-one constraint eliminates the squash-and-verify path. Any `git push` before verification is complete is a live security incident risk, not a theoretical one. The window between push and verification is an unacceptable exposure surface.

**Supporting findings (non-binding but concurring):**

*Murphy — self-referential gate:*
Option B requires ARCH-005 Option 1 completion as a hard prerequisite. Murphy is the sole executor of ARCH-005 Option 1. This creates a blocking serial dependency between two workstreams designed to run in parallel. Option C eliminates the dependency.

*Clarence — documentation integrity:*
Git history on a public repository tells an origin story that the README cannot contradict. The product identity of OpenHiveOS — a clean, public Agent OS primitive — cannot coexist with a fork history that traces back to an IO Labs internal system.

---

### Option C — Selective Extraction ✓ ACCEPTED

Fresh scaffold (clean `package.json`, `tsconfig`, ESLint config, enforced directory structure). Each of the 8 OS Primitives tools extracted individually from `opensquad-mcp-server/src/primitives/`, reviewed against SEC-1 through SEC-8 and the new SEC-14 through SEC-20 gate conditions, and committed as a discrete, reviewable unit — **one PR per primitive**. Fresh migration chain starting at `001_init.sql`. ARCH-001 bearer token auth extracted with supervised review — not reimplemented from scratch. No IO Labs production tokens or bearer secrets cross to the public repository.

---

## 3. Decision: Option C — Selective Extraction

**Rationale:**

Option C is the only path that satisfies all four constraints simultaneously:

1. **Security baseline (Locksmith gate):** No git history contamination. No production credentials on a public repository at any point. A clean gate at every primitive boundary via PR review.
2. **Product identity (Clarence gate):** The public repository's commit history is the product's origin story. It begins with a scaffold commit and a series of named, reviewable extractions. That is the story OpenHiveOS should tell.
3. **Workstream independence (Murphy gate):** Option C does not depend on ARCH-005 Option 1 completion. Both workstreams run in parallel.
4. **Auth integrity (Locksmith gate):** Supervised extraction of ARCH-001 bearer token logic is safer than reimplementation. SEC-16 (constant-time comparison audit) provides the verification gate before the extracted auth middleware merges.

**The 8 OS Primitives to be extracted:**

| Primitive | Source Path |
|-----------|-------------|
| `store_memory` | `src/primitives/store_memory` |
| `search_memory` | `src/primitives/search_memory` |
| `search_sops` | `src/primitives/search_sops` |
| `store_thought` | `src/primitives/store_thought` |
| `query_thoughts` | `src/primitives/query_thoughts` |
| `ratify_thought` | `src/primitives/ratify_thought` |
| `get_disposition` | `src/primitives/get_disposition` |
| `set_disposition` | `src/primitives/set_disposition` |

Each primitive is extracted as a single PR. Each PR must pass SEC-14 through SEC-20 gate conditions before merge. No exceptions.

---

## 4. Trade-offs Accepted

**Trade-off 1 — Extraction effort vs. security baseline**
Option C requires 3–4 days of focused extraction work from Murphy. This is higher than Option B's theoretical 1–2 day estimate — which was predicated on a gate (ARCH-005 Option 1 completion) that does not yet exist. The trade-off is accepted unanimously. The security baseline (zero git history contamination) and the audit trail (one PR per primitive) are non-negotiable for a public product.

**Trade-off 2 — No inherited migration chain**
The 27-migration history of opensquad-mcp-server does not transfer. OpenHiveOS's database schema is designed fresh, starting at `001_init.sql`, with ARCH-002 UUID v4 PK convention applied from migration one. This is a feature, not a cost.

**Trade-off 3 — Factory Standard precedent**
This extraction discipline becomes the Factory Standard for future Squad deployments. Any future Squad scaffold follows the same process — selective extraction with per-primitive PR review. Clarence files the Factory Standard to the Obsidian vault immediately after this ADR is signed.

---

## 5. Consequences

### 5.1 Immediate — This Sprint

**Repository setup (Cooper)**
1. Cooper creates GitHub repository `input-output-lab/openhiveos` — **private initially**. Repository created: https://github.com/input-output-lab/openhiveos. Branch protection enabled before the first commit. Repository visibility does **not** flip to public until all v0.1 gate conditions are satisfied (SEC-14, 15, 16, 17 across all 8 primitives, 18, and 19). Public visibility is the v0.1 release gate.
2. CI gate (lint + type-check) required before any code PR merges.
3. Secrets scanning (`gitleaks` or `trufflehog`) pre-commit hook and CI gate wired before first commit. See SEC-15.

**Scaffold (Murphy)**
4. Murphy scaffolds `src/primitives/` and `src/utilities/` directory structure in the first commit. Module boundary is structural from commit one.
5. `eslint-plugin-boundaries` import boundary rules wired in the initial scaffold.

**Primitive extraction (Murphy, one PR per primitive)**
6. Each of the 8 OS Primitives extracted individually. Each PR reviewed against SEC-14 through SEC-20. No primitive merges without passing all seven conditions.
7. **MemPalace hooks are explicitly excluded from extraction.** Any reference to MemPalace — including `mempalace_drawer_id` metadata fields, MemPalace-keyed upsert detection in `store_memory`, or MemPalace hook wiring — is **not** an OS Primitive and must not appear in any extraction PR. Each primitive PR checklist must include a confirmed `grep` result showing zero MemPalace references before the PR opens.
8. ARCH-001 bearer token auth extracted with supervised review. SEC-16 constant-time comparison audit must be complete before the auth middleware PR opens.
9. Locksmith sign-off required on SEC-16 before auth middleware merges to `main`. Murphy cannot self-certify.

**Database (Murphy)**
9. Fresh migration chain starting at `001_init.sql`. ARCH-002 PK convention applied from migration one.
10. `squad.manifest.json` schema (#1287) finalised before the first migration is written.
11. `squad_config` table, boot fingerprint guard, and `GET /health` (#1288) implemented as net-new work — no equivalent in opensquad-mcp-server.

### 5.2 Documentation — This Sprint

12. `docs/glossary.md` updated per ARCH-006 obligation. Proceeds immediately. Not gated on this decision. (Clarence)
13. All ARCH-001 through ARCH-006 frontmatter references to `project/opensquad` and `project: opensquad-mcp-server` updated to `project/openhiveos` before the public repository is published. (Clarence)
14. ARCH-007 (this document) filed to `docs/` in the OpenHiveOS repository. (Clarence)
15. Factory Standard for Squad scaffold extraction filed to the Obsidian vault by Clarence within this sprint.

### 5.3 Security Gate Conditions — All Binding

| Condition | Requirement | Gate |
|-----------|-------------|------|
| **SEC-14** | Branch protection active on `main` | Before first commit |
| **SEC-15** | Secrets scanning pre-commit hook + CI gate | Before first commit |
| **SEC-16** | Constant-time comparison audit on ARCH-001 bearer token extraction | Before auth middleware merges to `main` — Locksmith sign-off required |
| **SEC-17** | Per-primitive dependency CVE scan (Trivy or equivalent) | Before each primitive PR merges |
| **SEC-18** | STRIDE threat model covering MCP server's public API surface | Committed before v0.1 tag |
| **SEC-19** | Zero internal IO Labs references — automated `grep` scan + CI gate | Hard merge gate before any public push |
| **SEC-20** | Rate limiting specified as a documented security requirement | Before v1.0 |
| **Public visibility** | All of SEC-14, 15, 16, 17 (all 8 primitives), 18, 19 satisfied | v0.1 release gate — repo flips from private to public |

SEC-14 and SEC-15 are pre-code conditions. If Cooper cannot wire SEC-14 and SEC-15 before the scaffold commit, the scaffold commit does not happen.

**Repository is private from creation until all v0.1 gate conditions are satisfied.** The private window allows SEC-16 (Locksmith auth sign-off), SEC-18 (STRIDE threat model), and SEC-19 (zero internal references) to be fully verified before any external party can read the repository.

### 5.4 Sprint 4+ — Inherited from ARCH-005 / ARCH-006 (Unaffected by This Decision)

- ARCH-003 Conditions 2 and 3 must close before Option 3 (two-service MCP split) begins.
- ARCH-004 SEC-1 through SEC-8 must close before Option 3 begins.
- PgBouncer is non-negotiable for Sprint 4.
- Per-Squad DB role pairs: `opensquad_migrate_[squad_slug]` / `opensquad_app_[squad_slug]`.
- Port 3002 conflict on the production host must be resolved before Docker Compose port allocation is finalised.

### 5.5 Closed Decisions — Not In Scope For OpenHiveOS

- **MemPalace:** MemPalace is a third-party companion memory system not developed by IO Labs. It has no relevance to OpenHiveOS. MemPalace integration is excluded entirely from the extraction scope. No MemPalace hooks, namespacing, drawer IDs, or wing/room concepts are ported. The OS Primitives (`store_memory`, `search_memory`) are self-contained within OpenHiveOS's own schema.
- **PROD-2 (Python R&D track):** Closed permanently. The sole technical justification for a Python parallel track was MemPalace Phase 3/4 local cross-encoder reranking. With MemPalace removed from scope, no technical gap exists that Python fills for OpenHiveOS. The OpenHiveOS stack is Node.js 20 · TypeScript strict — this decision is final. PROD-2 is not deferred; it is closed.

### 5.6 Future Roadmap (Not This Sprint)

- **ARCH-008 (Shared Primitives for same-operator Squads):** Sprint 5+. Requires ARCH-005 Option 3 delivered.
- **ZTNA ADR (SEC-13):** Separate review. Blocks openBridge inter-Squad communication. Must name OpenHiveOS in scope explicitly.
- **Portfolio sprint-sync:** OpenHiveOS `type:portfolio` blocks sprint advancement via OpenBridge until SEC-13 is ratified.

---

## 6. Security Review — Locksmith

**Option B: BLOCKED.** Binding determination under OWASP A02:2021. The git history contamination risk on a public repository is an unacceptable security exposure. No mitigation makes Option B acceptable. The block is permanent for this product iteration.

**Option A: Conditionally acceptable.** Not selected as primary path due to auth reimplementation risk under OWASP A07:2021. Available as a per-primitive fallback with Locksmith approval only.

**Option C: Locksmith concurs.** Subject to SEC-14 through SEC-20 binding conditions, Option C is the correct path.

**Locksmith's binding gate:** No auth middleware merges to `main` without written Locksmith sign-off on SEC-16. Murphy may not self-certify this gate.

**SEC-13 ZTNA moratorium extension:** The ZTNA ADR must explicitly name OpenHiveOS in scope when Silas authors it.

---

## 7. Full Vote Record

| Seat | Role | Vote | Notes |
|------|------|------|-------|
| Elizabeth | Project Manager / Facilitator | Option C | Workstream parallelism and clean product identity |
| Silas | Systems Architect | Option C | Cleanest alignment with ARCH-005 and ARCH-006 |
| Murphy | Backend | Option C | Extraction is feasible; parallel workstream; no self-referential gate |
| Rocket | Frontend | Option C | No frontend impact this sprint; SEC propagation risk eliminated |
| Cooper | DevOps | Option C | Repo private-first, public only at v0.1 gate; SEC-14 and SEC-15 wired before first commit |
| Clarence | Documentation | Option C | Git history is product documentation; Option B contradicts the README |
| Nova | Cross-Project | Option C | Sets Factory Standard for future Squad scaffolds |
| Locksmith | Security | Option C | SEC-14 through SEC-20 binding; Option B blocked |

**Result: Unanimous. 8/8. Option C accepted.**

---

## 8. Related Decisions

- [[ARCH-001-server-resolved-agent-identity]] — Bearer token auth being extracted under SEC-16
- [[ARCH-002-pgvector-backend-pk-convention]] — UUID v4 PK convention applied from `001_init.sql`
- [[ARCH-003-formalize-agent-os-linear-next]] — Conditions 2 and 3 gate Option 3 (Sprint 4+)
- [[ARCH-004-agent-os-consolidation]] — SEC-1 through SEC-8 gate Option 3 (Sprint 4+)
- [[ARCH-005-agent-os-canonical-architecture]] — Option 1 workstream runs in parallel with this strategy
- [[ARCH-006-agent-os-product-boundary]] — Squad schema drives `001_init.sql` table design

---

*Filed by Clarence — Documentation Specialist, Input Output Labs*
*Date: 2026-05-20*
*Review date: 2026-08-20*
