---
title: "ARCH-007 Architecture Review — OpenHiveOS Codebase Strategy"
date: 2026-05-20
type: meeting-minutes
tags:
  - type/meeting-minutes
  - project/openhiveos
  - domain/architecture
  - domain/backend
  - domain/devops
  - domain/security
---

# ARCH-007 Architecture Review — OpenHiveOS Codebase Strategy

**Date:** 2026-05-20
**Facilitator:** Elizabeth
**Primary Voice:** Silas
**Attendees:** Elizabeth, Silas, Murphy, Rocket, Cooper, Clarence, Nova, Locksmith
**Topic:** OpenHiveOS Implementation Readiness — Codebase Strategy & Pre-Flight Gate
**ADR Filed:** [docs/ARCH-007-openhiveos-codebase-strategy.md](../ARCH-007-openhiveos-codebase-strategy.md)

---

## Agenda

1. Pre-meeting context load
2. Elizabeth frames the problem
3. Silas proposes options
4. Cross-seat review (Murphy → Rocket → Cooper → Clarence → Nova → Locksmith)
5. Decision matrix synthesis
6. ADR authorship (Clarence)
7. Memory sync, action items

---

## Problem Statement (Elizabeth)

ARCH-001 through ARCH-006 are fully decided. The outstanding question before inception sprint execution: how does the OpenHiveOS repository come into existence, and what must be true before the first line of production code ships? Task #1282 (Silas — codebase strategy ADR) is the gate for tasks #1284, #1285, #1286, #1287, and #1288.

**Business constraints:**
- opensquad-mcp-server (IO Labs production system) must not be destabilised by inception sprint work
- No client delivery deadline — no external operators waiting for inception sprint
- OpenHiveOS is portfolio type — sprint advancement blocked until SEC-13 ZTNA ADR is ratified

**Technical constraints:**
- ARCH-001 through ARCH-006 inherited wholesale — no ADR may be revised by this decision
- Stack locked: Node.js 20 · TypeScript strict · PostgreSQL 17 + pgvector · MCP TypeScript SDK · Docker Compose · PM2
- All SEC conditions SEC-1 through SEC-13 remain open as of 2026-05-20
- `input-output-lab/openhiveos` is PUBLIC from day one — this is the single constraint that eliminates Option B

**Out of scope:** Python greenfield R&D (deferred to Richo), ARCH-008 (Shared Primitives), ZTNA ADR, frontend/dashboard, opensquad-mcp-server rename.

---

## Options Considered (Silas)

### Option A — Greenfield Scaffold

Fresh package.json, all configuration files authored from scratch. All 8 OS Primitives reimplemented net-new (not extracted from opensquad-mcp-server). Fresh migration chain from 001_init.sql. ARCH-001 bearer token auth reimplemented from scratch.

**Effort:** Medium (3–4 days)
**ARCH alignment:** Full (ARCH-001 through ARCH-006)
**Security:** Acceptable with conditions — auth reimplementation carries OWASP A07:2021 risk (timing oracle, entropy, missing validation paths)
**Vote:** Not selected as primary path. Available as per-primitive fallback with Locksmith approval.

---

### Option B — Structured Fork After ARCH-005 Option 1 Checkpoint

Fork opensquad-mcp-server after module decomposition completes. Delete Utilities, Express wiring, integration tooling from fork. Adapt scaffold. Git history of fork carries months of internal IO Labs production system commits.

**Effort:** Low (1–2 days — theoretical; gated on Murphy completing ARCH-005 Option 1 on production)
**ARCH alignment:** ARCH-005 CONDITIONAL (requires gate that is in-flight); ARCH-006 at risk (product boundary discipline harder to maintain in a structurally similar repo)
**Security:** BLOCKED — Locksmith binding determination (OWASP A02:2021)
**Vote:** BLOCKED. Two independent binding determinations. Does not proceed.

**Block 1 (Locksmith — binding):** Git history contamination on public repo is unacceptable under OWASP A02:2021. Squash verification cannot be performed at scale with confidence. Blast radius = live IO Labs production credential exposure.
**Block 2 (Cooper — infrastructure):** Public-from-day-one eliminates squash-and-verify path. Any push before verification = live security incident risk.
**Supporting (Murphy):** Self-referential gate — Murphy is executing ARCH-005 Option 1; Option B serialises two workstreams that must be parallel.
**Supporting (Clarence):** Documentation integrity — git history contradicts the README; product identity cannot survive an internal system fork history on a public repo.

---

### Option C — Selective Extraction ← SELECTED (8/8 unanimous)

Fresh scaffold (clean package.json, tsconfig, ESLint config, enforced directory structure with src/primitives/ and src/utilities/ present from commit one). Each of the 8 OS Primitives tools extracted individually from opensquad-mcp-server's src/primitives/, reviewed against SEC-1–8 and new SEC-14–20, and committed as a discrete PR (one PR per primitive). Fresh migration chain from 001_init.sql. ARCH-001 bearer token extracted with supervised review — not reimplemented from scratch.

**Effort:** Medium (3–4 days, parallelisable — Cooper infra and Murphy extraction run as independent tracks)
**ARCH alignment:** Full (ARCH-001 through ARCH-006); synergistic with ARCH-005 in-flight work
**Security:** Acceptable — Locksmith concurs subject to SEC-14 through SEC-20 binding conditions
**Vote:** Unanimous 8/8

---

## Cross-Seat Review

### Murphy — Backend

- Option C removes the self-referential gate risk: Murphy is executing ARCH-005 Option 1; Option B would require its completion before OpenHiveOS could scaffold. Option C runs in parallel.
- Extraction of 8 primitives is faster than reimplementation from scratch (Option A) because Murphy extracts from a reviewed source with a security checklist, not from memory.
- Per-primitive PR discipline is the correct granularity — one PR per tool, one SEC condition review per merge.
- Key risk named: partial-decomposition fork risk (Option B only) — if fork fires while module decomposition is mid-flight, OpenHiveOS inherits a half-migrated tool set. SEC surface starts at an unknown baseline.
- **Preference: Option C.**

### Rocket — Frontend

- No frontend work in the inception sprint — minimal direct impact.
- Future-sprint implication: Option C's clean scaffold means 8 Primitives are explicitly inventoried when squad-api eventually proxies or queries OpenHiveOS. Known API surface = cleaner dashboard integration design.
- Flagged: Option B's SEC propagation would delay productization timeline — delays provisionable Squad Instance that the per-Squad dashboard requires for validation.
- **Preference: Option C.**

### Cooper — DevOps

- Public-from-day-one eliminates Option B. Squash verification of months of internal production history before any push is operationally unacceptable.
- Options A and C are operationally identical for Cooper's tasks (#1283, #1289, #1290). Cooper's work is unblocked under both.
- Additional conditions Cooper added to #1289:
  - PgBouncer service stub in Compose from inception (disabled via PGBOUNCER_ENABLED=false; Sprint 4 flips the flag — no Compose restructure required).
  - Per-Squad DB role pairs templated in Compose (POSTGRES_USER = opensquad_app_${SQUAD_SLUG}) — not hardcoded.
  - No inter-Squad networking in Compose — no `external: true` declarations (SEC-13 moratorium).
  - Port 3002 conflict must be resolved before Compose port allocation finalised.
- **Preference: Option C.**

### Clarence — Documentation

- Option B is the only option Clarence cannot recommend. Git history is product documentation. A public README that claims a clean origin story while git log tells a different story is a documentation integrity failure.
- Under Option B, code comments, JSDoc, and inline documentation written for an internal IO Labs audience would contaminate the public repo. ARCH-006's banned vocabulary list (tenant, namespace, org) may appear in those comments.
- Option C: extraction review is a built-in documentation gate. Before each primitive commits, Clarence can verify ARCH-006 canonical taxonomy (Squad, not tenant; Operator, not customer) at the tool level.
- Flagged pre-existing documentation debt that must be remediated before public repo publish:
  - docs/README.md references "opensquad-mcp-server" — must be rewritten.
  - ARCH-001 through ARCH-006 frontmatter uses `project/opensquad` and `project: opensquad-mcp-server` tags — must be updated to `project/openhiveos`.
- **Preference: Option C.**

### Nova — Cross-Project

- Option B creates a sequencing conflict with ARCH-005 Option 1 (in-flight on production). Options A and C run fully independently.
- openBridge integration contract: SEC-13 moratorium blocks inter-Squad communication regardless of option. Option C defers the Utilities API contract question cleanly (Primitives-only public repo; openBridge connects to Utilities which don't yet exist in OpenHiveOS).
- **Org-wide finding:** The extraction discipline should become a Factory Standard. This is the first time the ARCH-003 two-tier model is applied to a real product boundary. Every future Squad deployment follows the same pattern. Clarence files the Factory Standard to Obsidian vault after ADR is signed.
- **Strategic finding:** Option C best accelerates the ARCH-006 constitutional split (opensquad-mcp-server = IO Labs internal; OpenHiveOS = public product). Supervised extraction is the audit mechanism that confirms no IO Labs-internal implementation detail contaminates the public codebase.
- Portfolio governance note: portfolio type blocks sprint advancement until SEC-13 ZTNA ADR is ratified. Flag for Elizabeth's sprint planning.
- **Preference: Option C.**

### Locksmith — Security

- **Option B: BLOCKED. Binding determination. No mitigation acceptable.**
  - OWASP A02:2021 — Git history contamination on a public repo. If any secret committed at any point in production history reaches the public repo, it is trivially recoverable permanently.
  - OWASP A05:2021 — Internal endpoint references, environment variable patterns, internal config structures become permanently public.
  - Cooper's infrastructure block is concurred with on independent security grounds.

- **Option A: Conditionally acceptable.** Auth reimplementation risk (OWASP A07:2021). Requires mandatory post-implementation security review before any merge to main.

- **Option C: Locksmith concurs.** Subject to SEC-14 through SEC-20 binding conditions.

- **New SEC conditions established (SEC-14 through SEC-20):**
  - **SEC-14** — Branch protection active before first commit
  - **SEC-15** — Secrets scanning (gitleaks or trufflehog) pre-commit hook + CI gate before first commit
  - **SEC-16** — Constant-time comparison audit on ARCH-001 bearer token extraction — **Locksmith sign-off binding gate** before auth middleware merges to main
  - **SEC-17** — Per-primitive dependency CVE scan (Trivy) before each primitive PR merges
  - **SEC-18** — STRIDE threat model covering MCP server's public API surface committed before v0.1 tag
  - **SEC-19** — Zero internal IO Labs references — automated grep scan + CI hard merge gate
  - **SEC-20** — Rate limiting specified as a documented security requirement before v1.0

- SEC-13 ZTNA moratorium explicitly extends to OpenHiveOS. The ZTNA ADR must name OpenHiveOS in scope when Silas authors it.
- **Binding gate:** No auth middleware merges to `main` without written Locksmith sign-off on SEC-16. Murphy cannot self-certify.

---

## Decision Matrix

| Option | Effort | Platform Fit | Security Risk | Ops Complexity | Doc Integrity | Votes |
|--------|--------|-------------|--------------|----------------|---------------|-------|
| **Option A — Greenfield** | Medium (3–4d) | ✓ Full | Medium (auth reimplementation risk) | Low | Clean | 0 / 8 |
| **Option B — Fork** | Low (theoretical; gated on in-flight production work) | ✗ Conditional + product boundary risk | **BLOCKED** (Locksmith binding + Cooper block) | High | Compromised | 0 / 8 |
| **Option C — Extraction** | Medium (3–4d, parallelisable) | ✓ Full; synergistic with ARCH-005 | Acceptable (SEC-14–20 binding) | Low (parallel tracks) | Clean + audit trail | **8 / 8** |

---

## Decision

**Chosen:** Option C — Selective Extraction
**Vote:** Unanimous 8/8
**Rationale:** Option B is eliminated by two independent binding determinations (Locksmith security block; Cooper infrastructure block). Option A is conditionally acceptable but inferior because the ARCH-001 auth reimplementation from scratch carries real risk that Option C's supervised extraction eliminates. Option C delivers the clean public repo, the clean migration chain, the per-primitive audit trail, and the org-wide Factory Standard — simultaneously and without a single hard dependency on in-flight production work.

---

## ADR

Filed as [ARCH-007-openhiveos-codebase-strategy.md](../ARCH-007-openhiveos-codebase-strategy.md).

---

## Action Items

- [x] **Create GitHub repo `input-output-lab/openhiveos`** — private initially; branch protection, CI gate (lint + type-check), SEC-14 and SEC-15 wired before first commit — **Owner: Cooper** — **DONE: 2026-05-20** — https://github.com/input-output-lab/openhiveos
- [ ] **Set up DNS holding page** — openhiveos.com + openhiveos.io — **Owner: Cooper** — **Due: Inception Sprint Day 1**
- [ ] **Scaffold `src/primitives/` and `src/utilities/` structure** — ESLint import boundary rules, module boundary structural from commit one — **Owner: Murphy** — **Due: Inception Sprint Day 1–2**
- [ ] **Finalise `squad.manifest.json` schema (#1287)** — before first migration is written — **Owner: Murphy** — **Due: Inception Sprint Day 2**
- [ ] **Extract each of the 8 OS Primitives** — one PR per primitive; each reviewed against SEC-1–8 and SEC-14–20; CVE scan (SEC-17) per primitive — **Owner: Murphy** — **Due: Inception Sprint**
- [ ] **SEC-16 audit** — constant-time comparison audit on ARCH-001 bearer token extraction; written report sent to Locksmith before auth middleware PR opens — **Owner: Murphy** — **Due: Before auth PR**
- [ ] **SEC-16 Locksmith sign-off** — written sign-off on constant-time comparison audit before auth middleware merges — **Owner: Locksmith** — **Due: Before auth PR merge**
- [ ] **Implement `squad_config` table + boot fingerprint guard + GET /health** (#1288) — net-new implementation — **Owner: Murphy** — **Due: Inception Sprint**
- [ ] **Design Docker Compose Squad artifact** (#1289) — PgBouncer stub present (disabled by default), per-Squad role pairs templated, no inter-Squad networking, GET /health healthcheck — **Owner: Cooper** — **Due: Inception Sprint**
- [ ] **Resolve port 3002 conflict** — confirm what currently owns 3002 on production host; select next available port for OpenHiveOS MCP server before Compose port allocation finalised — **Owner: Cooper** — **Due: Before #1289 finalises**
- [ ] **Update `docs/glossary.md`** — ARCH-006 obligation; does not gate on this decision — **Owner: Clarence** — **Due: This Sprint**
- [ ] **Remediate ARCH-001–006 frontmatter** — update `project/opensquad` and `project: opensquad-mcp-server` tags to `project/openhiveos` before public repo publish — **Owner: Clarence** — **Due: Before public push**
- [ ] **File ARCH-007** — written to docs/ — **Owner: Clarence** — **Status: Complete (this session)**
- [ ] **File Factory Standard to Obsidian vault** — "OS Primitives Extraction — Squad Scaffold Standard" — tagged `type/standard`, `domain/architecture` — **Owner: Clarence** — **Due: This Sprint**
- [ ] **Write STRIDE threat model** (#SEC-18) — MCP server public API surface — **Owner: Silas + Locksmith** — **Due: Before v0.1 tag**
- [ ] **ZTNA ADR** — must name OpenHiveOS in scope; separate review — **Owner: Silas** — **Due: Before inter-Squad openBridge use**
- [ ] **Richo L10 agenda: Python greenfield R&D decision** (PROD-2, deferred from ARCH-005) — **Owner: Elizabeth** — **Due: Next L10**
- [ ] **Richo L10 agenda: Portfolio sprint-sync workaround** — OpenHiveOS type:portfolio blocks sprint advancement until SEC-13 ratified — confirm constraint is accounted for in sprint planning — **Owner: Elizabeth** — **Due: Next L10**
