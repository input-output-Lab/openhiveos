# Meeting Notes — Single point for agent token retrieval (MCP identity)
**Date:** 2026-10-30
**Project:** OpenHiveOS
**Participants:** Elizabeth, Silas, Locksmith
**Facilitator:** Elizabeth
**Status:** 🟡

---

## Objective
Decide the target design for agent identity and token retrieval (replacing ten per-agent MCP server entries) and the interim step that lets #2555 reach done before S17 closes on 2026-11-06.

## Evidence gathered before the meeting (verified 2026-10-30, no token values recorded)
- **Topology:** one gateway URL (`127.0.0.1:3008/mcp`), but ten near-identical VS Code server entries (`openhiveos-<slug>`), each with a hardcoded plaintext bearer. Persona-to-identity binding exists only through each `.agent.md` `tools:` allowlist.
- **Audit collapse:** 5,951 of the 6,594 gateway tool invocations ever recorded (every call since 2026-07-10) carry one identity, `elizabeth`. Whether the cause is `MCP_GATEWAY_AUTH_DISABLED=true` since July or all clients sharing one credential is undetermined (`.env` was last modified 2026-08-11, which predates neither explanation). Either way, `tool_invocations` and `changed_by` cannot be trusted for attribution since 2026-07-10.
- **Gateway:** token validation is sound (salted hash, grace rotation, `timingSafeEqual`); there is no OAuth surface; the auth-disabled flag has no `NODE_ENV` or loopback guard and `GATEWAY_BIND` is env-overridable.
- **VS Code 1.143.0 (inspected in the installed bundle):** native MCP OAuth (protected-resource metadata, authorization-server discovery, dynamic provider registration, Client ID Metadata Documents); `${input:}` password prompts and `${env:}`; elicitation advertised to servers; `chat.agent.sandbox.mcpServers`. Refuted: `mcp-servers` in `.agent.md` frontmatter only applies to `target: github-copilot`, so per-agent server or header scoping is not available in VS Code.
- **Key tension:** OAuth identifies the VS Code user, not the persona. Personas are LLM roles inside one session.

---

## Discussion

### Elizabeth (Opening)
Objective as above. Success means: a chosen direction with Locksmith's conditions, an interim step this week that turns the auth-disabled flag off, a time-boxed spike for the unverified VS Code items, and owners with dates. Risks: #2555 and #2551 are on the critical path; the 61h core lock leaves no room for a re-architecture; identity changes are Tier-3; the Bridge SSE path (ARCH-016) must not break.
- Question for Locksmith: is a persona a security principal or an attribution label, and what is the minimum control set for each answer?
- Question for Silas: which option do you recommend, what is the smallest first step that unblocks #2555 this sprint, and what does migrating the ten entries cost?

### Locksmith
**Position: a persona is an attribution label, not a security principal.** Every session can read `.env`/`mcp.json` or run a terminal, so a bearer token proves only that something on the machine could read a file. Per-persona tokens protect against honest mistakes, partly against a confused agent, and not at all against a prompt-injected agent or another local process.
Ranked findings:
1. **Critical, Tier-3:** `MCP_GATEWAY_AUTH_DISABLED=true` maps every caller to `elizabeth` (the approver), with no production or loopback guard; one `GATEWAY_BIND` slip makes it a remote unauthenticated approver.
2. **High, Tier-3:** plaintext tokens in `mcp.json` and `.env` readable by any agent.
3. **High:** `VITE_DASHBOARD_AGENT_TOKEN` is baked into the browser bundle by design; `packages/dashboard/.env.local` (gitignored) holds a token-shaped value, so treat it as exposed.
4. **Medium:** `/sse` Bridge path carries one shared token in a `?token=` query string that lands in logs.
5. **Medium:** stale tools/list cache and tool-name forking (operational).
Controls: tokens out of `mcp.json` (Keychain or `${input:}`); one session credential per client; persona passed per call and logged as "claimed"; human step-up (elicitation or OAuth scope) for Tier-3 and approver transitions with the human recorded in `changed_by`; log `user`, `claimed_persona`, `auth_strength`; rotate with the existing grace window.
Options: 4 approved as target, 5 approved as end state, 1/2/3 conditional or interim only.
Conditions: flag off with a startup guard before #2555 reaches pending-close; tokens rotated; bearer-in-bundle retired on any production path; target ships only after the spike; approver-path changes return to Locksmith as Tier-3; SEC-14 remains a Founder action.

### Silas (Closing Technical Voice)
**Recommendation: option 4, with option 5 (OAuth) deferred behind a trigger.** One `openhiveos` entry with one session credential per client (Keychain or `${input:}`); the persona is an optional `persona` tool argument the `.agent.md` body tells the model to pass, lifted by the gateway into `_meta.__agentSlug` with `claimed=true` and `auth_strength` on every audit row; human elicitation provides the step-up on Tier-3 and approver transitions.
Verified: VS Code sends elicitation capability; the gateway has no guard; `ecosystem.config.cjs` defaults the flag to `false`, so `.env` turned it on; `/mcp` builds a new `Server` per POST (stateless); `provision-agent-token.ts` prints the token to stdout (human-only). Refuted: per-agent `mcp-servers` scoping in VS Code. Undetermined: OAuth account choice across personas, whether elicitation can be skipped or auto-answered, whether hooks can inject `_meta`, whether a terminal can read the secret store, whether `/sse` works without `_meta`.
**Smallest first step for #2555 (~6h):** find why the flag is set; start a second loopback gateway (:3009) with the flag unset and verify one read call per persona; add a startup guard (aborts if the flag is set and `NODE_ENV=production` or the bind is not loopback; Tier-3); remove the flag, restart :3008, run the #2555 matrix live; a human rotates only the exposed tokens. Rollback: re-enable the flag on loopback only, as a dated signed exception.
**Migration cost:** interim ~6-8h; target ~30-36h (gateway auth/claim 6-8, elicitation with session affinity 8-10, audit columns 3, subprocess identity 1.5, `/sse` 3, `provision --keychain` 2, dashboard 1-3, `mcp.json` + ten agent files 3); OAuth would add ~24-32h.
**Disagreements with Locksmith:** (1) the flag should never map to the approver: map to a non-privileged identity or reject, not just add a guard; (2) do not move `mcp.json` to `${input:}` this week (ten prompts, not needed for #2555), and rotate only exposed tokens now; (3) elicitation is not free because the gateway is stateless and needs session affinity; (4) OAuth as end state is not justified for one human on loopback, so trigger it on a second operator or non-loopback exposure.
**Debt:** removes ten stale caches, plaintext tokens, and the approver default; creates an LLM-written persona claim (spoofable by design, carry as a Locksmith-accepted risk) and stateful gateway sessions (new failure mode).
**Spike (4h, Murphy with Locksmith):** can the agent or an auto-approve setting skip elicitation; does elicitation work with `Mcp-Session-Id` affinity; does the model reliably pass `persona` and does the schema survive caching; can a terminal read the secret store; does `/sse` work without `_meta`.

---

## Decisions
| Decision | Owner | Due Date |
|----------|-------|----------|
| Target direction is option 4 (single `openhiveos` entry, persona as a claim, human elicitation step-up on Tier-3/approver transitions), subject to spike go/no-go. Option 5 (OAuth) is deferred until a second operator or non-loopback exposure. Fallback if the spike says no-go: ten entries with `${input:}` | Silas | 2026-11-06 |
| Interim comes first: flag off, startup guard, and the flag never maps to the approver (non-privileged identity or reject). Guard and mapping are Tier-3 | Murphy (review: Locksmith) | 2026-11-03 |
| #2555 does not move to pending-close until the flag is off and the matrix has passed live with real identities | Elizabeth | 2026-11-04 |
| Rotation rule: rotate now every token that has appeared in a transcript, log, or bundle (resolves Locksmith "all ten" vs Silas "exposed only"); the rest rotate at cutover. Locksmith to confirm | Cooper with the Founder (human runs the script) | 2026-11-03 |
| `mcp.json` restructure to `${input:}`/Keychain is deferred to the cutover, not done this week | Silas | 2026-11-06 |
| Not this sprint: OAuth, migrating all ten entries, `/sse` changes beyond one verifying curl, the dashboard rewrite, the #2551 cron worker (needs its own Tier-3 review) | Elizabeth | 2026-11-06 |
| Run the 4h identity spike after the interim step; its outcome decides go/no-go on option 4 | Murphy with Locksmith | 2026-11-05 |

## Decisions requested from the Founder
| Decision | Owner | Due Date |
|----------|-------|----------|
| Ratify "a persona is an attribution label; authority for Tier-3 and approver transitions comes from a human step-up", and accept that an adversarial agent can spoof a persona claim. This reverses the premise of "each agent pulls its own token": a token an agent can pull is a token any agent can be induced to pull | Founder | 2026-11-05 |
| Capacity trim for ~12.5h of unplanned work. Recommendation: defer #2573 (5h) and #2552 (7h, gated on #2557) to S18 | Founder | 2026-11-02 |
| Run the token rotation script by hand (it prints the token; no agent should run it) and update `mcp.json` afterwards | Founder | 2026-11-03 |
| Enable SEC-14 branch protection on `main` (still open from the 2026-10-30 branch incident) | Founder | 2026-11-03 |

## Action Items
- [ ] S17-OPS-04: establish when and why the auth-disabled flag is on, verify one call per persona on a loopback :3009 gateway with the flag unset, and check pm2 logs for today's unexplained outage — **Owner:** Cooper — **Due:** 2026-11-02 — 1.25h
- [ ] S17-BE-06: startup guard (abort if the flag is set and `NODE_ENV=production` or bind is not loopback) plus non-privileged mapping for the flag; Tier-3 — **Owner:** Murphy — **Due:** 2026-11-03 — 2.5h
- [ ] S17-SEC-02: rotate exposed tokens (Elizabeth, `AGENT_TOKEN`, dashboard, SonarQube, any other that appeared in a transcript) and update `mcp.json`; human-run — **Owner:** Cooper with the Founder — **Due:** 2026-11-03 — 1.25h
- [ ] S17-OPS-05: remove the flag, restart :3008, run the #2555 matrix live with real identities — **Owner:** Cooper — **Due:** 2026-11-03 — 1.5h
- [ ] S17-SPIKE-01: 4h identity spike (five questions above) — **Owner:** Murphy with Locksmith — **Due:** 2026-11-05 — 4h
- [ ] S17-DOC-02: draft ADR for agent identity and credential retrieval, extending ARCH-021, status draft until the spike returns — **Owner:** Clarence — **Due:** 2026-11-06 — 2h
- [ ] S18-SEC-03: retire the bearer-in-bundle dashboard token (no baked token on any production path) — **Owner:** Rocket — **Due:** 2026-11-13 — 3h
- [ ] S18-ARCH-01: target identity build epic (30-36h); split into sub-tasks at S18 planning once the spike returns go — **Owner:** Murphy (design: Silas) — **Due:** 2026-11-13

## Issues for Next L10 IDS
| Issue | Raised By |
|-------|-----------|
| All 5,951 gateway invocations since 2026-07-10 are attributed to `elizabeth`; the audit trail is unreliable for 3.5 months and the cause is undetermined | Elizabeth |
| Any agent with a terminal can read every other agent's token; tokens that appear in transcripts are not rotated by policy | Locksmith |
| Stale board item #1805 "OAuth2 Gateway Stability Validation" needs re-validation, supersede, or close given this decision | Elizabeth |
| Bearer token baked into the dashboard bundle (`VITE_DASHBOARD_AGENT_TOKEN`) and a token-shaped value in `packages/dashboard/.env.local` | Locksmith |
| `/sse` Bridge path: shared `?token=` in the query string and possibly no `_meta` identity | Locksmith, Silas |
| SEC-14 branch protection on `main` is still not enabled | Elizabeth |
| Four owners named here (Murphy, Cooper, Clarence, Rocket) were not in the room and have not yet acknowledged | Elizabeth |

---

## Elizabeth's Closing Note
Both technical voices converge on one conclusion that the Founder needs to hear plainly: giving each agent a token it can pull for itself does not make the agent a distinct principal, because anything that can pull its token can be induced to pull another's. The direction agreed is one entry, persona as a claim, and a human confirming Tier-3 and approver transitions. Before any of that, the attribution record has to become real: the flag comes off behind a guard, tokens that have appeared in transcripts get rotated, and #2555 only closes after its matrix passes with real identities. The single most important thing to keep in focus this week is that sequence, because the cost is about 12.5h of unplanned work against a 61h core lock and it needs a Founder trim on Monday.

Meeting facilitation note: Elizabeth could not be invoked as a subagent from her own seat, so the opening and this close were written by the facilitating session. A SonarQube token and an agent token were displayed in session output while this meeting was prepared; both are in the rotation set above.

---

## Post-meeting corrections (2026-10-30, same day)
These supersede the evidence and sequencing above where they conflict.

1. **The flag does not explain the July collapse.** `MCP_GATEWAY_AUTH_DISABLED` entered the code on 2026-10-29 (commit `a1eacc3`, "gateway dev-auth flag"). It accounts for only the last ~510 calls (2026-10-29 and 2026-10-30). The other ~5,450 calls (2026-07-10 to 2026-10-28) have an undetermined cause. `gateway.ts` updates `agents.last_used_at` on every successful token authentication, yet every persona's `last_used_at` froze between 2026-06-15 and 2026-07-30, so those calls did not authenticate with per-persona tokens (or the update fails silently). Resolving this is now the main job of S17-OPS-04.
2. **Port conflict.** `:3009` is the gateway's health listener (bound on all interfaces, unauthenticated). The test gateway must use another pair of ports, for example `:3018` with health on `:3019`. S17-OPS-04, S17-OPS-05 and S17-SPIKE-01 reference `:3009` and are corrected.
3. **Order of the interim steps.** The running gateway has `NODE_ENV=production` and the flag set. Shipping the startup guard first would crash-loop it. Remove the flag first (no code, closes the Critical finding), then ship the guard. Both are still required before #2555 reaches pending-close.
4. **Stale-token risk.** All 13 agent records show a rotation and the grace window has long expired, so the tokens in `mcp.json` may no longer authenticate. Removing the flag before verifying each persona on the test gateway could lock agents out. Verification stays the first step.
5. **New issue for L10:** the health endpoint listens on all interfaces without authentication (`*:3009`).
