---
title: "ARCH-029 — Unified-Entry Authorization Ceiling (Human Client Is Read-Scoped)"
date: 2026-11-10
author: "Murphy"
owner: "Silas"
status: draft
tags:
  - type/architecture
  - project/openhiveos
  - domain/backend
  - domain/security
review_date: 2027-02-10
doc_id: "ARCH-029"
related:
  - "[[ARCH-026-agent-identity-and-credential-retrieval]]"
  - "[[ARCH-028-elicitation-step-up-session-affinity]]"
  - "[[ARCH-016-integration-pattern-mcp-gateway]]"
---

# ARCH-029 — Unified-Entry Authorization Ceiling (Human Client Is Read-Scoped)

**Status:** 🟡 DRAFT — Founder-ratified 2026-11-10 (Option A). Clarence intake + Silas review pending.
**Task:** Follow-on ruling from S19-ARCH-01g (#2780, live cutover), parent epic #2643.
**Decision Owner:** Silas. **Drafted by:** Murphy. **Ratified by:** Founder (2026-11-10).

---

## Summary

In plain English: the single `openhiveos` MCP entry carries **one** bearer credential — the `one` agent's. That bearer is the **authorization ceiling** for every VS Code session using the entry: what any chat session may write is exactly what `one` may write. Per-agent identity survives as **attribution** (`claimed_persona` on every audit row), never as authorization. The Founder has ratified the consequence: **board writes belong to agent identities**; the human's chat client is deliberately read-scoped (memory, SOPs, projects, task reads). The human directs work in conversation; agents execute board mutations under their own credentials with full audit attribution. The rejected `update_task` from the `one` identity (2026-11-10 06:39:47, `not_found_or_unauthorized`) is the design working as intended, not a defect.

---

## Context

The S19-ARCH-01g cutover (#2780) replaced eleven per-persona `mcp.json` entries with one unified `openhiveos` entry. Two properties of the pre-existing architecture collide in the new topology:

- **SEC-25 data isolation**: `query_tasks` scopes results to projects *owned by the caller*; `update_task` gates on owner OR assignee. Authorization was always resolved from the **bearer**, never from any persona argument.
- **ARCH-026 identity model**: `persona` is a claimed label for the audit trail (`claimed_persona`, `auth_strength` — migration 031); spoofing it is a ratified risk, not an access control.

Under per-persona entries, each session's credential differed, so authorization varied per entry. After the cutover, **one credential serves every session**, so the entry's bearer now defines a single authorization ceiling for all of them. Discovered live on 2026-11-10: the Founder's client (bearer `one`) could read memory/SOPs/projects but `update_task(2780)` failed `not_found_or_unauthorized` — `one` owns no projects and is not an assignee. The same morning also produced the adjacent incident class this ADR closes: the cutover briefly carried the legacy `MCP_GATEWAY_TOKEN` (valid only on `/sse?token=`), producing 401 → VS Code OAuth fallback; `scripts/cutover-single-entry.mjs` now fail-closed rejects non-agent token shapes.

## Decision

1. **Bearer identity is the authorization ceiling.** One entry, one credential. Every session using the unified entry inherits that credential's authority. This is accepted, not worked around.
2. **`one` remains deliberately unprivileged** — it owns no projects and is on no assignee list. This is a control: the chat client's authority is bounded by construction. Do not grant `one` project ownership or assignments.
3. **Board writes flow through agent identities.** The human directs work in conversation; the addressed agent executes the mutation under its own bearer (demonstrated 2026-11-10: `update_task(2780 → review)` as `murphy`, audit row `agent_slug=murphy, claimed_persona=murphy, auth_strength=bearer`). This preserves the accountability chain: every write is attributable to the seat that made it, through the same transition matrix and state machine as before the cutover.
4. **`claimed_persona` is attribution only** — an audit-readability label per ARCH-026. It is never an input to any authorization decision. The pair `(agent_slug = server-resolved truth, claimed_persona = claimed label)` on every `tool_invocations` row is the complete attribution story.
5. **Human read scope is accepted as-is**: memory search, SOP search, project/task reads within the caller's visibility. No new read privileges are provisioned for the chat client.

### Alternatives Rejected

**(b) Dedicated `operator` service slug with board authority** — rejected. Creates a second credential to protect, and more importantly bypasses the agent accountability chain: a human-scoped write lands on the board with no agent seat accountable for it, weakening the reviewer/approver model the state machine exists to enforce.

**(c) Step-up elevation for human board writes** — deferred, not rejected. The mechanism exists post-ARCH-028 (elicitation + `step_up_user` attribution, `auth_strength='session'`). But applying it to the Founder's direct writes adds interactive friction with no audit gain: agent-executed writes already carry full attribution. Revisit under the triggers below.

### Trade-offs Accepted

1. **The human cannot move tasks from chat.** The remedy is conversational, not technical: instruct the owning agent. Cost is one message of latency; benefit is that no board mutation exists without an accountable agent identity behind it.
2. **Session capability is uniform.** Any VS Code session on this machine gets `one`'s authority. Acceptable on the single-operator loopback premise (ARCH-026); a second operator breaks it (trigger below).
3. **The ceiling is invisible until it blocks.** A `not_found_or_unauthorized` from a board write is the ceiling surfacing. Agents' instructions already route board mutations through their own credentials; this is documented behavior, not an error to fix.

## Revisit Triggers

- **Second operator or non-loopback exposure** — per-machine shared identity becomes untenable; revisit (b) with per-human credentials (and ARCH-026's OAuth trigger).
- **The Founder's workflow demands direct board writes** — revisit (c): step-up-gated elevation for the `one` identity on specific write tools, which would attribute `(changed_by=one, auth_strength='session', step_up_user=operator)`.
- **A new tool class needs human-scoped authority** (e.g., approvals no agent may execute) — revisit both (b) and (c) together.
- **`one` is ever granted ownership/assignments** — this ADR must be superseded first; that grant would silently raise every chat session's ceiling.

## Compliance Notes

- SEC-25 isolation unchanged — this ADR rules on its consequences, not its design.
- Migration 031/032 audit columns carry the attribution evidence this ruling relies on; no schema change.
- `scripts/cutover-single-entry.mjs` hardened 2026-11-10: `--token` accepts only the ARCH-008 Decision 7 agent-bearer shape (`salt.secret`), with the provisioning path in the error message.
