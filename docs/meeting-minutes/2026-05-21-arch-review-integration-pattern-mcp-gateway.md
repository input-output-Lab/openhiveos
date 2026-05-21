# Architecture Review — ARCH-016: Integration Pattern: nova-telegram-bridge Reference Implementation + Compose Profile

**Date:** 2026-05-21
**Project:** openhiveos
**Facilitator:** Elizabeth
**Primary Voice:** Silas
**Topic:** Canonical integration pattern for connecting external trigger sources (Bridge) to an OpenHiveOS Squad Instance

---

## Attendees

| Seat | Agent | Role in this meeting |
|---|---|---|
| PM / Facilitator | Elizabeth | Business constraints, final call |
| Systems Architect | Silas | Options proposal, decision matrix, ADR ownership |
| Backend | Murphy | Identity model impact, implementation feasibility |
| Frontend / UI | Rocket | Dashboard blast radius, health display |
| DevOps / Infra | Cooper | Port confirmation, Compose topology, build pipeline |
| Documentation | Clarence | Operator story, ADR filing, onboarding sequence |
| Cross-project | Nova | Bridge registry trigger, openBridge profile, org-wide standards |
| Security | Locksmith | SSE auth surface, SEC-D1–D11 binding conditions |

---

## Problem Statement

OpenHiveOS has an MCP server (stdio transport only — ARCH-008 D1, binding, non-negotiable), a squad-api (HTTP, port 3005, ARCH-012), and a provisioning CLI (ARCH-013/014). What it does not have is a canonical answer to: *how does an external trigger source — a Telegram bot, an API webhook, an inter-Squad bridge — connect to a Squad Instance and invoke MCP tools?*

The nova-telegram-bridge is the reference integration. In the IO Labs hosted setup, the Bridge connects to opensquad-mcp-server via HTTP/SSE. In OpenHiveOS, the MCP server is stdio-only. This is a structural incompatibility.

**Root cause identified by Silas:** This is not a networking or configuration problem — it is a process-hierarchy problem. `StdioServerTransport` requires a parent process to spawn the MCP server and communicate via stdin/stdout. Container A cannot attach to Container B's stdin/stdout across Docker Compose networking. Cooper confirmed this finding in ARCH-015 (killed Option A there for the same reason). The valid option space is entirely defined by *which process becomes the stdio parent*.

---

## Constraints

**Business:**
- Operator experience: attaching the Bridge to a Squad Instance must be achievable in documented steps — not a custom integration project.
- ARCH-008 D1 is non-negotiable. No HTTP/SSE transport added to the MCP server.
- T-01 spike is a hard operational gate. Integration can be provisioned; live data flows only after T-01 closes.

**Technical:**
- ARCH-008 D1: stdio transport only on MCP server binary.
- ARCH-005: Integrations → Coordination Utilities tier only. No Primitives tier access.
- ARCH-006: Integration = external system consuming Coordination Utilities.
- ARCH-012: squad-api = dashboard API + ingestion endpoint. `openhiveos_reader` SELECT-only.
- ARCH-015: squad-api `openhiveos_reader` constraint is a load-bearing security model — cannot be elevated.
- Docker Compose is the Squad Instance deployment artifact.
- SEC-13 moratorium: no external Docker networks.

**Out of scope:**
- Multi-Squad routing / bridge registry (Sprint 5+, ARCH-015 D15 — amended this session)
- openBridge ZTNA design (separate ADR, blocked by SEC-13)
- New MCP server transport

---

## Options Considered

### Option A — Bridge-in-Compose with StdioClientTransport

The nova-telegram-bridge becomes a Docker Compose service and spawns the MCP server binary as a stdio child process (`StdioClientTransport`). The MCP binary is shared via Docker volume or baked into the Bridge image.

- **Pros:** No new containers (Bridge IS the Compose service). `StdioClientTransport` is in the SDK. Blast radius isolated to Bridge.
- **Cons:** Cross-repo binary coupling; version drift risk; ARCH-006 violation (bypasses Coordination Utilities tier); ARCH-001 identity model broken (dual-process agent slug ambiguity, fingerprint race on second cold start).
- **Effort:** Medium
- **Platform fit:** Breaks ARCH-006, ARCH-001
- **Status:** BLOCKED (Murphy: identity model; Locksmith: OWASP A09)

### Option B — squad-api Absorbs MCP Subprocess Lifecycle

squad-api spawns the MCP server binary as a stdio child process and exposes the MCP protocol over SSE/HTTP at `/mcp`. Bridge's `SSEClientTransport` points at squad-api.

- **Pros:** Bridge transport unchanged; one-line URL change on Bridge.
- **Cons:** squad-api `openhiveos_reader` role must be elevated to writer — destroys ARCH-015 PoLP; squad-api scope expansion breaches ARCH-012 charter; Dashboard + Bridge blast radius merge (wrong); SSE proxy implementation is non-trivial and correctness-risky.
- **Effort:** High
- **Platform fit:** Breaks ARCH-012, ARCH-015
- **Status:** BLOCKED PERMANENTLY (Locksmith: OWASP A01 — PoLP destruction)

### Option C — Dedicated mcp-gateway Sidecar Container (Selected)

A new, single-purpose container (`openhiveos-mcp-gateway`) is added under the `integration` Compose profile. It spawns the MCP server binary via `StdioClientTransport` and exposes SSE internally on port 3006 (Compose-internal only). Bridge's `SSEClientTransport` URL changes to `http://openhiveos-mcp-gateway:3006` — one env var change.

- **Pros:** Clean single responsibility; contained blast radius; squad-api charter preserved; ARCH-008 D1 compliant; ARCH-005/006 compliant; no operator AI client disruption; Dashboard unaffected by gateway failure.
- **Cons:** New container; gateway becomes MCP single point of failure for Bridge operations; MCP binary version pinning required in Dockerfile.
- **Effort:** Medium (~150–200 lines custom TypeScript, custom build not open-source)
- **Platform fit:** Best fit across all binding constraints.
- **Status:** CONDITIONALLY APPROVED — SEC-D1 through SEC-D11 binding.

---

## Decision Matrix

| Option | Effort | Platform Fit | Security Risk | Ops Complexity | Test Complexity | Result |
|---|---|---|---|---|---|---|
| **A** (Bridge StdioClientTransport) | Medium | Breaks ARCH-006, ARCH-001 | OWASP A09 — dual-process identity (Murphy + Locksmith block) | Medium | Medium | **BLOCKED** |
| **B** (squad-api MCP gateway) | High | Breaks ARCH-012, ARCH-015 | OWASP A01 — PoLP destruction (Locksmith permanent block) | High | High | **BLOCKED PERMANENTLY** |
| **C** (mcp-gateway sidecar) | Medium | Best fit — all constraints satisfied | APPROVED — 11 SEC conditions | Low | Medium | **SELECTED** |

---

## Decision

**Chosen: Option C — Dedicated mcp-gateway sidecar container.**

**Unanimous: 7/7.** No dissent. Options A and B are blocked from multiple independent seats simultaneously.

---

## Seat Inputs Summary

### Silas (Systems Architect — Primary Voice)

**Process hierarchy insight:** The critical framing is that this is a process-hierarchy problem, not a networking problem. Valid options are entirely determined by which process is the stdio parent. Three structural shapes: (1) Bridge is the parent, (2) squad-api is the parent, (3) dedicated gateway is the parent.

**Four open questions raised:**
1. Custom build or open-source proxy for the gateway?
2. Port 3006 — Cooper must confirm.
3. Gateway restart policy and subprocess restart chain.
4. Bridge reconnect behaviour on gateway restart.

**Recommendation:** Option C is the architecturally cleanest shape. The only option satisfying all four binding constraints simultaneously. Options A and B have structural, not implementation-level, problems.

---

### Murphy (Backend)

**Critical finding — AGENT_TOKEN identity model:**
The `AGENT_TOKEN` model resolves identity at process spawn — one process, one agent slug. Option A spawns a second subprocess, creating a dual-process identity race:
- Same token: fingerprint race condition in `checkFingerprint()`.
- Different token: two agent identities, writes invisible to each other.

This is a **structural ARCH-001 violation** — not remediable within Option A's architecture. Murphy's block on Option A.

**Option B deep finding:**
squad-api (ARCH-015) holds `openhiveos_reader` permission. Absorbing MCP subprocess management requires adding `AGENT_TOKEN`, `GEMINI_API_KEY`, and writer `DATABASE_URL` to squad-api's env — three new env vars and a role elevation. The `openhiveos_reader` constraint was a deliberate security design in ARCH-015. Blowing it for proxy function defeats the security model.

**Option C implementation notes (binding):**
- Custom build — not open-source. `@modelcontextprotocol/sdk` already in the dependency tree; ~150–200 lines TypeScript.
- `HEALTH_PORT=3007` must be injected into gateway subprocess spawn at spawn time (not env inheritance from gateway). Otherwise: port collision with standalone `mcp` container.
- Tool list re-fetch must be atomic with subprocess restart — gateway must not accept Bridge reconnections until `checkFingerprint()` completes.
- `MCP_GATEWAY_PORT` as env var in Compose `depends_on`/health check so it is not hardcoded.
- Preferred location: `packages/mcp-gateway/` or sibling repo (OQ E1).

**No in-flight conflicts.** ARCH-006/ARCH-015 outstanding tasks unaffected.

---

### Rocket (Frontend)

**Option A:** Zero Dashboard impact. Bridge invisible to frontend. MCP health unobservable without additional instrumentation.

**Option B:** Non-trivial impact. Squad-api failure = Dashboard outage. Right when operators need data visibility most (during an incident), it goes dark. squad-api scope creep also sets a precedent for the API the Dashboard depends on.

**Option C (hard preference):** squad-api stays isolated. Dashboard available during gateway failure. If gateway health surfaced in Dashboard later, it is one composable (`useGatewayHealth`) — additive, not structural.

**Blocker flag (if Option B were chosen):** squad-api surface must be frozen until ARCH-012 A5/A6 (dashboard scaffold) merges. Option C: no conflicts with A5/A6.

---

### Cooper (Infra)

**Port 3006 confirmed free.** Production host port map after this decision:
- 3001 = opensquad-mcp-server
- 3002 = google-workspace-mcp-server
- 3003/3004 = openbridge
- 3005 = openhiveos-squad-api
- 3006 = openhiveos-mcp-gateway (Compose-internal only)

**Compose profile:** `integration` (not `bridge` — Nova taxonomy flag applied).

**Restart policy:** `unless-stopped` — consistent with `mcp` and `postgres` services.

**Two-layer health check required:** Gateway HTTP `GET /health` (HTTP layer alive) AND MCP subprocess liveness (subprocess alive and past `checkFingerprint()`). Single-layer check misses the "zombie gateway" failure mode — gateway HTTP responds while subprocess is offline.

**Binary version pinning:** `ARG MCP_VERSION` in gateway Dockerfile. CI/CD must rebuild gateway when MCP server binary changes.

**Hard gates before this ships:**
A. Bridge deployment topology confirmed (Compose co-deploy vs PM2) — determines gateway port binding.
B. Locksmith threat model sign-off on internal SSE surface (ARCH-008 D1 gate).

**SEC-13 moratorium:** No external Compose networks. Both nova-telegram-bridge and openBridge connect to mcp-gateway as external processes (PM2) if they run outside Compose.

---

### Clarence (Documentation)

**Option A documentation assessment:** Broken at the first sentence. Cross-repo binary coupling means the operator story spans two repositories with ambiguous ownership. Every runbook section about the MCP process lifecycle carries an asterisk. This is a permanent documentation liability.

**Option B documentation assessment:** Contradicts the founding ARCH-012 definition of squad-api in the README index table, the ARCH-012 ADR, and every operator runbook section that describes squad-api. No clean replacement sentence exists. Permanent documentation debt compounding with every sprint.

**Option C documentation assessment:** Each component has one sentence. `squad-api`: Dashboard and ingestion endpoint. `mcp-gateway`: SSE-to-stdio translation for Bridge integrations. Both sentences are true, independent, and non-contradictory.

**Stage 6 canonical onboarding:**
> Generate `MCP_GATEWAY_TOKEN` (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Set `MCP_GATEWAY_URL` in Bridge. Run `docker compose --profile integration up -d openhiveos-mcp-gateway`. Success signal: `[mcp-gateway] SSE connection established` in Bridge logs.

**Clarence flags:**
- Bridge → gateway SSE auth surface must be ruled on by Locksmith before ADR files (SEC condition D1 requirement).
- Glossary additions required: `mcp-gateway`, `Integration Profile`.
- `docker-compose.yml` inline comment block documents profile name and purpose — operators read compose files before runbooks.

---

### Nova (Cross-project)

**Compose profile name:** Must be `integration` (not `bridge`). "Bridge" implies a specific technology; "integration" is the correct ARCH-006 taxonomy term for all external consumers.

**mcp-gateway is NOT an org-wide standard.** It is the canonical pattern for stdio-bound Squad Instances specifically. opensquad-mcp-server (the IO Labs hosted instance) exposes SSE natively — it does not need a gateway.

**openBridge does NOT join the Squad Compose stack.** SEC-13 moratorium prohibits external Compose networks. openBridge connects as an external PM2 process via SSE to `mcp-gateway` — same external path as nova-telegram-bridge. This is confirmed correct.

**ARCH-015 D15 trigger amendment (binding):** The ARCH-015 D15 trigger condition reads "third MCP server connects to Bridge." This was written before the gateway abstraction existed. The gateway makes this condition arrive faster than originally framed. Correct trigger: **second Squad Instance connects to Bridge OR Sprint 5 planning, whichever is first.** Silas must update D15 task description.

**Three hard gates before operational deployment:**
1. Locksmith threat model on internal SSE surface.
2. Bridge deployment topology confirmed (PM2 vs Compose co-deploy).
3. T-01 spike closure.

---

### Locksmith (Security — Binding)

**Option A: BLOCKED** — OWASP A09:2021. Dual-process AGENT_TOKEN identity race = audit trail integrity failure. Murphy's finding is a security finding, not just an implementation concern. Confirmed blocked.

**Option B: BLOCKED PERMANENTLY** — OWASP A01:2021. `openhiveos_reader` elevation destroys PoLP and invalidates ARCH-015 threat model. No remediation path exists within Option B's architecture.

**Option C: CONDITIONALLY APPROVED** — 11 binding SEC conditions (SEC-D1 through SEC-D11).

**KEY SECURITY RULING — Bridge → gateway SSE authentication:**

The question Clarence correctly flagged: what authenticates the Bridge's SSE connection to the gateway? Network isolation (Compose-internal port) is a hardening layer — it is NOT an auth control. Any process that can reach port 3006 must be authenticated.

**Ruling:** `MCP_GATEWAY_TOKEN` passed as `?token=` query parameter. `SSEClientTransport` / `EventSource` cannot send custom request headers — query parameter is the established IO Labs Factory pattern (same as OPENHIVEOS_INGESTION_TOKEN pattern from ARCH-015). Gateway validates with `crypto.timingSafeEqual` before SSE upgrade.

**CRITICAL — SEC-D3:** The `?token=` value appears in the URL and will be logged by most frameworks (Express, Fastify, etc.) in access logs by default. Token redaction from all access and error logs must be an explicit middleware step before the SSE upgrade. This is the highest-implementation-risk detail — not because it is complex, but because it is the most commonly missed.

**All 11 SEC conditions:**

| # | Condition |
|---|---|
| SEC-D1 | MCP_GATEWAY_TOKEN via `?token=` query param; timingSafeEqual before SSE upgrade |
| SEC-D2 | 32 bytes CSPRNG, 64 hex chars, Zod z.string().min(64) |
| SEC-D3 | **CRITICAL:** Token redacted from all access + error logs before SSE upgrade |
| SEC-D4 | `expose: ["3006"]` in Compose, NOT `ports:` |
| SEC-D5 | MCP_GATEWAY_TOKEN in gitleaks.toml |
| SEC-D6 | One AGENT_TOKEN = one agent identity; ADR-documented; multi-agent patterns prohibited without new ADR |
| SEC-D7 | HEALTH_PORT=3007 for subprocess (distinct from mcp container) |
| SEC-D8 | Tool list re-fetch atomic with subprocess restart; no SSE connections accepted until checkFingerprint() completes |
| SEC-D9 | Rate limit SSE connections: 10/min, 429 + Retry-After |
| SEC-D10 | Gateway env scoped: AGENT_TOKEN, GEMINI_API_KEY, DATABASE_URL, MCP_GATEWAY_TOKEN, MCP_GATEWAY_PORT, HEALTH_PORT. OPENHIVEOS_INGESTION_TOKEN excluded. |
| SEC-D11 | [MERGE GATE] Locksmith confirms D1–D10 closed in PR comment before any ARCH-016 code merges to main |

---

## Open Questions

| # | Question | Owner | Target |
|---|---|---|---|
| E1 | Gateway location: `packages/mcp-gateway/` (sibling package in this repo) or separate repo `openhiveos-mcp-gateway`? | Silas + Murphy | Before implementation begins |
| E2 | Bridge deployment topology: PM2 (host-native, gateway at `127.0.0.1:3006`) or Compose service (gateway at `http://openhiveos-mcp-gateway:3006`)? | Cooper + Silas | Before Compose file is written |
| E3 | openBridge Compose profile: same `integration` profile as `mcp-gateway` or separate `openbridge` profile? | Elizabeth + Silas | Sprint 4 planning |
| E4 | ARCH-015 D15 trigger amendment: update task description from "third MCP server" to "second Squad Instance connects to Bridge OR Sprint 5 planning" | Silas | Sprint 4 planning |

---

## Action Items

| # | Task | Owner | Priority |
|---|---|---|---|
| F1 | Resolve E1 (gateway package location) before any implementation begins | Silas + Murphy | First |
| F2 | Resolve E2 (Bridge deployment topology) before Compose file is written | Cooper + Silas | First |
| F3 | `packages/mcp-gateway/src/index.ts`: entry point, Express, `?token=` validation middleware with token redaction (SEC-D3 CRITICAL), rate limiter (SEC-D9), SSE endpoint | Murphy | Sprint 3/4 |
| F4 | `packages/mcp-gateway/src/gateway.ts`: StdioClientTransport subprocess management, tool forwarding, reconnect + re-fetch logic, readiness gate (SEC-D8) | Murphy | Sprint 3/4, after F3 |
| F5 | `packages/mcp-gateway/Dockerfile`: FROM node:20-alpine; ARG MCP_VERSION; EXPOSE 3006 (not ports:) | Cooper | Sprint 3/4 |
| F6 | `docker-compose.yml`: add `openhiveos-mcp-gateway` service under `integration` profile; `expose: ["3006"]` not `ports:`; `restart: unless-stopped`; two-layer health check; inline comment block | Cooper | Sprint 3/4, after F2 resolved |
| F7 | `.env.example`: all gateway env vars with security comments (MCP_GATEWAY_TOKEN, MCP_GATEWAY_PORT, HEALTH_PORT=3007) | Cooper | Sprint 3/4 |
| F8 | `gitleaks.toml`: MCP_GATEWAY_TOKEN detection pattern (SEC-D5) | Cooper | Sprint 3/4 |
| F9 | `HEALTH_PORT=3007` injected at subprocess spawn time in gateway code — NOT inherited from gateway container env | Murphy | Part of F3/F4 |
| F10 | Bridge update: change `MCP_GATEWAY_URL` to point at mcp-gateway. Gated on T-01 spike and E2 resolution. | Cooper + Murphy | T-01 gate |
| F11 | Clarence: ADR `docs/ARCH-016-integration-pattern-mcp-gateway.md` — DONE this session | Clarence | ✅ |
| F12 | Clarence: `docs/README.md` update — ADR row, minutes row, ARCH-012 topology note, footer | Clarence | This session |
| F13 | Clarence: Glossary additions — `mcp-gateway`, `Integration Profile` | Clarence | Before sprint closes |
| F14 | Clarence: Operator runbook Stage 6 section (onboarding sequence extended to 6 stages) | Clarence | Before sprint closes |
| F15 | [MERGE GATE] Locksmith SEC-D gate review — SEC-D1 through SEC-D10 confirmed closed before any ARCH-016 gateway code merges to main | Locksmith | PR review |
| F16 | Silas: Update ARCH-015 D15 task per Nova's amendment (OQ E4) | Silas | Sprint 4 planning |
| F17 | Resolve E3 (openBridge Compose profile) at Sprint 4 planning | Elizabeth + Silas | Sprint 4 planning |

---

## Canonical Operator Onboarding Sequence (Post-ARCH-016)

| Stage | Action | ADR |
|---|---|---|
| 1 | `docker compose --profile init run --rm one-init` | ARCH-013 |
| 2 | `docker compose --profile init run --rm provision --write-env .env.tokens` | ARCH-014 |
| 3 | `docker compose up` (core stack: mcp, postgres, squad-api) | ARCH-012 |
| 4 | Set `OPENHIVEOS_INGESTION_TOKEN` + `OPENHIVEOS_INGESTION_URL`; restart squad-api | ARCH-015 |
| 5 | Bridge connects — usage data appears in Dashboard | ARCH-015 (T-01 gate) |
| **6** | **Generate `MCP_GATEWAY_TOKEN`; set `MCP_GATEWAY_URL` in Bridge; `docker compose --profile integration up -d openhiveos-mcp-gateway`** | **ARCH-016** |

Stage 6 success signal: `[mcp-gateway] SSE connection established` in Bridge logs.

---

*Minutes recorded by Elizabeth. ARCH-016 decided 2026-05-21. Next: Sprint 4 planning — ARCH-011 Cron Utilities tier implementation. E1, E2, E3 open questions are Sprint 4 first-act items.*
