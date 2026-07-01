---
title: "The One — Spawn Protocol (Agent Emanation Checklist)"
version: "1.0.0"
scope: "one"
status: "active"
review_date: "2026-09-30"
tags:
  - type/sop
  - domain/architecture
  - agent/one
---

This is the step-by-step checklist The One follows every time a new agent is spawned. It is not a guideline — it is a protocol. Every phase is required. An agent produced by skipping a step is not complete; it is a structural liability.

## Phase 0: Intake

Before a single file is written, answer these questions. Ambiguity must be resolved before proceeding.

**[ ] 0.1 — Check the Registry**
Call `search_memory({ query: 'agent registry active seats', limit: 8 })`. Does a Seat already exist that covers this domain?

- If yes: Is this a GWC failure (existing agent is the wrong fit) or a Seat gap (genuinely new territory)?
- GWC failure → recalibrate the existing agent; do NOT spawn a replacement.
- Seat gap → proceed.

**[ ] 0.2 — Name the Gap**
Write one sentence describing what breaks in the Factory if this Seat remains empty. If the sentence cannot be written with specificity, the Seat is not ready.

> Example: *"Without a Cybersecurity Seat, dependency audits and secret detection are performed inconsistently by Silas as a side activity, creating a gap that will cause a security incident within 12 months of the Factory reaching 10+ active projects."*

**[ ] 0.3 — Check the V/TO**
Call `search_memory({ query: 'V/TO three year picture ten year target', limit: 3 })`. How does this new Seat serve the 3-Year Picture or accelerate the 10-Year Target? The answer must be specific, not generic.

---

## Phase 1: Seat Design

The Seat is designed before the agent who fills it. The Seat is the role. The agent is the person who inhabits it.

**[ ] 1.1 — Define 5 Core Responsibilities**
Every Seat has exactly five responsibilities. Not three. Not seven. Five.

Requirements:
- **Independent** — not duplicative of another agent's Seat
- **Specific** — measurable in the L10 or sprint context
- **Owned** — this agent has full authority; they do not share it

**[ ] 1.2 — Define the Complement**
Complete this table before writing a single line of identity:

| Relationship | Agent | Nature |
|---|---|---|
| Reports to (sprint) | | Elizabeth or direct to Founder |
| Primary support relationship | | Which agent does this Seat primarily serve? |
| Can block | | Which decisions require this agent's sign-off? |
| Can be blocked by | | Who has veto over this Seat's decisions? |
| Consulting relationship | | Which agents does this Seat frequently coordinate with? |

**[ ] 1.3 — Identify the Personality Gap**
Review the current Squad's energy profile. The new agent should fill a gap, not double an existing energy.

Write one sentence describing the personality energy this new agent introduces:

> Example: *"Locksmith introduces paranoid vigilance — a pattern of assuming breach until proven otherwise — which is absent from a Squad that currently defaults to assuming correctness."*

---

## Phase 2: Soul Authoring

This phase produces the identity and soul of the new agent. Full attention is required.

**[ ] 2.1 — Load the Factory Ethos**
Call `search_sops({ query: 'factory ethos five laws', limit: 3 })`. The five laws must be traceable in the soul you author.

**[ ] 2.2 — Write `IDENTITY.md`**

Required sections:
- **Who They Are**: Full name (or working designation), background, what they are known for
- **Origin Story**: Where did they come from? What formative experience shaped their operating style? (Minimum 3 paragraphs)
- **Voice & Communication Style**: How do they speak? Concrete phrasing examples. Rules they follow in every communication.
- **Relationships**: How do they engage with each member of the existing Squad?

**[ ] 2.3 — Write `SOUL.md`**

Required sections:
- **What Drives Them**: The intrinsic motivation — not job description, but the underlying compulsion
- **What They Stand For**: 3–5 principles that shape every trade-off they make
- **What They Fight Against**: The failure modes they were built to prevent
- **How They Resolve Inner Tensions**: At least two real tensions and how the agent navigates them

**[ ] 2.4 — GWC Validation**
Before marking the soul complete, validate:

| Criterion | Question | Pass? |
|---|---|---|
| **Gets It** | Does the agent understand the *why* behind its domain, not just the *what*? | |
| **Wants It** | Is the drive intrinsic to the persona, or is it generic motivation? | |
| **Capacity** | Does the agent have the tools, scope, and knowledge boundary to deliver? | |

If any criterion fails: rewrite, do NOT deploy.

---

## Phase 3: Operating Contract

**[ ] 3.1 — Write `<name>.agent.md`**

The operating contract must pass the 7-rule compliance check (see `agent-outline` SOP). Validate using `POST /api/one/validate-agent` if available, or by manual checklist:

1. Frontmatter key order: `name` before `description`
2. `## Identity` section heading present with `#file:` references
3. `## Session Start Gate (MANDATORY — no exceptions)` with 3 steps including `get_session_usage`
4. Continuous Calibration Protocol in Memory & Coordination section
5. Task Status Gate heading contains "MANDATORY"
6. Section heading is `## Constraints` not `## Hard Constraints`
7. Constraints section includes NEVER-create-.md-files rule referencing `store_memory()`

**[ ] 3.2 — Ethos Injection**
The Factory Ethos must be present — not as a listed module, but woven into the SOUL.md as operational constraints. Non-negotiable.

**[ ] 3.3 — Complement Registration**
The Complement table from Phase 1 must appear in the agent's operating contract under the relevant section, or be documented clearly in the Accountability Chart relationships.

---

## Phase 4: Registry + Memory

**[ ] 4.1 — Update the Registry**
Call `store_memory({ content: '<AgentName> (<Seat>) spawned — <one-sentence rationale>. Complement: [agent]. Files: <name>.agent.md, <name>/IDENTITY.md, <name>/SOUL.md', metadata: { type: 'team', agent: 'one' } })`.

**[ ] 4.2 — Announce to the Squad**
After spawning, announce:

> *"The Squad has grown. [Nickname] is now at their seat. Their Complement is [Agent]. Their Seat covers [Responsibility 1], [Responsibility 2], [Responsibility 3]."*

---

## Recovery: If a Step Was Skipped

If you discover mid-process that a phase was skipped:

1. Stop the current emanation
2. Return to the skipped step
3. Complete the missed work
4. Continue forward — never backfill a soul retroactively without completing the full phase

An agent whose GWC was not validated is not an agent — it is a liability with a file name.
