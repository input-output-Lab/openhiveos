---
title: "ARCH-028 — Human Step-Up via MCP Elicitation with Session Affinity"
date: 2026-11-09
author: "Silas"
owner: "Silas"
status: draft
tags:
  - type/architecture
  - project/openhiveos
  - domain/backend
  - domain/security
review_date: 2027-02-09
doc_id: "ARCH-028"
related:
  - "[[ARCH-026-agent-identity-and-credential-retrieval]]"
  - "[[ARCH-016-integration-pattern-mcp-gateway]]"
---

# ARCH-028 — Human Step-Up via MCP Elicitation with Session Affinity

**Status:** 🟡 DRAFT — Tier-3; Locksmith review required before merge.
**Task:** S19-ARCH-01c (#2776), parent epic #2643. Co-designed with S19-ARCH-01a (#2774, migration 031).
**Decision Owner:** Silas. **Reviewers:** Locksmith (Tier-3), Elizabeth (sprint alignment).

---

## Summary

In plain English: when an agent tries to push a task through the one transition that actually closes work (`pending-close → done`), the system now makes a real human confirm it in VS Code before the write happens. The gateway turns on MCP sessions so it can hold a conversation with VS Code (not just answer one-shot requests), the agent's server sends an `elicitation/create` prompt, the gateway relays it down the *same session's* event stream, and only a human click of "approve" lets the transition proceed. Who clicked is recorded on the transition row (`step_up_user`), the row also says `auth_strength='session'` — the value 031 reserved for exactly this. No human confirmation, no transition. Fail-closed at every layer.

---

## Context

ARCH-026 (Decision 2) ruled: *"Tier-3 transitions and approver transitions require a human confirmation step (elicitation or OAuth scope) with the human recorded."* The mechanism was unbuilt when that record was filed. Constraints discovered since:

- **Spike 2640** verified VS Code 1.143 advertises the elicitation capability, but left untested: whether elicitation can be auto-answered/skipped by an agent ( mitigations below assume it may be attempted), and whether session affinity survives a live round-trip (this task implements and tests it).
- **The gateway is stateless** — it builds a new `Server` per POST and rejects `GET /mcp` with 405. Server→client requests (elicitation) have **no channel** in that topology: the response to a `tools/call` POST cannot carry a second outbound request.
- **One shared upstream client**: the gateway spawns one subprocess and proxies all sessions through one stdio `Client`. When the subprocess elicits, that request arrives at the gateway with **no protocol-level correlation** to the originating `tools/call` — JSON-RPC carries the correlation only inside the sender's local protocol bookkeeping.
- **01a laid the schema**: `auth_strength='session'` is reserved in migration 031's CHECK domain; the human-attribution column shape was explicitly deferred to this task.
- **The authorization matrix is keyed on agent slugs** (`resolveActorRole` in `task-transitions.ts`): `changed_by` must keep naming the authenticated *agent* for role resolution and history to stay coherent — it cannot carry the human without breaking the matrix's own contract.

## Decision

1. **Stateful gateway sessions on `/mcp`.** `StreamableHTTPServerTransport` switches from `sessionIdGenerator: undefined` to per-session ids. The gateway keeps a registry `{ sessionId → { server, transport, agentSlug, createdAt } }`: `initialize` registers the session; every subsequent POST must present `Mcp-Session-Id` **and** a bearer resolving to the *same* agent (session-fixation guard — a stolen session header without the matching token is a 404); `GET /mcp` with a valid session opens the SSE stream that carries server→client requests (elicitation); `DELETE /mcp` ends the session; transport `onclose` evicts. The legacy 405 remains only for session-less GETs (old fallback-probe behavior).

2. **Nonce correlation for step-up routing.** For every proxied `callTool`, the gateway mints a random nonce into `_meta.__stepUpNonce` and registers `{ nonce → sessionId, expiresAt }` in a pending map (TTL 10 min, swept). When the subprocess elicits, it echoes the nonce in the elicitation request `_meta`. The gateway's upstream-client elicitation handler resolves the nonce → session, relays the prompt down that session's GET stream, and returns the answer upstream. **Missing, unknown, expired, or replayed nonce → `action: 'decline'`** — the subprocess treats any decline exactly like a human "no". This is precise correlation *and* fail-closed: an agent that fabricates a nonce gets a decline, not a step-up.

3. **The gate lives inside the matrix, not beside it.** `handleUpdateTask` gains an optional `requireStepUp` callback. When the matrix resolves a gated role for a status transition, the callback runs *before* the write. **No callback supplied + gated role → the transition is rejected (`step_up_required`)** — the enforcement default is fail-closed; wiring the callback is the only way to satisfy it. Gated roles default to **`approver` only** (`pending-close → done`), configurable via `HIVE_STEPUP_ROLES` (subset of `reviewer,approver`) — widening is config, not code. `review → pending-close` (the reviewer gate) stays agent-exercised for now; the accountability moment the epic names is the close.

4. **Elicitation mechanics (subprocess side, `src/auth/step-up.ts`).** The callback sends `elicitation/create` via the handler's `extra.sendRequest` with a 120 s timeout (`GATEWAY_STEPUP_TIMEOUT_MS`), a message naming task, title, from→to, and caller, and a single `approve: boolean` field. Approved **only** when `action === 'accept' && content.approve === true`. Decline, cancel, timeout, transport error, malformed answer — all identical: not approved, transition rejected, nothing written. On approval the gateway stamps the result `_meta` with `__stepUpUser` (the operator label); the subprocess reads it, falling back to `'direct-client'` only in standalone mode where the elicitation was answered by the directly connected client.

5. **Human attribution: `step_up_user` column, not `changed_by`.** Migration 032 adds `task_status_history.step_up_user TEXT` + the `hive.step_up_user` session-var reader; the trigger persists it alongside the 031 columns. `withActor`'s identity context gains an optional validated `stepUpUser`. **Deviation from ARCH-026's wording** ("the human recorded in `changed_by`") is deliberate: `changed_by` keys the authorization matrix and must remain the authenticated agent slug; the human lands in the adjacent column, and the pair `(changed_by=agent, auth_strength='session', step_up_user=human)` is the full attribution. Operator label comes from `GATEWAY_OPERATOR` (gateway env, default `'operator'` with a boot warning when unset — one human on loopback per the ARCH-026 premise; the label is audit readability, not a control).

6. **`auth_strength='session'` starts being emitted** — exactly as reserved in 031 — on transitions that passed step-up. The gateway's own `tool_invocations` row for the call still says `bearer`/`dev` (transport vantage: the token authenticated the call); the history row's `session` is the transition vantage: a human stepped up. The two vantages are complementary, not contradictory.

## Alternatives Considered

### Single-pending mediator (no nonce) — rejected
Route every elicitation to the *only* in-flight step-up, decline when zero or ≥2 are pending. Simpler, but globally serializes privileged transitions across all sessions and silently changes behavior under concurrency. The nonce achieves precise routing with the same fail-closed property and no global lock.

### Human in `changed_by` — rejected
Breaks `resolveActorRole` (matrix keyed on agent slugs) and the P5 audit contract (S17-BE-01): history rows must name the authenticated caller. Recorded as a deliberate deviation above; ARCH-026 consequence text should be read through this refinement.

### Approval via CLI prompt / polling endpoint — rejected
A terminal prompt bypasses the session (no affinity, no client identity); a polling REST endpoint creates an unauthenticated approval surface — precisely the class of flaw S17 closed. Elicitation keeps the confirmation inside the authenticated MCP session where the request originated.

### OAuth scope gate — deferred (unchanged from ARCH-026)
Revisit on a second operator or non-loopback exposure.

## Trade-offs Accepted

1. **The gateway becomes stateful.** ARCH-026 flagged this as a new failure mode (Silas debt note). Sessions live in process memory: a gateway restart orphans session ids (clients re-initialize — standard MCP behavior), and a session registry leak is bounded by TTL sweep + `DELETE` + `onclose` eviction. Concurrency: per-session transports in stateful mode support concurrent POSTs by design.
2. **VS Code clients must re-initialize once** at deploy (stateless → stateful is a protocol-visible change). The standard client flow handles this automatically.
3. **An agent may attempt to auto-answer elicitation.** Untested in the spike; mitigations are structural, not behavioral: approval requires `action:'accept'` **and** `approve:true` from the client the gateway believes it is talking to (the session's own stream), and the gateway only relays, never answers. If VS Code ever surfaces an auto-approve setting, that is a client-policy risk outside this codebase's control — revisit trigger added below.
4. **`step_up_user` is a label, not an identity proof.** Same epistemic status as the persona claim: the operator label names the human for audit readability; on a single-operator loopback machine this is honest. A second operator makes this insufficient → OAuth trigger.
5. **Gateway `tool_invocations` rows do not record the step-up.** The gateway cannot see approval semantics (and must not parse them); the authoritative step-up record is the history row. Documented limit.

## Revisit Triggers

- A second operator, or any non-loopback exposure → OAuth scope gate (ARCH-026 trigger, unchanged).
- VS Code ships elicitation auto-approve defaults → re-evaluate the client-trust assumption.
- `HIVE_STEPUP_ROLES` widening to `reviewer` (review→pending-close prompts) → run the same Tier-3 review; reviewer-ping volume may need a cooldown.

## Consequences (binding once this leaves draft)

1. **No gated transition may complete without a step-up approval** — the default state of `handleUpdateTask` without a callback is *reject*.
2. **The gateway never answers elicitation on behalf of a client** — it relays, with fail-closed nonce routing.
3. **Every step-up-approved transition row carries** `auth_strength='session'` and a non-null `step_up_user`.
4. **Session headers are never trusted without the bearer**: session fixation is rejected at the POST boundary.

## Gates to Leave Draft

1. Locksmith Tier-3 review of this record + the implementation PR.
2. Elizabeth sprint-alignment sign-off.
3. Status flips `draft → Decided`, `docs/README.md` ADR table updated.
