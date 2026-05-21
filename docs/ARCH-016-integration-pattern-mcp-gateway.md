---
title: "ARCH-016 — Integration Pattern: nova-telegram-bridge Reference Implementation + Compose Profile"
date: 2026-05-21
updated: 2026-05-21
author: "Clarence"
owner: "Silas"
status: active
tags:
  - type/architecture
  - project/openhiveos
  - domain/backend
  - domain/devops
  - domain/security
  - audience/technical
review_date: 2026-08-21
doc_id: "ARCH-016"
related:
  - "[[ARCH-001-server-resolved-agent-identity]]"
  - "[[ARCH-005-agent-os-canonical-architecture]]"
  - "[[ARCH-006-agent-os-product-boundary]]"
  - "[[ARCH-008-openhiveos-founding-decisions]]"
  - "[[ARCH-012-squad-api-dashboard-architecture]]"
  - "[[ARCH-015-llm-usage-tracking]]"
---

*This ADR defines the approved integration pattern for connecting an external bridge application (nova-telegram-bridge) to an OpenHiveOS Squad Instance. It is the canonical reference for the mcp-gateway sidecar design, the `integration` Compose profile, and the security conditions that govern all future in-Compose integrations.*

---

## ADR — ARCH-016: Integration Pattern: nova-telegram-bridge Reference Implementation + Compose Profile

**Date:** 2026-05-21
**Project:** openhiveos
**Status:** Decided
**Decision Owner:** Silas
**Approved by:** Elizabeth

---

## Context

OpenHiveOS MCP server is stdio-only (ARCH-008 D1, binding). The nova-telegram-bridge currently connects to an MCP server via SSE/HTTP. The design question: how does an external integration connect to a Squad Instance when the MCP server has no HTTP/SSE transport?

Silas identified the root cause as a process-hierarchy problem: `StdioServerTransport` requires a parent process to spawn the MCP server and communicate via stdin/stdout. Container A cannot attach to Container B's stdin/stdout across Compose networking. This is not a configuration gap — it is a fundamental property of the stdio transport. Any solution that attempts to resolve it by bridging containers directly is categorically wrong.

Three write-path candidates were evaluated:

- **Option A:** Bridge joins Compose, spawns MCP subprocess via `StdioClientTransport`, manages its own connection.
- **Option B:** squad-api absorbs MCP subprocess lifecycle, wraps in SSE/HTTP gateway on `/mcp`.
- **Option C:** Dedicated `mcp-gateway` sidecar container spawns MCP subprocess, exposes SSE internally on port 3006.

Full review conducted 2026-05-21. All three options were evaluated by the full panel (Silas, Murphy, Cooper, Locksmith, Elizabeth).

---

## Prerequisites

| Gate | Status | Owner |
|---|---|---|
| ARCH-012 squad-api running (port 3005) | Open | Murphy |
| ARCH-013/014 Ethos Seal + provisioning complete | Open | Murphy |
| T-01 spike: live Bridge deployment confirmed | Open | Silas |
| Port 3006 confirmed free on production host | **Confirmed** | Cooper |

**Operational gate:** T-01 spike (live OpenRouter cost field verification) must close before the Bridge connects to mcp-gateway operationally. The gateway can be built and deployed in isolation; the T-01 gate governs the moment the Bridge begins routing live tool calls through it.

---

## Decision

**Option C — Dedicated `openhiveos-mcp-gateway` sidecar container.**

A new, single-purpose container (`openhiveos-mcp-gateway`) is added to the Compose stack under the `integration` profile. Its sole responsibilities are:

1. Spawn the MCP server binary as a stdio child process (`StdioClientTransport`).
2. Expose the MCP protocol as an internal SSE endpoint on port 3006 (Compose internal network only — not host-exposed).
3. Validate connecting clients via `MCP_GATEWAY_TOKEN` query parameter (`crypto.timingSafeEqual`).
4. Forward all MCP tool calls bidirectionally between the Bridge and the subprocess.

The nova-telegram-bridge updates one environment variable: `MCP_GATEWAY_URL` points to `http://openhiveos-mcp-gateway:3006` instead of the opensquad-mcp-server SSE endpoint. The Bridge transport mechanism is unchanged (`SSEClientTransport`). No Bridge code changes are required beyond the URL.

squad-api (ARCH-012) is not modified. Its charter, role constraints (`openhiveos_reader`), and blast radius remain exactly as defined.

The gateway implementation is a custom TypeScript package (~150–200 lines using `@modelcontextprotocol/sdk`). An open-source dependency is rejected — the implementation surface is small enough that a dependency introduces more risk than it removes. A bespoke implementation gives full control over token redaction (SEC-D3), connection lifecycle, and subprocess health semantics.

The standalone MCP server container — used by operator AI clients (Claude Desktop, Cursor, VS Code Copilot) via `docker compose exec -i mcp` — is **retained**. Operator AI clients spawn their own MCP instance via stdio from their host machine. The gateway serves in-Compose consumers only. These are two distinct operational paths that do not interfere.

The integration is enabled via the `integration` Compose profile. Operators who do not need a Bridge integration do not run this profile. The core Squad Instance (`mcp`, `postgres`, `squad-api`) is profile-independent.

---

## Rationale

### Why Option A is blocked

**Blocked by Murphy (ARCH-001 identity model) and Locksmith (OWASP A09:2021). Two independent reasons.**

**Murphy's block:** The `AGENT_TOKEN` model resolves agent identity at process spawn time — one process, one agent slug, for all writes. If the Bridge spawns a second MCP subprocess in addition to the existing standalone `mcp` container, there are two independent processes, potentially holding the same or different `AGENT_TOKEN`. If the same token: a fingerprint race condition on the second cold start (`checkFingerprint()` may see stale data from the first process). If different tokens: two agent identities operating simultaneously, producing writes that are invisible from each other's perspective — an audit trail integrity failure.

**Locksmith's block (OWASP A09:2021):** Dual-process identity ambiguity produces zero reliable audit trail for memory and thought writes initiated by the Bridge. When two processes share or conflict on identity attribution, the audit trail cannot be trusted. This is a categorical rejection under OWASP A09 — security logging and monitoring failures.

Additionally: ARCH-006 defines Integration as consuming the Coordination Utilities tier. Option A bypasses the Utilities tier entirely and connects directly to primitives-layer tooling (the MCP server). This is a categorical ARCH-006 violation that sets a precedent for future integrations to bypass the designed abstraction boundary.

### Why Option B is blocked permanently

**Permanently blocked by Locksmith (OWASP A01:2021). One categorical violation that destroys the ARCH-015 security model.**

squad-api operates as `openhiveos_reader` (SELECT-only). ARCH-015 is explicit: this constraint exists to cap the blast radius if squad-api is compromised. Absorbing MCP subprocess management requires squad-api to:

1. Hold `AGENT_TOKEN`, `GEMINI_API_KEY`, and `DATABASE_URL` (writer permissions) — none of which are in its current env schema.
2. Elevate its database access from SELECT-only to the writer role.

This elevation destroys the Principle of Least Privilege established by ARCH-015. If squad-api is compromised in Option B, an attacker obtains the MCP writer role, not just the reader role. OWASP A01:2021 — Broken Access Control.

Additionally: the blast radius concentration is architecturally wrong. squad-api failure means both the Dashboard and the Bridge go offline simultaneously. These are independent failure domains and must remain independent.

### Why Option C is approved

Option C satisfies every constraint:

1. **ARCH-008 D1:** The gateway is not the MCP server. The MCP server binary runs as a stdio-only subprocess of the gateway. The gateway's SSE endpoint is an application-layer feature of the gateway container — not a feature of the MCP server. The stdio binding is not violated.
2. **ARCH-005/006:** Bridge → gateway is an HTTP connection. The gateway presents an HTTP integration surface. Integration taxonomy is satisfied.
3. **ARCH-012:** squad-api charter is unchanged. Dashboard ingestion only. `openhiveos_reader` role unchanged.
4. **ARCH-015:** Security model unchanged. No elevation of any database role.
5. **Contained blast radius:** If the gateway fails, the Bridge goes offline. squad-api and the Dashboard are unaffected. Failure domains remain independent.
6. **Operator AI client path unbroken:** Claude Desktop, Cursor, and VS Code Copilot continue to use `docker compose exec -i mcp node dist/index.js`. The standalone `mcp` container is not removed.

---

## Trade-offs Accepted

1. **New container in Compose.** Service count increases from 4 to 5 (6 with Bridge if co-deployed). Cooper manages health checks, restart policy, build pipeline, and log routing. This is accepted overhead — the alternative (bloating squad-api) carries greater architectural risk.

2. **One `AGENT_TOKEN` per gateway instance = one agent identity.** All MCP tool writes initiated through the gateway are attributed to the gateway's configured agent slug. This is correct for nova-telegram-bridge (Nova is the agent). For any future multi-agent bridge pattern (one Bridge, multiple agent identities), this constraint must be revisited in a new ADR before implementation. It cannot be resolved by parameter injection into the existing gateway design.

3. **Gateway is the MCP single point of failure for Bridge-mediated operations.** If the gateway crashes, the Bridge loses MCP access. Compose restart policy (`unless-stopped`) mitigates this. The Bridge must implement SSE reconnect logic to handle gateway restarts gracefully. Reconnect is a Bridge-side responsibility.

4. **MCP binary version coupling.** The gateway container must be rebuilt when the MCP server binary changes. The CI/CD build pipeline must enforce this via `ARG MCP_VERSION` in the gateway `Dockerfile`. Version drift between the gateway and standalone `mcp` container is a monitoring requirement — if they diverge, tool call behaviour may differ between operator AI clients and Bridge-mediated calls.

5. **Bridge deployment topology — Topology A (loopback binding).** *(E2 closed 2026-05-21.)* Gateway binds to `127.0.0.1:${MCP_GATEWAY_PORT:-3006}` only — never `0.0.0.0`. Any host-resident consumer (PM2, systemd, or a Compose service on the same host) connects via `http://127.0.0.1:<MCP_GATEWAY_PORT>?token=<MCP_GATEWAY_TOKEN>`. OpenHiveOS defines the interface and auth contract; it does not prescribe the consumer's deployment model. SEC-D4 (amended v1.1) enforces the explicit `127.0.0.1:` prefix. Multi-instance hosts MUST use distinct `MCP_GATEWAY_PORT` per Squad Instance. Host firewall verification is a Stage 6 onboarding requirement (Cooper runbook).

6. **openBridge is NOT included in the Squad Compose stack.** openBridge connects to mcp-gateway as an external PM2 process via SSE — same pattern as nova-telegram-bridge connecting from outside Compose. SEC-13 moratorium: no external Docker networks.

---

## Consequences

### New files

- `packages/mcp-gateway/` *(E1 closed: gateway lives in this repo)* — TypeScript gateway implementation:
  - `src/index.ts` — Express entry point, SSE endpoint, token validation middleware, subprocess spawn
  - `src/gateway.ts` — MCP client (`StdioClientTransport`), tool forwarding logic, reconnect and tool-list re-fetch on subprocess restart
  - `Dockerfile` — `FROM node:20-alpine`; `ARG MCP_VERSION` for binary version pinning
  - `package.json` — `@modelcontextprotocol/sdk` (pinned, same version as mcp-server), `express` (same version as squad-api)
- `docker-compose.yml` update — add `openhiveos-mcp-gateway` service under `integration` profile

### Environment variables (new)

All new variables belong to the gateway container's env scope:

| Variable | Owner | Description |
|---|---|---|
| `MCP_GATEWAY_TOKEN` | gateway | 32 bytes CSPRNG, 64 hex chars. Authenticates Bridge SSE connection. |
| `MCP_GATEWAY_PORT` | gateway | Internal SSE port. Default: `3006`. Do not host-expose. |
| `AGENT_TOKEN` | gateway | The agent identity for the MCP subprocess. One token = one agent slug. |
| `GEMINI_API_KEY` | gateway | Required if MCP subprocess uses Gemini for embedding. |
| `DATABASE_URL` | gateway | Writer connection for MCP subprocess. |
| `HEALTH_PORT` | gateway | Must be distinct from standalone mcp container. Default: `3007`. |

The Bridge adds:

| Variable | Owner | Description |
|---|---|---|
| `MCP_GATEWAY_URL` | Bridge | `http://127.0.0.1:<MCP_GATEWAY_PORT>` — loopback binding (E2 decided). Co-deployed Compose services may also use `http://openhiveos-mcp-gateway:3006` via Compose DNS. |
| `MCP_GATEWAY_TOKEN` | Bridge | Must match gateway's token exactly. |

### Modified files

- `docker-compose.yml` — new service block `openhiveos-mcp-gateway` under `integration` profile; inline comment block documents profile name and purpose (Clarence requirement).
- `.env.example` — add all gateway env vars with security comments.
- `gitleaks.toml` — add `MCP_GATEWAY_TOKEN` detection pattern (SEC-D5).

### Canonical operator onboarding sequence (updated to 6 stages)

| Stage | Action | ADR |
|---|---|---|
| 1 | `docker compose --profile init run --rm one-init` | ARCH-013 |
| 2 | `docker compose --profile init run --rm provision --write-env .env.tokens` | ARCH-014 |
| 3 | `docker compose up` — core stack (`mcp`, `postgres`, `squad-api`) | ARCH-012 |
| 4 | Generate `OPENHIVEOS_INGESTION_TOKEN`, configure `OPENHIVEOS_INGESTION_URL`, restart squad-api | ARCH-015 |
| 5 | Bridge connects: usage data appears in Dashboard | ARCH-015 T-01 gate |
| **6** | **Generate `MCP_GATEWAY_TOKEN`, set `MCP_GATEWAY_URL` in Bridge, run `docker compose --profile integration up -d openhiveos-mcp-gateway`** | **ARCH-016** |

Stage 6 success signal: `[mcp-gateway] SSE connection established` in Bridge logs.

---

## Security Review

**Locksmith — APPROVED (Option C), BLOCKED (Option A), BLOCKED PERMANENTLY (Option B).**

SEC-D1 through SEC-D11 are binding. All 11 must be confirmed closed in a PR comment by Locksmith before any ARCH-016 code merges to main.

| # | Condition | Risk if violated | OWASP |
|---|---|---|---|
| **SEC-D1** | Bridge → gateway SSE connection authenticated by `MCP_GATEWAY_TOKEN` passed as `?token=` query parameter. Gateway validates with `crypto.timingSafeEqual` before SSE upgrade. | Unauthenticated tool execution by any process that can reach the gateway | A01:2021 |
| **SEC-D2** | `MCP_GATEWAY_TOKEN`: min 32 bytes CSPRNG, raw hex (64 chars). Zod: `z.string().min(64)`. | Token guessable | A07:2021 |
| **SEC-D3** | **[CRITICAL]** `?token=` value must be redacted from all access and error logs before the SSE upgrade occurs. Most frameworks (Express, Fastify) log full URLs including query params by default. Redaction is not optional. | Token leaked to log files; persistent credential exposure on any log aggregation system | A02:2021 |
| **SEC-D4** *(amended v1.1)* | Gateway MUST bind to `127.0.0.1` only — never `0.0.0.0`. Compose service block MUST use `ports: ["127.0.0.1:${MCP_GATEWAY_PORT:-3006}:3006"]`. A bare `3006:3006` or `0.0.0.0:3006:3006` binding is a critical misconfiguration — it exposes the gateway to all host interfaces. `expose:` is NOT used (it would prevent PM2-resident consumers from reaching the gateway). Amended from v1.0: `expose:`-only was incorrect for Topology A (loopback). | MCP gateway reachable from all host interfaces; external auth bypass if misconfigured | A01:2021 |
| **SEC-D5** | `MCP_GATEWAY_TOKEN` registered in `gitleaks.toml`. | Token committed to source control | A02:2021 |
| **SEC-D6** | One `AGENT_TOKEN` per gateway instance = one agent identity. This constraint is documented in this ADR and enforced operationally. Multi-agent bridge patterns require a new ADR before implementation. | Audit trail corruption; mixed identity attribution in memory, thoughts, and dispositions | A09:2021 |
| **SEC-D7** | `HEALTH_PORT` for gateway's MCP subprocess must be distinct from the standalone mcp container. Default: `3007`. Injected at spawn time. | Subprocess boot fails due to port collision; gateway reports ready while subprocess is offline | A04:2021 |
| **SEC-D8** | Tool list re-fetch is atomic with subprocess restart. Gateway must not accept new SSE connections until `checkFingerprint()` has completed in the subprocess. | Partial tool list served to Bridge; tool calls fail silently; stale identity state | A09:2021 |
| **SEC-D9** | Rate limit SSE connection attempts: 10 connections/min per IP. Return 429 with `Retry-After` header on breach. | DoS via SSE connection flooding | A04:2021 |
| **SEC-D10** | Gateway container env is scoped: `AGENT_TOKEN`, `GEMINI_API_KEY`, `DATABASE_URL`, `MCP_GATEWAY_TOKEN`, `MCP_GATEWAY_PORT`, `HEALTH_PORT`. `OPENHIVEOS_INGESTION_TOKEN` (ARCH-015) is NOT included — it belongs to squad-api's env scope only. | Credential scope creep; token exposure across container boundaries | A02:2021 |
| **SEC-D11** | [FINAL MERGE GATE] Locksmith confirms SEC-D1 through SEC-D10 closed in PR comment before any ARCH-016 gateway code merges to main. | All of the above | — |

---

## Open Questions

| # | Question | Owner | Target |
|---|---|---|---|
| ~~E1~~ | ~~Gateway location: sibling package in this repo (`packages/mcp-gateway/`) or separate repo?~~ | — | **CLOSED 2026-05-21** — Richo: gateway is part of this project. `packages/mcp-gateway/`. |
| ~~E2~~ | ~~Bridge deployment topology: PM2 or Compose service?~~ | — | **CLOSED 2026-05-21** — Silas design session: Topology A — loopback binding. `ports: ["127.0.0.1:${MCP_GATEWAY_PORT:-3006}:3006"]`. Consumers connect via `http://127.0.0.1:<port>?token=<token>`. OpenHiveOS does not prescribe consumer deployment model. |
| ~~E3~~ | ~~openBridge Compose profile: use same `integration` profile as mcp-gateway, or a separate `bridge` profile?~~ | — | **CLOSED 2026-05-21** — Richo ruling: openBridge is fundamental to inter-OpenHive interactions. Dedicated `openbridge` Compose profile. NOT `integration`. |

---

## Rejected Alternatives

### Option A — Bridge Manages StdioClientTransport Directly

**Blocked by Murphy (OWASP A09:2021 — dual-process `AGENT_TOKEN` identity race) and Locksmith (OWASP A09:2021 — audit trail integrity). Additionally violates ARCH-006 (Integration bypasses Coordination Utilities tier).**

The Bridge spawning its own MCP subprocess creates a second process with an unresolved identity relationship to the first. Whether the tokens are shared or distinct, the audit trail is corrupted. This block is not a configuration concern — it is a design constraint of the `AGENT_TOKEN` model (ARCH-001). No configuration change removes it.

### Option B — squad-api Absorbs MCP Subprocess Lifecycle

**Permanently blocked by Locksmith (OWASP A01:2021 — `openhiveos_reader` elevation destroys PoLP, invalidates ARCH-015 threat model). Additionally violates ARCH-012 (scope expansion) and concentrates blast radius across Bridge and Dashboard.**

The `openhiveos_reader` constraint in ARCH-015 is not a preference — it is a security control. Overriding it to absorb a subprocess invalidates the threat model documented in that ADR. This block is permanent. Future designs that require squad-api to hold writer credentials must begin with a new ADR that replaces ARCH-015, not amends this one.

---

## Changelog

| Version | Date | Author | Change |
|---|---|---|---|
| v1.0 | 2026-05-21 | Clarence / Elizabeth / Silas / Locksmith | Initial decision — Option C selected; Options A and B blocked |
| v1.1 | 2026-05-21 | Silas / Elizabeth | E1 closed (packages/mcp-gateway/ in this repo — Richo ruling); E2 closed (Topology A loopback binding — Silas design session); SEC-D4 amended to reflect loopback `ports:` binding; Trade-off 5 updated; Murphy unblocked on F8/F9 |
| v1.2 | 2026-05-21 | Elizabeth | E3 closed (openBridge uses dedicated `openbridge` Compose profile — Richo ruling, Sprint 5 planning Day 0); all open questions resolved |
