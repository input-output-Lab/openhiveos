# ARCH-001 — Server-Resolved Agent Identity via Bearer Token

**Decision date:** 2026-04-24  
**Status:** Active  
**Authors:** Murphy (design), Silas (schema review), Locksmith (security review)  
**Last Updated:** 2026-05-21 (C13 — script paths updated to src/scripts/; Ethos Seal prerequisite added)

---

## Context

Prior to April 2026, all agents shared a single `MCP_AUTH_TOKEN`. The auth middleware verified the token matched the env var, then passed the request through. Agent identity — who stored a memory, who authored a thought — was set entirely by the caller via the `agent_name` field in the tool payload.

This created a silent misattribution failure: any agent using any tool could claim to be any other agent. There was no mechanism the server could use to verify the claim. When Locksmith was spawned in April 2026, her thoughts were being stored under Clarence's slug because both agents were using the same token and Locksmith's instructions still included `agent_name: 'locksmith'` in a payload that the server never verified.

The system needed a way to resolve agent identity from something the server controls — not something the caller supplies.

---

## Decision

**Agent identity is resolved server-side from the bearer token. The caller's supplied `agent_name` is ignored on all write operations.**

The server:
1. Parses the `Authorization: Bearer <token>` header
2. Looks up the agent row in the `agents` table by `token_salt`
3. Verifies the token hash using constant-time comparison (`timingSafeEqual`)
4. Sets `req.agentSlug` on the request object
5. Every tool handler reads identity from `req.agentSlug` — not from any field in the request payload

The caller cannot lie about who they are. Identity comes from the key they hold.

---

## Implementation

### Token format

```
<32-hex-salt>.<64-hex-secret>
```

- Salt: 16 random bytes (`crypto.randomBytes(16)`), hex-encoded
- Separator: period (`.`)
- Secret: 32 random bytes (`crypto.randomBytes(32)`), hex-encoded
- Server regex: `/^Bearer ([0-9a-f]{32})\.([0-9a-f]{64})$/`

### Storage

Tokens are never stored in plaintext. The server stores:

```
token_hash = SHA-256(salt + secret)
token_salt = salt
```

The hash is computed as `createHash('sha256').update(salt + secret).digest('hex')`.

Verification uses `timingSafeEqual` to prevent timing-based oracle attacks.

### Auth middleware (abridged from `src/server.ts`)

```typescript
// 1. Parse the Authorization header
const parsed = parseBearer(authHeader);  // regex match → { salt, secret }

// 2. Primary token lookup — indexed on token_salt
const primary = await pool.query(
  `SELECT slug, token_hash, previous_token_hash, previous_token_salt, previous_token_expires_at
   FROM agents WHERE token_salt = $1 AND active = TRUE`,
  [salt],
);

// 3. Constant-time hash verification
if (!verifyHash(salt, secret, agent.token_hash)) {
  return res.status(401).json({ error: 'Unauthorized' });
}

// 4. Set identity on the request — all tool handlers read from here
req.agentSlug = agent.slug;
```

### Rotation grace path

When a token is rotated, the old token is accepted for 24 hours via a second DB lookup:

```typescript
const prev = await pool.query(
  `SELECT ... FROM agents
   WHERE previous_token_salt = $1 AND active = TRUE AND previous_token_expires_at > NOW()`,
  [salt],
);
```

This allows zero-downtime rotation — PM2 can be restarted with the new token while agents still holding the old token continue operating through the grace window.

### Tool layer behaviour

Tools that write to the database (`store_memory`, `store_thought`, `create_task`, etc.) receive `agentSlug` via closure at registration time, sourced from `req.agentSlug`. Any `agent_name` field in the Zod-validated input schema is either:
- **Absent** on write tools (the field does not exist in the schema)
- **Retained as a read filter** on query tools (`search_memory`, `query_thoughts`) where the caller legitimately wants to filter by agent

### `last_used_at` tracking

Every successful auth updates `agents.last_used_at` via a fire-and-forget query:

```typescript
pool.query('UPDATE agents SET last_used_at = NOW() WHERE slug = $1', [agent.slug]).catch(() => {});
```

This is non-blocking and failure is silently discarded — it is an audit convenience, not a reliability requirement.

---

## Schema

The `agents` table (migration `009_agents_table.sql`) is the backing store:

| Column | Type | Purpose |
|---|---|---|
| `slug` | `TEXT PRIMARY KEY` | Unique agent identifier. Must match metadata tags. |
| `display_name` | `TEXT NOT NULL` | Human-readable name |
| `token_hash` | `TEXT NOT NULL` | SHA-256 hash of `salt + secret` |
| `token_salt` | `TEXT NOT NULL UNIQUE` | Salt used in hash; also the DB lookup key |
| `previous_token_hash` | `TEXT` | Hash of the previous token during rotation |
| `previous_token_salt` | `TEXT` | Salt of the previous token during rotation |
| `previous_token_expires_at` | `TIMESTAMPTZ` | Expiry for the 24-hour grace window |
| `expires_at` | `TIMESTAMPTZ` | **Not enforced by server** — see Known Limitations |
| `active` | `BOOLEAN NOT NULL DEFAULT TRUE` | Hard kill-switch. `FALSE` = all tokens rejected immediately. |
| `last_used_at` | `TIMESTAMPTZ` | Updated on every successful auth |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | Standard audit columns |

---

## Consequences

### Positive
- Agent identity is cryptographically verified on every request. No agent can impersonate another.
- The `agents` table gives the team an audit trail: who was provisioned, when they last authenticated.
- `active = FALSE` provides an immediate kill-switch with no deploy required.
- Rotation is zero-downtime: old tokens remain valid for 24 hours during the handover window.

### Negative / constraints
- Every new agent must be provisioned via `src/scripts/provision-agent-token.ts` before they can write to the MCP server. Skipping this step causes a 401 on all write calls.
- The **Ethos Seal must be initialised** (`src/scripts/one-init.ts`) before provisioning runs. The provision scripts gate on the seal's presence (ARCH-013).
- If an agent's token is lost before being saved to the vault, the token must be rotated — there is no retrieval mechanism.
- Each VS Code context must export the correct `MCP_AUTH_TOKEN_<SLUG>` env var. A wrong or missing var produces a silent 401 in VS Code (no visible error in the Copilot Chat UI).

### Known limitations
- `expires_at` column exists in the schema but the auth middleware does not check it. Tokens do not expire automatically. Rotation is the only mechanism to invalidate a primary token (short of `active = FALSE`). Tracked as tech debt.

---

## Alternatives Considered

| Alternative | Rejected because |
|---|---|
| Keep shared `MCP_AUTH_TOKEN`, add `agent_name` validation | Caller-supplied identity is unverifiable — any agent can claim to be any other |
| JWT with per-agent claims | Requires key management infrastructure we don't have; overkill for an internal closed system |
| mTLS per-agent certificates | Infrastructure complexity (cert rotation, CA) disproportionate to threat model |
| API key stored in `.env` per agent | Equivalent to current approach but without the `agents` table audit trail and kill-switch |

---

## Migration Path

This decision required a four-phase migration from the shared-token model:

| Phase | Description | Status |
|---|---|---|
| Phase 1 | Deploy migrations 009 (agents table) + 010 (agent_slug nullable FK on thoughts) | Pending — Murphy |
| Phase 2 | Deploy auth middleware + tool layer closure + Zod schema enforcement | Pending — gated on Phase 1 + Elizabeth clearance |
| Phase 3 | Backfill `agent_slug` on historical thoughts, add NOT NULL, drop CHECK constraint | Pending — gated on Phase 2 stability |
| Phase 4 | Drop `agent_name` column from `factory_thoughts` | Deferred — minimum 2 weeks post-Phase 3 |

Phase 4 is irreversible. It must not be executed until Phase 3 has been stable in production for at least two weeks.

---

## References

- `src/server.ts` — `parseBearer()`, `verifyHash()`, auth middleware
- `migrations/001_init.sql` — agents table DDL
- `src/scripts/provision-agent-token.ts` — single-agent token provisioning, rotation (`--force-rotate`), revocation (`--revoke`)
- `src/scripts/provision-all-agents.ts` — batch provisioning (`--all --write-env`), batch rotation (`--force-rotate --confirm`)
- `src/auth/upsert-agent.ts` — `upsertAgent()`, `generateToken()`, `checkEthosSealGate()` — shared provisioning logic
- `docs/08-agent-onboarding.md` — operator runbook: first-time provisioning, rotation, revocation, ingestion token, troubleshooting
- `docs/ARCH-013-the-one-ethos-seal.md` — Ethos Seal prerequisite (initialised before provisioning)
