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
