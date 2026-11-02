---
title: "ARCH-026 — Agent Identity and Credential Retrieval: One MCP Entry, Persona as Claim, Human Step-Up"
date: 2026-10-30
updated: 2026-11-02
author: "Clarence"
owner: "Silas"
status: draft
tags:
  - type/architecture
  - project/openhiveos
  - domain/backend
  - domain/security
  - audience/technical
review_date: 2027-02-02
doc_id: "ARCH-026"
related:
  - "[[ARCH-001-server-resolved-agent-identity]]"
  - "[[ARCH-016-integration-pattern-mcp-gateway]]"
  - "[[ARCH-015-llm-usage-tracking]]"
  - "[[ARCH-020-manifest-agent-capability-extension]]"
  - "[[ARCH-021-portfolio-matrix-value-domain-roi-chart]]"
---

*This record extends the ARCH numbering lineage that ARCH-021 closed (portfolio matrix decisions) with the S17 identity decision. It is a **DRAFT**: the target direction is agreed but conditional on the S17-SPIKE-01 go/no-go and Founder ratification. It is not binding until the status leaves draft.*

---

# ARCH-026 — Agent Identity and Credential Retrieval: One MCP Entry, Persona as Claim, Human Step-Up

**Status:** 🟡 DRAFT — pending S17-SPIKE-01 go/no-go (due 2026-11-05) and Founder ratification (due 2026-11-05)
**Date:** 2026-10-30 (meeting decision) / 2026-11-02 (record filed)
**Decision Owner:** Silas (target direction), Elizabeth (facilitator of record)
**Filed By:** Clarence (S17-DOC-02, task #2641)
**Source of Record:** [docs/minutes/2026-10-30-agent-token-single-source-mcp-identity.md](minutes/2026-10-30-agent-token-single-source-mcp-identity.md)
**Approvals required to leave draft:** Silas (architecture), Locksmith (auth/secrets review — Tier-3), Richo (Founder ratification of the persona-as-attribution-label position)

---

## Summary

In plain English: today every agent has its own MCP server entry in `mcp.json`, each with a plaintext token anyone on the machine can read — and the audit trail can't actually tell the agents apart, because one identity has made 90% of all recorded tool calls since July. We decided to stop pretending per-agent tokens make each agent a separate security principal. Instead, every client connects through **one** `openhiveos` entry with **one** session credential, the agent persona becomes a **claimed label** on each call (logged as claimed, not verified), and anything privileged — Tier-3 changes, approver transitions — requires a **human confirmation step** recorded in the audit trail. Before this becomes binding, a 4-hour spike must confirm VS Code supports the mechanics, and the Founder must ratify the security position.

---

## Context

The 2026-10-30 meeting (Elizabeth, Silas, Locksmith) was convened because task #2555 — the task-lifecycle state machine on the critical path for S17 — depends on trustworthy identity attribution, and the current identity model cannot provide it.

### The verified evidence (2026-10-30)

- **Topology:** One gateway URL (`127.0.0.1:3008/mcp`), but ten near-identical VS Code server entries (`openhiveos-<slug>`), each with a hardcoded plaintext bearer token. Persona-to-identity binding exists only through each `.agent.md` `tools:` allowlist.
- **Audit collapse:** 5,951 of the 6,594 gateway tool invocations ever recorded (every call since 2026-07-10) carry one identity: `elizabeth`. Post-meeting correction: `MCP_GATEWAY_AUTH_DISABLED` only entered the code on 2026-10-29 (commit `a1eacc3`) and explains only ~510 calls (2026-10-29/30). The other ~5,450 calls (2026-07-10 → 2026-10-28) have an **undetermined cause** — `gateway.ts` updates `agents.last_used_at` on every successful token auth, yet every persona's `last_used_at` froze between 2026-06-15 and 2026-07-30, so those calls did not authenticate with per-persona tokens (or the update fails silently). Resolving this is the main job of S17-OPS-04.
- **Gateway token validation is sound** (salted hash, 24h grace rotation, `timingSafeEqual`). There is no OAuth surface. The auth-disabled flag has no `NODE_ENV` or loopback guard, and `GATEWAY_BIND` is env-overridable — one bind slip makes the flag a remote unauthenticated approver.
- **VS Code 1.143.0 (inspected in the installed bundle):** native MCP OAuth, `${input:}` password prompts, `${env:}`, elicitation advertised to servers. **Refuted:** per-agent `mcp-servers` scoping in `.agent.md` frontmatter only applies to `target: github-copilot` — per-agent server scoping is not available in VS Code.
- **Key tension (unchanged by corrections):** OAuth identifies the VS Code user, not the persona. Personas are LLM roles inside one session.

### The Locksmith position (the security premise)

**A persona is an attribution label, not a security principal.** Every session can read `.env`/`mcp.json` or run a terminal, so a bearer token proves only that *something on the machine could read a file*. Per-persona tokens protect against honest mistakes, partly against a confused agent, and **not at all** against a prompt-injected agent or another local process. This reverses the premise of "each agent pulls its own token": a token an agent can pull is a token any agent can be induced to pull.

### Why no decision was not an option

The audit trail (`tool_invocations`, `changed_by`) has been unreliable since 2026-07-10 and the auth-disabled flag (Critical, Tier-3) mapped every caller to `elizabeth` — the approver. #2555 cannot reach done on a compromised attribution record, and S17 closes 2026-11-06.

---

## Decision

**Agreed direction (subject to draft gates below):**

1. **Target state — single MCP entry with claimed persona.** One `openhiveos` entry per client with one session credential (Keychain or `${input:}` at cutover; not this sprint). The persona becomes an **optional `persona` tool argument** that each `.agent.md` body instructs the model to pass. The gateway lifts it into `_meta.__agentSlug` with `claimed=true` plus an `auth_strength` value on every audit row. This extends the ARCH-021 numbering lineage: ARCH-021 closed the portfolio-matrix decision record that Sprint 11 opened; this record carries the same lineage into the S17 identity decision.

2. **Human step-up on privilege.** Tier-3 transitions and approver transitions require a **human confirmation step** (elicitation or OAuth scope) with the human recorded in `changed_by`. Authority for privileged actions comes from the human, not the token.

3. **The flag never maps to the approver (Silas–Locksmith reconciliation).** If auth is disabled, the gateway maps calls to a **non-privileged identity or rejects** — never to the approver. The current Critical finding (flag maps everything to `elizabeth`) is eliminated even if the flag ever returns.

4. **Interim before target — sequence is binding:**
   1. Verify each persona can authenticate on a loopback test gateway (:3018, health on :3019) with the flag unset — stale-token risk means verification is first or agents get locked out.
   2. Remove `MCP_GATEWAY_AUTH_DISABLED` (no code change; closes the Critical finding). Guard ships *after* removal because the running gateway has `NODE_ENV=production` and shipping the guard first would crash-loop it.
   3. Ship the startup guard: abort if the flag is set and `NODE_ENV=production` or the bind is not loopback (Tier-3).
   4. #2555 reaches pending-close only after the flag is off **and** its matrix passes live with real identities.

5. **Option 5 (OAuth) is deferred behind a trigger**, not rejected: revisit on a second operator or any non-loopback exposure. For one human on loopback, OAuth identifies the VS Code user — not the persona — and adds ~24–32h.

6. **Fallback if the spike returns no-go:** revert to ten per-agent entries with `${input:}` prompts (no plaintext in `mcp.json`).

**Accepted risk (Founder must ratify):** an adversarial agent can **spoof a persona claim** — it is LLM-supplied by design. The persona is a label for humans reading the audit trail, not a control. Locksmith accepts this risk; the Founder ratification records it formally.

---

## Alternatives Considered

### Option 1 — Keep ten per-agent entries, keep plaintext tokens — Rejected (interim-only, conditional)

**Why rejected:** The audit collapse is partially explained and partially undetermined; plaintext tokens readable by any agent on the machine contradict the stated security model; and the flag-to-approver mapping remains a Tier-3 critical. Per-persona tokens give the *feeling* of per-agent principals while provably not being one.

### Option 2 — Per-agent entries with `${input:}` / Keychain — Conditional / fallback only

**Why not the target:** Improves credential hygiene but keeps ten entries and ten prompts for ten agents that share one VS Code process; does not fix attribution (a stolen token still authenticates as that persona); Silas ruled ten `${input:}` prompts this week is operational friction with no #2555 benefit. It is the **approved fallback** if the spike returns no-go, and `mcp.json` restructure is deferred to cutover.

### Option 3 — Ten entries with per-agent header scoping via `.agent.md` — Rejected

**Why rejected:** Refuted during evidence gathering — VS Code `mcp-servers` frontmatter scoping only applies to `target: github-copilot`. The mechanism does not exist in this VS Code version.

### Option 5 — Full OAuth (end state per Locksmith) — Deferred behind trigger

**Why deferred:** Locksmith approved OAuth as end state; Silas dissented on cost-benefit: ~24–32h added for one human on loopback, and OAuth identities attach to the VS Code user, not the persona, so it does not solve the actual attribution question. **Trigger to revisit:** a second operator, or any non-loopback exposure.

---

## Trade-offs Accepted

1. **Spoofable persona claims.** A prompt-injected agent can claim any persona. Accepted by Locksmith as an attribution label; requires Founder ratification. Mitigation is the human step-up, not the claim itself.
2. **Stateful gateway sessions.** Elicitation with session affinity (`Mcp-Session-Id`) makes the gateway stateful per session — a new failure mode for a currently stateless per-POST design (Silas debt note).
3. **LLM-supplied persona argument.** The model must reliably pass `persona`; stale `tools/list` caches may not surface the schema. Spike question.
4. **Audit history stays broken.** The ~5,450 calls from 2026-07-10→10-28 remain unattributable; this decision makes the record trustworthy going forward, not retroactively.
5. **Deferred hygiene.** `mcp.json` `${input:}`/Keychain restructure and token rotation of unexposed tokens wait for cutover; rotation of *exposed* tokens happens now (S17-SEC-02).

---

## Disagreements Resolved into the Decision

| # | Locksmith position | Silas position | Resolution |
|---|---|---|---|
| 1 | Flag should never map to the approver | Same direction, different emphasis | Flag maps to non-privileged identity or rejects (Decision 3) — stronger than guard-only |
| 2 | Move `mcp.json` to `${input:}` now | Not this week (ten prompts; no #2555 value) | Deferred to cutover; rotate exposed tokens now |
| 3 | OAuth as end state | OAuth not justified for one human on loopback | Deferred behind trigger (second operator / non-loopback) |
| 4 | Elicitation is human step-up, near-free | Elicitation needs session affinity; not free | Target includes elicitation with affinity; feasibility is a spike question |

---

## Files Affected by This Decision

| File or Path | Role |
|---|---|
| `src/mcp-gateway/gateway.ts` | Auth chain; claimed-persona lift into `_meta.__agentSlug`; `auth_strength` audit column; flag mapping to non-privileged identity |
| `src/mcp-gateway/` (startup guard) | Abort if flag set && `NODE_ENV=production` || bind not loopback (S17-BE-06, Tier-3) |
| `.env` | `MCP_GATEWAY_AUTH_DISABLED` removed (S17-OPS-05) |
| `mcp.json` (user scope) | Ten `openhiveos-<slug>` entries → one `openhiveos` entry at cutover |
| `agents/*.agent.md` | Body instruction to pass `persona` argument per call |
| `tool_invocations` schema | New audit columns: `user`, `claimed_persona`, `auth_strength` |
| `provision/` token scripts | `--keychain` option at cutover; human-run rotation script |
| `packages/dashboard/` | `VITE_DASHBOARD_AGENT_TOKEN` retirement (S18-SEC-03, Rocket) |
| `/sse` Bridge path | Verifying curl only this sprint; changes deferred (ARCH-016 must not break) |

---

## Consequences

Write these as the rules the team follows once the ADR leaves draft:

1. **Personas are never treated as security principals** in any threat model, permission check, or audit interpretation. They are labels.
2. **No code path may map a disabled-auth caller to a privileged identity** — non-privileged or reject, without exception.
3. **Tier-3 and approver transitions require the human step-up**, and `changed_by` records the human, not the persona.
4. **Audit rows carry `claimed_persona` and `auth_strength`**; consumers must never read `claimed_persona` as verified identity.
5. **The `/sse` Bridge path (ARCH-016) must keep working** through every step of the migration; a verifying curl is the only permitted touch this sprint.
6. **`MCP_GATEWAY_AUTH_DISABLED` must never be set in production**, enforced by the startup guard.
7. **The Bridge SSE path and the dashboard bearer retirement (S18-SEC-03) follow this ADR's migration plan**, not parallel ad-hoc plans.

---

## Migration Plan and Owners (from the decision record)

| Work item | Owner | Due | Status at filing |
|---|---|---|---|
| S17-OPS-04 — why is the flag on; verify one call per persona on :3018/:3019; check pm2 outage logs | Cooper | 2026-11-02 | Open |
| S17-BE-06 — startup guard + non-privileged flag mapping (Tier-3, Locksmith review) | Murphy | 2026-11-03 | Open |
| S17-SEC-02 — rotate exposed tokens (human-run) + update `mcp.json` | Cooper with Founder | 2026-11-03 | Open |
| S17-OPS-05 — remove flag, restart :3008, run #2555 matrix live | Cooper | 2026-11-03 | Open |
| S17-SPIKE-01 — 4h identity spike (five questions) | Murphy with Locksmith | 2026-11-05 | Open |
| Founder ratification — persona-as-attribution-label + spoof risk + capacity trim | Richo | 2026-11-05 | Open |
| #2555 pending-close gate — flag off + matrix passed live | Elizabeth | 2026-11-04 | Open |
| S18-SEC-03 — retire bearer-in-bundle dashboard token | Rocket | 2026-11-13 | Open |
| S18-ARCH-01 — target identity build epic (30–36h), split at S18 planning on spike go | Murphy (design: Silas) | 2026-11-13 | Open |

**Spike questions (S17-SPIKE-01):** (1) can the agent or an auto-approve setting skip elicitation; (2) does elicitation work with `Mcp-Session-Id` affinity; (3) does the model reliably pass `persona` and does the schema survive `tools/list` caching; (4) can a terminal read the secret store; (5) does `/sse` work without `_meta`.

**Estimated cost:** interim ~6–8h; target build ~30–36h; OAuth (if triggered) ~24–32h additional.

**Not this sprint (binding scope fence):** OAuth, migrating all ten entries, `/sse` changes beyond one verifying curl, the dashboard rewrite, the #2551 cron worker (needs its own Tier-3 review).

---

## Gates to Leave Draft

1. S17-SPIKE-01 returns **go** (or the fallback in Decision 6 is formally chosen).
2. Founder ratification recorded (persona-as-attribution-label + accepted spoof risk).
3. Silas architecture review sign-off on this record.
4. Locksmith security review sign-off on this record (Tier-3 surface: flag mapping, guard, step-up path).
5. Status flips `draft → Decided`, `docs/README.md` ADR table updated, and the decision logged in the S18-DOC-01 consolidation (#2568) scope where it overlaps.

---

## Related Documents

- [docs/minutes/2026-10-30-agent-token-single-source-mcp-identity.md](minutes/2026-10-30-agent-token-single-source-mcp-identity.md) — source meeting record
- [ARCH-001-server-resolved-agent-identity.md](ARCH-001-server-resolved-agent-identity.md) — server-resolved identity from bearer token (superseded in part by the claimed-persona model if ratified)
- [ARCH-016-integration-pattern-mcp-gateway.md](ARCH-016-integration-pattern-mcp-gateway.md) — gateway sidecar + `/sse` Bridge contract that must not break
- [ARCH-015-llm-usage-tracking.md](ARCH-015-llm-usage-tracking.md) — ingestion auth model and PoLP precedent
- [ARCH-021-portfolio-matrix-value-domain-roi-chart.md](ARCH-021-portfolio-matrix-value-domain-roi-chart.md) — prior record in this ARCH numbering lineage
- [ARCH-020-manifest-agent-capability-extension.md](ARCH-020-manifest-agent-capability-extension.md) — `.agent.md` capability model that will carry the `persona` instruction
- Task #2568 (S18-DOC-01) — consolidation ADR scope where this record folds in
