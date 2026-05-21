---
title: "ARCH-012 — Squad API and Dashboard: Service Architecture, Port Assignment, and Auth Model"
date: 2026-05-21
updated: 2026-05-21
author: "Clarence"
owner: "Silas"
status: active
tags:
  - type/adr
  - project/openhiveos
  - domain/architecture
  - domain/backend
  - domain/security
  - domain/devops
review_date: 2026-08-21
doc_id: "ARCH-012"
related:
  - "[[ARCH-004-agent-os-consolidation]]"
  - "[[ARCH-005-agent-os-canonical-architecture]]"
  - "[[ARCH-008-openhiveos-founding-decisions]]"
---

# ARCH-012 — Squad API and Dashboard: Service Architecture, Port Assignment, and Auth Model

> **Status:** Decided — binding from 2026-05-21
> **Decision Owner:** Silas
> **Approved by:** Elizabeth
> **Filed by:** Clarence

---

## ADR-ARCH-012 — Squad API and Dashboard: Service Architecture, Port Assignment, and Auth Model

**Date:** 2026-05-21
**Project:** openhiveos
**Status:** Decided
**Decision Owner:** Silas
**Approved by:** Elizabeth

---

**Context:**

ARCH-004 Decision 3A established the build-time embed of squad-dashboard into squad-api as the target architecture. Implementation was blocked behind an unresolved port conflict: google-workspace-mcp-server occupies port 3002, which was the previously assigned port for squad-api. No implementation could begin until a port was confirmed free, an auth model was defined for dashboard access, and the database role strategy was formalised to prevent squad-api from inheriting the MCP container's broad permissions. Three options were presented to the full squad: Option A (new dedicated Express/TypeScript ESM service on a clean port with embedded Vue 3 SPA), Option B (five-service topology with a standalone Nginx-served dashboard), and Option C (dashboard and API functionality extended directly into the existing MCP container). A unanimous decision was reached in favour of Option A.

---

**Decision:**

squad-api is implemented as a new, standalone Express/TypeScript ESM service running on port 3005. Port 3005 is the next clean allocation confirmed free of conflict after google-workspace-mcp-server's occupation of port 3002. The Vue 3 SPA (squad-dashboard) is embedded into squad-api at compile time: `npm run build` produces `dist/`, which squad-api serves via `express.static()` with a SPA fallback route for all paths not matching the `/api/` prefix. The two are a single deployment unit in production — same origin, no CORS. The MCP container (opensquad-mcp-server) is not modified. squad-api authenticates dashboard requests using the existing agent bearer-token model. A `dashboard` agent row is provisioned via a migration (not at runtime) so that the token has a stable, auditable identity in the `agents` table. At runtime, squad-api connects to PostgreSQL using an `openhiveos_reader` role scoped to SELECT-only access — it has no DDL or DML capability. By default, squad-api binds to `127.0.0.1` and is not directly exposed to external traffic; the reverse proxy is the public entry point.

---

**Rationale:**

Option A satisfies the ARCH-004 Decision 3A embed contract without introducing new service boundaries, new CORS surface, or a new language runtime on the host. The single-origin production model eliminates the class of cross-origin auth bugs that plagued earlier iterations and reduces reverse proxy configuration to one entry. The `openhiveos_reader` SELECT-only role enforces the principle of least privilege at the database layer, ensuring squad-api cannot mutate state even if its application logic is compromised. The agent bearer-token auth model reuses an already-audited identity mechanism, meaning no new auth primitive is introduced and Locksmith's existing token-lifecycle controls apply directly.

---

**Trade-offs accepted:**

The squad consciously accepts that the embedded dashboard cannot be deployed independently of squad-api — a frontend-only change requires a full squad-api build and deploy. The `openhiveos_reader` role naming may not align with the `squad_api_user` naming pattern that Silas is evaluating for long-term role standardisation; this creates a potential rename migration before the role is finalised. The localhost-bind default means that a misconfigured reverse proxy is the only external exposure path — the squad accepts that proxy configuration correctness is an operational dependency, not a technical one enforced by the application.

---

**Consequences:**

- **Code:** squad-api gains a `dist/` serve block, SPA fallback route, rate-limiting middleware (20 req/min), and Helmet CSP configured for the embedded dashboard. All existing `/` routes are namespaced under `/api/`.
- **Schema:** A new migration provisions the `dashboard` agent row (SEC-A1) and creates the `openhiveos_reader` role with SELECT grants on the required tables (SEC-A3, SEC-A5). The migration must include a `CREATE ROLE IF NOT EXISTS` guard (PRE-1).
- **Infra:** Port 3005 is allocated to squad-api on the production host. Cooper must verify it is free before deployment (PRE-2). The standalone squad-dashboard PM2 entry and reverse proxy config are retired upon successful embed deploy (ARCH-004 Decision 3A).
- **Environment:** `DASHBOARD_AGENT_TOKEN` is an environment variable only — never committed, never logged, covered by gitleaks scanning (SEC-A2).
- **Documentation:** This ADR supersedes the dashboard section of ARCH-004 Decision 3A for port assignment and auth model specifics. The squad-api component Workdoc (section 00 - Overview and 07 - Guides) must be updated to reflect the embed architecture, port, and auth model before the sprint closes. The OpenAPI spec `servers[].url` must be updated post-embed.

---

**Security review:**

Locksmith signed off on Option A subject to six binding conditions, all of which must be satisfied before the first merge to main:

- **SEC-A1:** The `dashboard` agent row is provisioned via a checked-in migration, not at application runtime. No dynamic agent creation occurs on server boot.
- **SEC-A2:** `DASHBOARD_AGENT_TOKEN` exists in environment variables only. It is not logged, not returned in any API response, not committed to source control. gitleaks scanning covers it explicitly.
- **SEC-A3:** squad-api binds to `127.0.0.1` by default. External binding requires an explicit environment variable override. The default is not permissive.
- **SEC-A4:** Rate limiting of 20 requests per minute is implemented and verified before the first merge. It is not a post-launch item.
- **SEC-A5:** squad-api connects using the `openhiveos_reader` SELECT-only role. No superuser fallback path exists. The application cannot escalate its own database privileges.
- **SEC-A6:** No token hash, salt, or raw token bytes appear in any API response, log line, or error message. The token is write-once at provisioning; it is never readable after that point.

---

**Rejected alternatives:**

- **Option B — Five-service topology with standalone Nginx-served dashboard:** Rejected because it directly conflicts with ARCH-004 Decision 3A, which explicitly prohibited separate deployment units for squad-api and squad-dashboard. A five-service topology increases CORS surface area, requires a second reverse proxy entry, and adds operational complexity without architectural benefit. Additionally, this option was blocked by Locksmith on the grounds that a separate Nginx-served dashboard with a cross-origin API increases the attack surface for token interception and CSRF. Deferred indefinitely pending SPIKE #250 resolution — if SPIKE #250 changes the auth model materially, Option B may be reconsidered at that time.
- **Option C — Dashboard and API extended into the existing MCP container:** Hard-vetoed by Cooper and Locksmith. The MCP container runs opensquad-mcp-server, which uses the `opensquad_app` role — a DML-capable runtime role that is not scoped for read-only dashboard queries. Extending the container would violate OWASP A01:2021 (Broken Access Control) by co-locating the dashboard's SELECT operations with the MCP server's INSERT/UPDATE operations under a shared database principal. Furthermore, the MCP container communicates via stdio — any API restart would drop active stdio sessions, creating an unacceptable availability impact on all connected agents. This option is permanently closed.

---

**Open conditions (non-blocking):**

- **DB role naming standardisation:** The role name `openhiveos_reader` may be renamed to align with a `squad_api_user` naming pattern if Silas decides to standardise role names before the migration is finalised. This decision must be made before the migration is merged — it cannot be renamed cleanly after the role has been created in production.
- **SPIKE #250 timing risk:** The REST-based auth design implemented under Option A must be reviewed against the output of SPIKE #250 when it is available. If SPIKE #250 recommends a materially different auth model, a follow-up ADR is required. SPIKE #250 does not block Option A implementation — it is a scheduled checkpoint, not a prerequisite.
