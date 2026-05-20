---
title: Architecture Review — Linear Next vs OpenSquad Strategic Positioning
date: 2026-05-19
type: meeting-minutes
project: opensquad-mcp-server
participants: Elizabeth, Silas, Murphy, Rocket, Cooper, Clarence, Nova, Locksmith
outcome: Option C decided — Formalize OpenSquad as Agent OS (6/6 votes)
adr: ARCH-003-formalize-agent-os-linear-next.md
tags: [architecture, adr, opensquad, linear, agent-os, positioning]
---

# Architecture Review — Linear Next vs OpenSquad Strategic Positioning

**Date:** 2026-05-19
**Facilitator:** Elizabeth
**Protocol:** arch-review.prompt.md
**Status:** Complete — ADR filed, tasks created, memories synced

---

## Agenda

Linear's release of Linear Next (AI-native project management) created a surface-level positioning overlap with OpenSquad. The review question: Should OpenSquad integrate with Linear, compete with it, or diverge? The deeper concern raised by Richo: adding PM features to OpenSquad would pigeon-hole a system designed for collective squad memory into a "development tool" category.

---

## Step 1 — Elizabeth Frames the Problem

**Problem statement:**

Linear Next has launched with AI-native project management capabilities. On the surface, it appears to occupy adjacent territory to OpenSquad — tasks, sprints, AI-driven workflows. The question is whether OpenSquad should respond by integrating with Linear, sharpening against it, or clarifying what it is so clearly that the overlap dissolves.

Three concerns were named at intake:

1. **Pigeon-hole risk** — If we add Linear-like features or integrate deeply with it, we anchor OpenSquad's identity to the developer PM category. Nova, Clarence, Elizabeth, and other non-dev agents become second-class users of a tool built for engineers. That is not what OpenSquad was designed to be.

2. **Strategic drift** — ClickUp already handles client-facing project management. Richo already uses it. Adding a Linear integration would create a third PM layer with no clear authority hierarchy.

3. **Identity uncertainty** — The squad is operating with tacit knowledge of what OpenSquad is. That tacit knowledge has not been formalized. Linear's launch is the external pressure that makes formalization urgent.

**What success looks like:** A clear position statement that any agent can use when a client or external stakeholder asks "is OpenSquad a project management tool?" The answer should be immediate and non-defensive.

---

## Step 2 — Silas Proposes Options

**Three options proposed:**

### Option A — Hold the Line
Deepen epistemic differentiation. No new dependencies, no integration work. Invest in three-tier thought ratification, agent dispositions, and semantic memory. Let Linear and ClickUp compete in PM. OpenSquad continues growing as the cognitive substrate.

*Estimated effort:* Low implementation / Medium documentation discipline tax (Murphy correction)

### Option B — Strategic Interop
Build an MCP bridge to the Linear API. Expose OpenSquad memory and task data to Linear. Agent-authored content surfaces in the PM tool humans already use.

*Estimated effort:* High — 4 hard infrastructure prerequisites don't exist
*Note: Subsequently vetoed by Locksmith on security grounds.*

### Option C — Formalize as Agent OS
Declare OpenSquad the Agent Operating System for IO Labs. Define a two-tier architecture: OS primitives (memory, identity, SOPs, agent registry, token lifecycle) vs coordination utilities (tasks, crons, projects, cost tracking). File ARCH-003. Restructure documentation. Initiate Richo naming decision.

*Estimated effort:* Low–Medium

---

## Step 3 — Cross-Seat Review

### Murphy — Engineering Lead

Recommends **Option C** in two phases. Phase 1 (no Richo decision needed): internal two-tier documentation and tool classification. Phase 2 (requires Richo): external "Agent OS" identity.

Named disagreement on record: Option A is not "Low effort." It carries a recurring documentation discipline tax — without formal two-tier framing, agents produce inconsistent terminology every session, and the glossary gap compounds. Silas's original effort rating for A was too narrow (measured implementation only, not organizational cost). The relative cost comparison between A and C changes when the recurring cost is included — C's documentation investment is one-time.

### Rocket — Frontend/UI Lead

Recommends **Option C**. The two-tier architecture provides Squad Dashboard with an information hierarchy to build toward. Option B vetoed on UI grounds: dual-source rendering problem (OpenSquad internal state + Linear external state) creates a new error state category. Option A is passive — no architecture to build toward.

Squad Dashboard direction: visually separate OS primitives from coordination utilities as distinct information tiers, not a flat tool list.

### Cooper — DevOps Lead

Recommends **Option C**. Option B has 4 hard infrastructure prerequisites that currently do not exist: (1) secrets vault / OAuth token lifecycle management, (2) staging environment for MCP bridge testing, (3) webhook ingress with signature verification, (4) circuit breaker spec for Linear API downtime. Additionally, argus-mcp crash loop (789 restarts, Task 1183) is unresolved — must be addressed before any Option B reconsideration. Option C requires zero new infrastructure work.

### Clarence — Documentation Lead

Recommends **Option C**. One rule: ARCH-003 must be filed and terminology locked *before* any documentation restructure begins. Restructuring against an unlocked glossary is rework debt, not progress.

Highest-compounding documentation risk identified: glossary.md is missing definitions for Agent OS, OS primitive, coordination utility, epistemic memory, collective memory, and transport. Every onboarding session and every new agent invocation that uses undefined terms compounds this debt.

Option B creates a documentation maintenance contract tied to Linear's API stability — a liability Clarence explicitly does not want to own.

### Nova — Strategic Lead

Recommends **Option C** — but with three cross-project risk flags:

**1. Stability Promise Trap**
"Agent OS" as an external label implies guarantees the system does not yet make: no deprecation protocol, no API versioning, no backwards compatibility window. Evidence: 27 schema migrations in approximately eight weeks. That is not OS-level stability pace. It is active platform construction. Do not use "Agent OS" externally until those commitments exist. Nova recommends "Agent OS" be internal framing only until stability commitments are formally defined.

**2. Governance Vacuum**
Who holds binding authority to determine whether a given capability is an OS primitive or a coordination utility? No seat answered this. Silence is not agreement — it is an unaddressed gap. If the tier boundary is changed ad hoc, the architecture degrades to Option A within two sprints.

**3. MemPalace Classification Problem**
pgvector (current) vs ChromaDB — which is the authoritative vector store? MemPalace's architecture currently treats ChromaDB as authoritative and pgvector as a replica target via PgvectorBackend. If that relationship is reversed or made co-equal, the implications for ARCH-002's upsert model, the factory_memory schema, and search_memory query routing must be assessed. This cannot be deferred past ARCH-003 finalization.

Nova proposed a one-page decision memo to Richo with a 48-hour decision window to protect Founder bandwidth (3 decisions, binary choices, recommended defaults).

### Locksmith — Security Lead

**Option B: VETOED. Binding security ruling.**

OWASP Top 10 violations found in a hypothetical Option B implementation:
- A01: No data classification layer separating internal-only from Linear-safe data
- A02: Linear OAuth credentials would be stored in `.env` — no vault, no rotation
- A04: No formal threat model exists for OpenSquad, and none was proposed for the bridge
- A05: Trust model mismatch — internal bearer tokens vs Linear OAuth
- A08: Inbound webhook signature verification absent
- A09: No outbound data audit logging

Options A and C pass security review. Option C approved — introduces no new attack surface.

Standing Locksmith gate established by ARCH-003: any PR touching auth middleware, token validation, tool routing, or DB access control requires Locksmith review before merge.

Three token lifecycle debt items confirmed as sprint-ready (pre-existing, not introduced by Option C):
1. `expires_at` is not enforced in auth middleware — tokens do not expire automatically
2. No atomic revocation endpoint — token invalidation requires direct database intervention
3. No rotation automation — manual rotation creates operational risk during handoffs or compromise events

---

## Step 4 — Decision Matrix

| Dimension | Option A: Hold the Line | Option B: Strategic Interop | Option C: Formalize as Agent OS |
|---|---|---|---|
| **Effort** | Low (impl) / Medium (doc discipline — recurring) | N/A — Vetoed | Low–Medium (one-time) |
| **Platform Fit** | Passive — no architecture to build toward | N/A — Vetoed | High — coherent target for all seats and Squad Dashboard |
| **Security Risk** | Low | Vetoed — 6 OWASP violations | Low — passes with 3 token debt items (not blockers) |
| **Ops Complexity** | Low | 4 infrastructure prerequisites + argus crash loop | Low — zero new infrastructure |
| **Test Complexity** | Low | High — dual-source rendering + new error states | Low–Medium — tier boundary needs test coverage |
| **Votes** | 0 | 0 (Vetoed) | 6/6 |

**Named disagreements:**

1. **Option A effort — Silas vs Murphy:** Silas rated A as Low effort; Murphy correctly identified the recurring documentation discipline tax. Silas accepts Murphy's correction.

2. **"Agent OS" external naming — Nova vs Murphy/Rocket/Cooper:** Murphy, Rocket, and Cooper treat Phase 2 external identity as a scheduled milestone. Nova treats it as conditional on stability commitments. These are not compatible positions. The tension is: does naming accelerate stability, or does it create liability before stability exists?

3. **Governance vacuum and MemPalace classification — Nova (unresolved, no dissent):** No seat disputed these risks. No seat resolved them. They are open conditions that must be closed before Phase 2.

---

## Step 5 — Decision

**Outcome: Option C — Formalize OpenSquad as Agent OS**
**Vote: 6/6 (Murphy, Rocket, Cooper, Clarence, Nova, Locksmith)**
**Option B: Vetoed (Locksmith — binding)**

---

## ADR

**ARCH-003** filed at: `docs/ARCH-003-formalize-agent-os-linear-next.md`

---

## Three Open Decisions — Richo Must Resolve

These are Integrator decisions. They require authority and a deadline, not more analysis.

**Decision 1 — External Naming Gate** *(48-hour window)*
Is "Agent OS" as an external-facing identity conditional on defined stability commitments (deprecation protocol, versioning policy, backwards compat window)?
- Nova: yes, unconditionally
- Murphy/Rocket: Phase 2 is a scheduled milestone
- Until resolved: "Agent OS" is internal nomenclature only

**Decision 2 — Tier Boundary Governance**
Who holds binding authority to change what counts as an OS primitive vs a coordination utility?
- Silas: lightweight RFC process, 48h window, Silas as deciding vote
- Nova: any primitive reclassification requires cross-seat review
- Must be resolved before ARCH-003 Phase 2

**Decision 3 — MemPalace Vector Store Authority**
pgvector or ChromaDB — which is the authoritative vector backend?
- Must be resolved before ARCH-003 Phase 2
- Silas + Nova to work this before Phase 2 begins

---

## Action Items

| # | Task ID | Title | Owner | Gating |
|---|---|---|---|---|
| 1 | #1216 | Retrospectively classify all 22 MCP tools | Murphy | None — Phase 1 |
| 2 | #1217 | Token lifecycle sprint items (expires_at, revocation, rotation) | Murphy | Next sprint |
| 3 | #1218 | Audit glossary.md for missing terms | Clarence | None — immediate |
| 4 | #1219 | Nova drafts Richo decision memo (3 items, 48h window) | Nova | Immediate |
| 5 | #1220 | Link ARCH-003 from README and 00-architecture.md | Clarence | Immediate |
| 6 | #1221 | Resolve tier boundary governance | Silas | Before Phase 2 |
| 7 | #1222 | Update Client Intake Questionnaire Section 2 | Clarence | None |
| 8 | #1223 | Restructure docs/00-architecture.md and 02-mcp-tools.md | Clarence | Gated on OC2+OC3 |
