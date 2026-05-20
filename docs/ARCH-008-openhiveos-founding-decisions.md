---
title: "ARCH-008 — OpenHiveOS Founding Decisions"
date: 2026-05-20
status: Accepted
decision_owner: Silas
approved_by: Elizabeth
filed_by: Silas
adr: ARCH-008
related:
  - "[[ARCH-007-openhiveos-codebase-strategy]]"
  - "[[ARCH-001-server-resolved-agent-identity]]"
  - "[[ARCH-005-agent-os-canonical-architecture]]"
tags:
  - type/adr
  - project/openhiveos
  - domain/architecture
  - domain/backend
  - domain/security
review_date: 2026-08-20
---

# ARCH-008 — OpenHiveOS Founding Decisions

> **Status:** Accepted — binding from date of filing
> **Decision Owner:** Silas
> **Sprint:** Inception (Sprint 1)

---

## 1. Context

ARCH-007 established the extraction strategy for OpenHiveOS. During the inception sprint (#1283–#1291), six foundational implementation decisions were made that are not recorded in any prior ADR. Each decision constrains the design space for all future contributors and all future primitives.

This ADR records those six decisions. They are binding. Future work that conflicts with any of them requires a new ADR and explicit supersession.

---

## 2. Decision 1 — MCP Transport: StdioServerTransport Only (Sprint 1)

### Decision

`StdioServerTransport` is the sole MCP transport mechanism for OpenHiveOS in Sprint 1. No HTTP/SSE transport is implemented.

```ts
// src/index.ts — enforced at boot
const transport = new StdioServerTransport()
await server.connect(transport)
```

### Rationale

OpenHiveOS is a **local MCP server**. It is consumed by AI agents (Claude, Cursor, Copilot) running on the same machine via the MCP stdio protocol. There is no public API surface, no inbound HTTP to route, and no client session state to manage. Stdio transport eliminates the attack surface entirely for Sprint 1.

SSE transport introduces a new trust boundary: any HTTP client on the network can reach the server. That boundary requires bearer token auth (ARCH-001), rate limiting, CORS policy, and TLS. Those are Sprint 4+ requirements — gated by the ARCH-004 productization milestone.

### What This Means for Operators

- OpenHiveOS is configured as an MCP server in the client config (e.g., `claude_desktop_config.json`, `.mcp.json`) — not by pointing at a URL.
- The process communicates exclusively on stdin/stdout. Docker run requires `stdin_open: true`.
- The `HEALTH_PORT` HTTP server (see Decision 4) is the only open TCP port — internal health probes only, not MCP protocol.

### Deferred

- **SSE/HTTP transport** — Sprint 4+. Requires ARCH-001 bearer token, rate limiting, TLS, and a formal threat model review by Locksmith before implementation.

### Alternatives Ruled Out

| Option | Reason Rejected |
|---|---|
| HTTP/SSE transport from Sprint 1 | Introduces auth, CORS, and TLS scope not justified by local use case |
| Dual transport (stdio + SSE simultaneously) | Doubled attack surface, doubled transport maintenance, no benefit at current scale |

---

## 3. Decision 2 — ESLint Module Boundary Enforcement: `no-restricted-imports` Replaces `eslint-plugin-boundaries`

### Decision

The `src/primitives/**` → `src/utilities/**` import barrier is enforced via ESLint's built-in `no-restricted-imports` rule, not the `eslint-plugin-boundaries` package.

### Rationale

**Root cause:** `eslint-plugin-boundaries` has a transitive dependency on `handlebars` carrying a critical CVE with no upstream fix at the time of scaffold (#1284). The package is unmaintained at the required version.

**Enforcement quality is preserved.** The `no-restricted-imports` rule with a glob pattern (`src/primitives/**`) achieves the same boundary assertion: any import from within the primitives layer that resolves into the utilities layer fails ESLint with `--max-warnings 0` enforced in CI. The boundary is caught at lint time, not at runtime.

```js
// eslint.config.js — effective boundary rule
{
  files: ['src/primitives/**'],
  rules: {
    'no-restricted-imports': ['error', { patterns: ['**/utilities/**'] }],
  },
}
```

### Accepted Risk

The `no-restricted-imports` approach is path-pattern matching, not graph-aware import resolution. A developer who aliased a utilities module as a primitives-layer re-export could circumvent it. This risk is mitigated by code review policy: all PRs touching `src/primitives/` require architecture-layer review before merge.

### Revisit Condition

If `eslint-plugin-boundaries` ships a release that clears the handlebars CVE, evaluate migration back. Graph-aware resolution is preferable. Migration requires zero lint-rule behavior change — no PR should observe a difference except in error message formatting.

---

## 4. Decision 3 — Embedding Model: Gemini `gemini-embedding-001` / 768 Dimensions

### Decision

The sole embedding model for OpenHiveOS is Google's `gemini-embedding-001` at 768 dimensions. No local models. No alternative provider.

### Rationale

This decision was inherited from the opensquad-mcp-server extraction and made binding for OpenHiveOS with the ARCH-007 Amendment (MemPalace exclusion, Python track closure). The original justification:

1. **768d is vector-efficient.** HNSW index parameters (`m=16`, `ef_construction=128`) are calibrated for 768d vectors. A model change requires a full re-migration: drop and recreate the HNSW index, re-embed all stored memories and SOPs. This is a breaking schema operation.
2. **GEMINI_API_KEY is already a required env var.** Every deployment already carries the credential. No additional dependency for embedding.
3. **No local ML pipeline.** The Python track (PROD-2) that would have justified a local embedding model was closed permanently in the ARCH-007 Amendment. With MemPalace excluded and Python closed, no local-model scenario exists within OpenHiveOS scope.

### Schema Constraint

```sql
-- migrations/001_init.sql
embedding vector(768)  -- HNSW index calibrated for this dimension
```

Any change to embedding dimensions is a **breaking schema migration**. It requires:
1. A new ADR superseding this one
2. A migration that drops and recreates the HNSW index
3. A re-embedding job for all rows in `memories`, `thoughts`, and `sops`

### Alternatives Ruled Out

| Option | Reason Rejected |
|---|---|
| OpenAI `text-embedding-3-small` (1536d) | Double the vector dimensions, double the index size, adds a second required API credential |
| Local model (e.g., `nomic-embed-text`) | Requires Python runtime or ONNX infrastructure — PROD-2 was closed permanently |
| Provider-agnostic abstraction layer | Premature abstraction — one model, one provider, no concrete second use case |

---

## 5. Decision 4 — Boot Sequence: Five-Step Ordered Invariant

### Decision

The OpenHiveOS boot sequence is a **fixed five-step order**. Steps must execute in order. No step may be skipped. The MCP server does not accept connections until all prior steps complete without error.

```
1. Validate env      →  src/config.ts     (Zod parse — throws on missing vars)
2. Connect DB        →  src/db/client.ts  (pg Pool — throws on connection failure)
3. Check fingerprint →  src/db/fingerprint.ts  (schema guard — throws on drift)
4. Start health      →  src/health.ts     (HTTP on HEALTH_PORT — degraded on DB error)
5. Connect MCP       →  src/index.ts      (StdioServerTransport — begins accepting calls)
```

```ts
// src/index.ts — enforced ordering
import './config.js'        // Step 1: validate env immediately on import
await connectDb()           // Step 2
await checkFingerprint()    // Step 3
startHealthServer()         // Step 4
await server.connect(transport)  // Step 5
```

### Rationale

**The MCP server must never accept tool calls against an un-validated environment.** If env validation is deferred past Step 1, a missing `GEMINI_API_KEY` surfaces as a runtime error inside a tool handler — surfaced to the AI agent as an unstructured error message with no actionable context. Failing at Step 1 with a clear message ("Missing required env: GEMINI_API_KEY") is the correct UX for an operator.

**The fingerprint check (Step 3) is the schema drift guard.** If the database schema diverges from what the primitives expect — e.g., a manual ALTER ran against the wrong environment — the fingerprint check throws before any primitive can corrupt data. This check costs ~5ms at boot and prevents entire categories of silent data integrity failures.

**Health server starts before MCP (Step 4 before Step 5)** so that Docker healthchecks can report `degraded` if DB connectivity was lost between Steps 2 and 5. A Docker container stuck in Step 5 (MCP connect hang) will still answer `/` on `HEALTH_PORT` with its current state.

### Invariant

This sequence is an architectural invariant. Any PR that reorders these steps, or that defers Step 1 past the first import, fails architecture review without exception. The correct mental model: **OpenHiveOS fails loudly at boot or not at all at runtime.**

---

## 6. Decision 5 — Squad Manifest: Synchronous File Load, Not DB-Backed

### Decision

Agent identity for OpenHiveOS is defined in `squad.manifest.json`, loaded **synchronously at module import time**, not from the database.

```ts
// src/squad/manifest.ts
import manifestRaw from '../../squad.manifest.json' assert { type: 'json' }
export const manifest = ManifestSchema.parse(manifestRaw)
export const isValidAgentSlug = (slug: string): boolean =>
  manifest.agents.some((a) => a.slug === slug)
export const resolveAgent = (slug: string): Agent => {
  const agent = manifest.agents.find((a) => a.slug === slug)
  if (!agent) throw new Error(`Unknown agent slug: ${slug}`)
  return agent
}
```

### Rationale

**Agent identity is configuration, not runtime state.** Which agents exist in this Squad does not change between deployments. It changes between releases. Putting it in the database would mean:
- A new agent requires a migration, not a config file edit
- A boot with an empty DB (first run) has no agents — bootstrap paradox
- Every agent-slug lookup in a primitive handler requires a DB round-trip

The file-based manifest is the correct architecture for configuration data with a slow change rate. Operators override it by mounting a custom `squad.manifest.json` via Docker volume — no image rebuild required.

### Schema (from Zod)

```ts
AgentSchema = z.object({
  slug: z.string(),
  name: z.string(),
  role: z.string(),
  model: z.string(),
})
ManifestSchema = z.object({
  squad: z.string(),
  agents: z.array(AgentSchema),
})
```

### Invariant

- The `agents` table in PostgreSQL stores **disposition and memory data** for agents — it does not define which agents exist.
- `squad.manifest.json` is the **single source of truth** for valid agent slugs.
- All Zod schemas in primitive handlers that accept `agent_slug` validate against `isValidAgentSlug()` — not against a DB query.

### Revisit Condition

If OpenHiveOS ever supports **multi-tenant deployments** where different customers have different agent configurations, the manifest will need to become tenant-scoped and DB-backed. That is a Sprint 4+ concern at the earliest, gated by the SSE transport decision.

---

## 7. Decision 6 — Config Schema: Zod Fail-Fast Validation at Process Start

### Decision

All environment variable access in OpenHiveOS is **mediated through `src/config.ts`**. No module reads `process.env` directly. If any required variable is missing, the process exits with a clear error before any I/O occurs.

```ts
// src/config.ts
const ConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
  GEMINI_API_KEY: z.string().min(1),
  HEALTH_PORT: z.coerce.number().default(3000),
})
const result = ConfigSchema.safeParse(process.env)
if (!result.success) throw new Error(`Config error: ${result.error.message}`)
export const config: Config = result.data
```

### Rationale

Scattered `process.env.X` reads create a failure mode where a missing variable surfaces at call time, not at boot. The result is a tool call that fails inside a primitive handler and surfaces to the AI agent as an opaque error. The correct failure surface is **boot**, not **runtime**.

Zod coercion handles type mismatches at the boundary (`HEALTH_PORT` is a string in env, a number in config). This prevents the second failure mode: `parseInt` or coercion scattered through the codebase.

### Policy

- No module other than `src/config.ts` may read `process.env`.
- New required env vars require a Zod schema update in `src/config.ts`.
- New optional env vars must have a Zod default — they may not be conditionally undefined in application code.
- The `.env.example` file must stay in sync with `ConfigSchema` — verified by code review, not CI (not all CI environments expose env vars safely).

---

## 8. Enforcement and Compliance

All six decisions are active as of 2026-05-20 (inception sprint close).

| Decision | Enforced By |
|---|---|
| StdioServerTransport only | `src/index.ts` — no HTTP server registered |
| `no-restricted-imports` boundary | `eslint.config.js` + `--max-warnings 0` in CI |
| Gemini 768d only | `migrations/001_init.sql` vector dimension + `src/embeddings/gemini.ts` |
| 5-step boot order | `src/index.ts` import order — architecture review on all PRs touching this file |
| Squad manifest file-based | `src/squad/manifest.ts` synchronous import — no DB lookup in `isValidAgentSlug` |
| Zod config at import time | `import './config.js'` first line in `src/index.ts` + no-direct-process-env code review policy |

---

## 9. Revisit Conditions

This ADR is reviewed at **2026-08-20** or when any of the following triggers occur:

| Trigger | Decisions Affected |
|---|---|
| SSE transport Sprint 4+ milestone reached | Decision 1 |
| `eslint-plugin-boundaries` ships handlebars-CVE-free release | Decision 2 |
| Embedding dimension change requested | Decision 3 (requires superseding ADR + re-migration plan) |
| Multi-tenant deployment model proposed | Decision 5 |
| New required env var added | Decision 6 (`.env.example` sync obligation) |
| Auth upgrade path reviewed (post-v1.0) | Decision 7 |

---

## 10. Addendum — Sprint 2 Day 0 (2026-05-20)

> **Filed by:** Silas · **Date:** 2026-05-20 · **Confirmed by:** Richo (Founder)

This addendum records one new binding decision (Decision 7) made during Sprint 2 planning, and provides the OpenHiveOS Data Flow Diagram required as input for Locksmith's SEC-18 STRIDE threat model (S2-03).

---

### 10.1 Decision 7 — Process-Level Agent Identity via `AGENT_TOKEN` (v0.1 Auth)

#### Decision

OpenHiveOS v0.1 authenticates calling agents using a **process-level environment variable** (`AGENT_TOKEN`). This is not request-level middleware. There is no HTTP layer, no `Authorization` header, and no per-request token lookup. Identity is resolved once at process startup and closed over in all MCP tool handler registrations.

This decision is binding for v0.1. It replaces the ARCH-001 bearer-token-in-HTTP-header pattern, which does not apply to `StdioServerTransport`.

```
AGENT_TOKEN env var
  → validated by Zod ConfigSchema at boot (required string, min 1)
  → compared via crypto.timingSafeEqual against stored token in agents table
  → agentSlug resolved from agents table, cross-referenced with squad.manifest.json
  → agentSlug closed over in all tool handler registrations
  → process halts if AGENT_TOKEN missing, invalid, or unresolvable
```

#### Boot Sequence — Modified (6 Steps, supersedes Decision 4's 5-step invariant)

Decision 4 established a 5-step boot sequence. This addendum adds Step 4 (agent identity resolution), making it a 6-step invariant. Steps must execute in order. No step may be skipped.

```
Step 1  Validate env          →  src/config.ts
                                  Includes AGENT_TOKEN: z.string().min(1)
                                  Throws on missing or empty token

Step 2  Connect DB            →  src/db/client.js
                                  pg Pool — throws on connection failure

Step 3  Check fingerprint     →  src/db/fingerprint.ts
                                  Schema guard — throws on drift

Step 4  Resolve identity      →  src/auth/identity.ts          ← NEW
                                  timingSafeEqual(AGENT_TOKEN, stored token)
                                  agentSlug resolved from agents table + manifest
                                  Process halts on failure — no fallback, no degraded mode

Step 5  Start health server   →  src/health.ts
                                  HTTP on HEALTH_PORT
                                  {agents} field: scope under audit — see S2-01 / S2-08

Step 6  Connect MCP           →  src/index.ts
                                  StdioServerTransport
                                  All primitive handlers registered with agentSlug closure
```

The invariant from Decision 4 is updated: **OpenHiveOS fails loudly at boot or not at all at runtime.** Step 4 enforces this for identity — if the token cannot be resolved to a valid agent, the process exits before accepting any MCP connection.

#### Token Format

- **Generated by:** `scripts/provision-agent-token.ts` (created in S2-01)
- **Source:** `crypto.randomBytes(32)` — 256 bits, CSPRNG
- **Encoding:** hex string (64 characters)
- **Storage:** `agents` table, `token_hash` column — bcrypt hash of the raw token, never the token itself
- **Env var:** `AGENT_TOKEN=<64-hex-chars>` in `.env` — never committed to source control

> **Token format detail is a Murphy S2-01 implementation decision.** The constraints above are architectural minimums. The provisioning script may use an extended format (e.g. `<prefix>.<secret>`) provided it preserves 256-bit entropy in the secret component and the comparison remains `timingSafeEqual`.

#### Token Comparison — Security Requirement

```ts
// src/auth/identity.ts — required implementation pattern
import { timingSafeEqual } from 'node:crypto'

// MUST: use timingSafeEqual — no === comparison anywhere in the auth path
// MUST: compare Buffer-to-Buffer (not string-to-string)
const candidateBuf = Buffer.from(candidateToken, 'hex')
const storedBuf    = Buffer.from(storedTokenHash, 'hex')
const isValid      = candidateBuf.byteLength === storedBuf.byteLength
                     && timingSafeEqual(candidateBuf, storedBuf)
```

This is the only permitted comparison mechanism. Locksmith's SEC-16 audit (S2-02) will verify this at PR review.

#### Revocation Posture

- Token revocation in v0.1 requires **process restart**.
- There is no per-request revocation, no `expires_at` enforcement, and no rotation API.
- This is an accepted limitation for v0.1 (single-process, single-agent, local deployment).
- Named tech debt: `TD-001 — No runtime token revocation in v0.1`. Resolution path: `expires_at` column in `agents` table, checked at Step 4 boot or per-call if SSE transport is introduced in Sprint 4+.

#### Health Endpoint Information Disclosure (S2-08)

`GET /health` currently returns `{ agents: string[] }` — a list of all agent slugs registered in the manifest. This is served unauthenticated on `HEALTH_PORT`. In a Docker Compose deployment where `HEALTH_PORT` is not externally exposed (Docker internal network only), this is low risk. If `HEALTH_PORT` is ever exposed externally, this becomes a reconnaissance vector.

**Scope of fix in S2-01:** Murphy audits whether `{agents}` should be stripped from the health response, gated behind the `AGENT_TOKEN`, or retained. Decision is Murphy's with Locksmith review. This addendum does not prescribe the fix — it records the known exposure. Locksmith will model it in STRIDE flow 4 (S2-03).

#### Phase Note — Doorkeeper / OAuth 2.0

A concurrent ARCH-008 review in `io_auth` (2026-05-20, Locksmith) approved OAuth 2.0 / Doorkeeper `client_credentials` as the MCP agent auth upgrade path for that project. **That decision does not apply to OpenHiveOS.**

OpenHiveOS uses `StdioServerTransport` (Decision 1). There is no HTTP layer for OAuth flows to operate on. The `AGENT_TOKEN` env-var pattern is the correct auth mechanism for process-level stdio identity. Doorkeeper is a post-v1.0 consideration only if OpenHiveOS introduces SSE transport (Sprint 4+), and only if that transport requires OAuth-compatible auth. No decision on that is made here.

**Confirmed by Richo (Founder), 2026-05-20:** env-token v0.1 is permanent for this architecture. Doorkeeper has no relevance to this project.

#### Alternatives Ruled Out

| Option | Reason Rejected |
|---|---|
| ARCH-001 `Authorization: Bearer` header | No HTTP layer in StdioServerTransport — no request object exists |
| Caller-provided `agent_name` in tool input | Trivially spoofable — any caller can claim any slug. Server-resolved identity is the invariant (ARCH-001 principle, adapted for stdio) |
| No auth (open process) | An unauthenticated MCP process with write access to memory and disposition data is an unacceptable security posture for any deployment, including local |
| OAuth 2.0 / Doorkeeper `client_credentials` | Requires HTTP token endpoint — incompatible with stdio transport in v0.1 |

---

### 10.2 OpenHiveOS Data Flow Diagram — v0.1 (Input for S2-03 STRIDE)

> This DFD is the Day 0 input for Locksmith's SEC-18 STRIDE threat model (task #1303). It defines 4 data flows, their trust boundaries, data sensitivity, and current auth state. Locksmith expands this into a full STRIDE analysis.

#### System Context

```
┌─────────────────────────────────────────────────────────────────┐
│  OPERATOR WORKSTATION                                           │
│                                                                 │
│  ┌───────────────────┐    stdio     ┌──────────────────────┐  │
│  │  MCP Client        │◄────────────►│  OpenHiveOS Process  │  │
│  │  (Claude / Cursor  │             │  (Node.js, PID N)    │  │
│  │   / Copilot)       │             │                      │  │
│  └───────────────────┘             │  AGENT_TOKEN env var │  │
│                                     │  agentSlug (closed)  │  │
│                                     └──────┬───────┬───────┘  │
│                                            │       │           │
│              ┌─────────────────────────────┘       │           │
│              │ Docker internal network             │ HTTPS     │
│              ▼                                     ▼           │
│  ┌─────────────────────┐                ┌─────────────────┐   │
│  │  PostgreSQL 17      │                │  Gemini API     │   │
│  │  + pgvector         │                │  (Google Cloud) │   │
│  │  Docker container   │                └─────────────────┘   │
│  └─────────────────────┘                                       │
│              ▲                                                  │
│              │  HEALTH_PORT (internal only)                     │
│  ┌─────────────────────┐                                       │
│  │  Docker health probe│                                       │
│  │  GET /health        │                                       │
│  └─────────────────────┘                                       │
└─────────────────────────────────────────────────────────────────┘
```

#### Flow 1 — MCP Client → stdio → OpenHiveOS Process

| Attribute | Value |
|---|---|
| **Direction** | Bidirectional — client writes tool calls, process writes tool results |
| **Transport** | stdin / stdout (OS pipe) |
| **Trust boundary** | Process boundary — same OS user, same machine |
| **Data flowing** | Tool call JSON (tool name, input args, agent context); tool result JSON |
| **Data sensitivity** | Medium — tool inputs may contain agent instructions, memory search queries, thought content |
| **Auth mechanism (v0.1)** | `AGENT_TOKEN` resolved at boot; agentSlug closed over in handlers — no per-call auth |
| **Known exposure** | Any process running as the same OS user can write to stdin. Threat: local privilege abuse |
| **STRIDE scope** | Spoofing (caller identity), Tampering (tool input manipulation), Information Disclosure (tool result interception) |

#### Flow 2 — OpenHiveOS Process → PostgreSQL

| Attribute | Value |
|---|---|
| **Direction** | Bidirectional — process issues queries, PostgreSQL returns rows |
| **Transport** | TCP socket (Docker internal network) — `pg` pool |
| **Trust boundary** | Docker network boundary — PostgreSQL not accessible from host by default |
| **Data flowing** | SQL queries; row results (memories, thoughts, SOPs, dispositions, embeddings) |
| **Data sensitivity** | High — memories and thoughts are agent episodic data; dispositions are behavioral configuration |
| **Auth mechanism** | `DATABASE_URL` includes credentials — validated at boot by Zod, pg pool manages connection lifecycle |
| **Known exposure** | `DATABASE_URL` in env contains credentials — must never be logged. `pool.query()` errors must not expose the connection string |
| **STRIDE scope** | Tampering (SQL injection in query params), Information Disclosure (credential logging), Denial of Service (connection exhaustion) |

#### Flow 3 — OpenHiveOS Process → Gemini API

| Attribute | Value |
|---|---|
| **Direction** | Unidirectional — process sends text, Gemini returns embedding vector |
| **Transport** | HTTPS (TLS 1.2+) — outbound to `generativelanguage.googleapis.com` |
| **Trust boundary** | Internet — data leaves operator infrastructure |
| **Data flowing** | Text content submitted for embedding (memory content, SOP text, thought text, search queries) |
| **Data sensitivity** | High — thought content and memory entries may contain proprietary agent context |
| **Auth mechanism** | `GEMINI_API_KEY` in Authorization header — validated at boot by Zod |
| **Known exposure** | All embedded text is transmitted to Google Cloud. No data residency guarantee within OpenHiveOS v0.1. `GEMINI_API_KEY` must never appear in logs or error messages |
| **STRIDE scope** | Information Disclosure (text content leaving operator boundary), Repudiation (no audit log of what was sent), Denial of Service (API rate limits / quota exhaustion) |

#### Flow 4 — OpenHiveOS Process → Docker Health Probe

| Attribute | Value |
|---|---|
| **Direction** | Inbound — Docker daemon polls `GET /` on `HEALTH_PORT` |
| **Transport** | HTTP (no TLS) — Docker internal network only |
| **Trust boundary** | Host network — `HEALTH_PORT` is not exposed externally in the reference `docker-compose.yml` |
| **Data flowing** | Health response: `{ status, version, squad, agents: string[], db }` |
| **Data sensitivity** | Low-medium — `agents` field lists active agent slugs (reconnaissance value if exposed externally) |
| **Auth mechanism** | None — unauthenticated by design for Docker health probe compatibility |
| **Known exposure** | `{agents}` field reveals squad composition without auth. If `HEALTH_PORT` is ever published externally (e.g. `ports:` added to Compose), this becomes unauthenticated Information Disclosure (Locksmith flag, 2026-05-20). S2-01 (Murphy) must audit and resolve before v0.1 |
| **STRIDE scope** | Information Disclosure (`{agents}` field without auth), Spoofing (no client auth on health requests — spoofed probes can infer liveness) |

#### Trust Boundary Summary

| Boundary | Between | Crossing Auth | v0.1 Posture |
|---|---|---|---|
| Process boundary | MCP client ↔ OpenHiveOS | AGENT_TOKEN (resolved at boot) | Accepted — local only |
| Docker network | OpenHiveOS ↔ PostgreSQL | DATABASE_URL credential | Accepted — not externally exposed |
| Internet | OpenHiveOS ↔ Gemini API | GEMINI_API_KEY | Accepted — TLS enforced |
| Host network | Docker daemon ↔ HEALTH_PORT | None | Accepted — internal only. Breaks if HEALTH_PORT published |

---

### 10.3 Enforcement (Decision 7)

| Requirement | Enforced By |
|---|---|
| `AGENT_TOKEN` in ConfigSchema | `src/config.ts` Zod schema — throws at boot if missing |
| `timingSafeEqual` only | Locksmith SEC-16 audit (S2-02) — code review gate |
| Server-resolved identity | Architecture review on all `src/index.ts` PRs |
| No unauthenticated fallback | Architecture review + Locksmith S2-02 audit |
| Token not logged | Locksmith S2-02 audit — grep for `AGENT_TOKEN` in log statements |
| Boot halts on resolution failure | `src/auth/identity.ts` — non-zero exit before MCP connect |
