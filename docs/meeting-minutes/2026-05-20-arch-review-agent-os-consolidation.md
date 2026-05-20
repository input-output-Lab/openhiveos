---
title: "ARCH-004 Architecture Review — Agent OS Consolidation"
date: 2026-05-20
type: meeting-minutes
status: filed
facilitator: Elizabeth
primary_voice: Silas
participants:
  - Silas
  - Murphy
  - Rocket
  - Cooper
  - Clarence
  - Nova
  - Locksmith
  - Elizabeth
tags:
  - type/meeting-minutes
  - project/opensquad
  - project/openbridge
  - domain/architecture
  - domain/backend
  - domain/devops
  - domain/security
related:
  - "[[ARCH-004 — Agent OS Consolidation]]"
  - "[[ARCH-003 — Agent OS Two-Tier Model]]"
---

# ARCH-004 Architecture Review — Agent OS Consolidation
**Date:** 2026-05-20  
**Facilitator:** Elizabeth  
**Primary Voice:** Silas  
**Filed by:** Clarence

---

## Context

This review was convened as a direct consequence of ARCH-003 (filed 2026-05-19), which formally designated OpenSquad as the Agent OS for IO Labs. ARCH-003's decision raised an immediate downstream question: if OpenSquad is the Agent OS, what structurally is the Agent OS? At the time of this review, it consisted of four separate repositories, four PM2 processes, and four `.env` files with no coordinated versioning.

The review evaluated three consolidation proposals submitted by the Founder:
1. Merge openBridge into openSquad
2. Productization for single-command install
3. Merge squad-api and squad-dashboard into a single bundle

---

## Step 1 — Elizabeth's Problem Framing

**Problem:** Four repos (`opensquad-mcp-server`, `openbridge-mcp-server`, `opensquad-api`, `opensquad-dashboard`) with independent deployment lifecycles, independent package.json files, independent `.env` files, and no coordinated versioning. An OS that lives in four repos started by four PM2 processes is not an OS — it is a set of services that share a database.

**Constraints:**
- openBridge Sprint 1 is active (started May 1). No mid-sprint disruption.
- ARCH-003 open conditions (naming gate, tier governance, MemPalace) unresolved.
- `opensquad-mcp-server` is production — no breakage without maintenance window.
- openBridge has its own migration history, Ed25519/TOFU trust model, CloseSaga protocol, RevocationPropagation service.
- Budget: productization competes with client delivery.

**Out of scope:** MCP tool surface changes, MemPalace authority, client-facing packaging, new external integrations.

---

## Step 2 — Silas's Option Proposals

### Sequencing note (Silas)
Proposals are not independent. Silas established: **Proposal 1 decision → Proposal 3 decision → Proposal 2 execution.**

Proposal 3 gates Proposal 2 (install shape depends on component count). ARCH-003 Conditions 1+2 gate Proposal 2's external documentation.

---

### Proposal 1 — openBridge / openSquad Boundary

**1A (DECIDED): No Merge — Formal Shared-DB Contract**  
openBridge and openSquad remain separate repos, processes, and deployment units. Shared PostgreSQL instance formalized with `openbridge_app` role with explicit GRANT scope.

**Rationale for rejection of alternatives:**
- **1B (Monorepo):** Mid-sprint disruption, monorepo tooling overhead not justified at current scale.
- **1C (Full Process Merge):** Architecturally incorrect. SHA-256 bearer token (ARCH-001) and Ed25519/TOFU (ADR-004) identity models are incompatible in a single process. Would require a new threat model (6–8 weeks minimum). Breaks ARCH-001, ADR-004, ADR-005. Vetoed by Silas.

**Locksmith note:** Full process merge would collapse the ZTNA boundary openBridge established in ADR-005. Not a style preference — a security architecture violation.

---

### Proposal 3 — squad-api + Dashboard Bundle

**3A (DECIDED): Build-Time Static Embed**  
Vue dashboard build output (`dist/`) served from Express via `express.static()`. Same-origin API calls. One PM2 entry. One port (3002).

**Rationale for rejection of alternatives:**
- **3B (Separate deployables, release coordination):** The do-nothing option. No architectural improvement. CORS remains necessary, two services to manage.
- **3C (BFF Pattern):** Premature optimization. Scope expansion beyond the milestone. Revisit in six months if performance data justifies it.

---

### Proposal 2 — Productization

**2A (DECIDED AS TARGET): Docker Compose Bundle**  
Service topology: PostgreSQL+pgvector (digest-pinned), migrate-init (one-shot), opensquad-mcp-server, squad-api with embedded dashboard. openBridge stays host-native PM2 per Decision 1A.

**Rationale for rejection of alternatives:**
- **2B (CLI wrapper / npx):** Valid long-term operator experience but 3+ sprint investment. npm publish supply chain risk requires separate Locksmith review of publish workflow. Sequence after 2A is validated.
- **2C (Single static binary):** Requires a spike to validate native module compatibility (pg, pgvector). Breaks PM2 operational model. `crypto.timingSafeEqual` must be validated under Bun runtime if Bun is chosen. Not the first productization target.

---

## Step 3 — Cross-Seat Review Summary

### Murphy (Backend)
- **Critical (1A):** `openbridge_app` must have SELECT only on `factory_tasks`. `notify_task_review()` trigger fires on UPDATE to `status` — openbridge UPDATE would enqueue cross-process MCP events. Zero UPDATE grants.
- **Critical (3A):** Vue Router namespace collision. Express API routes currently at `/thoughts`, `/agents`, etc. When Express also serves the SPA, browser deep-links hit API routes, not `index.html`. API routes **must** be prefixed `/api/` before 3A ships. This is a breaking change for all existing squad-api consumers.
- **Critical (3A):** Express SPA fallback must use regex excluding `/api/` prefix. Without this, undefined `/api/` routes return HTML 200 instead of JSON 404.
- **3A pre-conditions:** `dist/` must not be committed (add `public/` to `.gitignore`). `vite-plugin-vue-mcp` must be dev-only — verify no `/__mcp` reference in production `dist/index.html`.
- **2A:** Use `pgvector/pgvector:pg17` image, not stock `postgres:17` — migration 001 runs `CREATE EXTENSION vector` which fails on stock image.

### Rocket (Frontend)
- **Vite config:** `base` is fine as-is (defaults to `/`). Use `rsync` postbuild script rather than pointing `outDir` at another app's directory.
- **Env vars:** `VITE_SQUAD_API_URL` retained for dev; empty string for production (same-origin fallback already works). Suppress `console.warn` in production.
- **Dev workflow:** Vite dev server with `server.proxy` pointing `/api` to Express port 3002. Do not serve from Express in dev — kills HMR.
- **`vite-plugin-vue-mcp`:** Dev-only, no production artifacts. Verify `dist/index.html` after first production build.
- **Old squad-dashboard:** Does not exist at `/Users/richo/Sites/inputoutputco/squad-dashboard` on this machine. Nothing to deprecate locally. Canonical dashboard: `/Users/richo/Sites/inputoutputco/OpenSquad/apps/opensquad-dashboard/`.
- **Helmet CSP:** Test `mermaid securityLevel: 'strict'` first. If `unsafe-eval` required, must use nonce. Also need `img-src data:` for Mermaid SVG rendering.

### Cooper (DevOps)
- **`openbridge_app` DDL:** `CREATE ROLE WITH LOGIN PASSWORD, CONNECTION LIMIT 10, NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`. `REVOKE CREATE ON SCHEMA public`.
- **PITR gap:** Only daily `pg_dump` (24h data loss window). Immediate fix: 4h cron. Sprint 2: WAL archiving. Named accepted risk.
- **Port 3002 conflict (BLOCKER for 3A):** Memory records show `google-workspace-mcp-server` also allocated to port 3002. Must confirm live port map via `lsof -i -n -P | grep LISTEN` before 3A deploys.
- **Backup gap:** `backup.sh` only covers `opensquad` database. After 1A, must also cover `openbridge`.
- **Advisory lock:** Required before concurrent migrations possible from two repos. Operational serialization in runbook until implemented.
- **2A host-native DB:** PostgreSQL instance is shared with `iolabs_sdr` and `io_auth`. Cannot containerize DB without a separate decision affecting those systems.
- **Deploy script pattern:** Build dashboard → verify `dist/` non-empty → copy to `public/` → build squad-api → `pm2 restart` (last step via `set -euo pipefail`).

### Clarence (Documentation)
- Three artifact groups required: (1) Shared-DB Contract SOP in vault, (2) squad-api combined service docs + squad-dashboard deprecation notice, (3) OPERATOR.md + updated quickstart.md + deployment runbook + glossary entry.
- ARCH-004 ADR structure defined in review — filed as `docs/ARCH-004-agent-os-consolidation.md`.
- All artifacts require Obsidian frontmatter: `type/sop` or `type/adr`, `project/opensquad`, `domain/architecture`, `domain/backend`, `domain/devops`.
- OpenAPI spec `servers[].url` must be confirmed correct post-embed.

### Nova (Strategic Intelligence)
- **Key revelation:** `openbridge_app` role was **already provisioned by Cooper on April 25**. 1A is formalization, not creation. The governance gap is "who holds veto authority over shared-DB migrations" — not the role itself.
- **Governance precedent:** Formalizing `openbridge_app` creates an audit obligation for `iolabs_sdr` and `io_auth` (also on shared instance, not under equivalent formalization). Clarence must inventory before 1A is filed.
- **3A timing:** Adds scope to squad-api milestone A (June 27). Elizabeth needs a re-estimate before sprint planning.
- **2A SaaS question:** Docker Compose is a single-operator model, not extensible to multi-tenancy without replacement. This trade-off must be explicit in ARCH-004, not implicit.
- **Sequencing risk:** ARCH-003 Condition 2 gates 1A. ARCH-003 Condition 3 gates 2A. Both are Nova+Silas responsibility and are 6 days overdue.

### Locksmith (Security — Binding)
Eight binding conditions named. ARCH-004 does not advance to Active until all eight are closed.

See **Locksmith Binding Conditions** section below.

---

## Step 4 — Decision Matrix

| Dimension | 1A | 3A | 2A |
|---|---|---|---|
| Architecture alignment with ARCH-003 | 5/5 | 5/5 | 4/5 |
| Security posture (post-conditions met) | 4/5 | 4/5 | 3/5 |
| Operational risk | 4/5 | 3/5 | 2/5 |
| Delivery impact (client work protection) | 5/5 | 3/5 | 2/5 |
| Reversibility | 5/5 | 3/5 | 2/5 |
| **Total** | **23/25** | **18/25** | **13/25** |

---

### Named Disagreements

1. **Cooper vs. Silas on 2A timing:** Silas proposed 1A→3A→2A as a connected sequence. Cooper's assessment shows 2A has a hard pre-condition not modelled: the shared PostgreSQL instance cannot be cleanly containerized without affecting `iolabs_sdr` and `io_auth`. 2A is further from executable than the framing implies.

2. **Nova vs. Silas on 3A timing:** Silas treated 3A as executable now. Nova identifies it adds scope to a milestone already in-flight (June 27). Architectural approval of 3A does not automatically mean 3A executes in Sprint 2. Elizabeth owns scheduling.

3. **Locksmith vs. Rocket on `unsafe-eval`:** Rocket noted Mermaid may require `unsafe-eval`. Locksmith says test `securityLevel: 'strict'` first. This is a 2-hour spike (Task #1235), not a multi-sprint debate. Rocket runs the spike; the result is the answer.

---

## Decisions

| Decision | Selected Option | Status |
|---|---|---|
| Proposal 1 — openBridge/openSquad boundary | **1A** — No merge, formalize shared-DB contract | Conditionally decided — gate: SEC-1, SEC-2, SEC-3, ARCH-003 Condition 2 |
| Proposal 3 — squad-api + dashboard | **3A** — Build-time static embed | Conditionally decided — gate: SEC-4, SEC-5, port conflict, re-estimate, /api/ prefix |
| Proposal 2 — Productization | **2A** — Docker Compose (design now, execute Sprint 4+) | Approved as target — gate: SEC-6, SEC-7, SEC-8, ARCH-003 Condition 3, host-DB question |

---

## Locksmith Binding Conditions

ARCH-004 does not advance to **Active** until all conditions below are closed with documented evidence:

| # | Condition | Owner | Task | Blocks |
|---|---|---|---|---|
| SEC-1 | `openbridge_app` GRANT script committed: SELECT only on `factory_tasks`/`factory_projects`/`factory_crons`; zero grants on OS primitives; `CONNECTION LIMIT` set | Cooper | #1225 | 1A |
| SEC-2 | Table ownership register committed in ARCH-004; CI migration lint check enforces ownership boundary | Silas + Murphy | #1229 | 1A |
| SEC-3 | Sequential migration protocol in runbook; PITR gap named as accepted risk with owner and RTO in ARCH-004 | Cooper + Silas | #1233 | 1A |
| SEC-4 | Mermaid `securityLevel: 'strict'` spike completed; `unsafe-eval` used only if strict mode insufficient; if required, nonce implemented | Rocket | #1235 | 3A |
| SEC-5 | SPA fallback regex excludes `/api/`; CI test asserts nonexistent `/api/` path returns JSON 404 not HTML | Murphy | #1226 | 3A |
| SEC-6 | `.gitignore` blocks `.env`; pre-commit hook; `.env.example` has no real values | Cooper + Murphy | #1227 | 2A |
| SEC-7 | `pgvector` image digest-pinned; Trivy scan documented in ARCH-004; HIGH/CRITICAL CVEs resolved or formally accepted | Cooper | #1236 | 2A |
| SEC-8 | Two DB roles: `opensquad_migrate` (DDL, init container only) / `opensquad_app` (DML only, runtime); `restart: no` on init container | Cooper + Murphy | #1237 | 2A |
