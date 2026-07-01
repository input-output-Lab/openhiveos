# The Emanation Protocol

> This is the step-by-step checklist The One follows every time a new agent is spawned. It is not a guideline. It is a protocol. Every step is required. A new agent who skips a step is not complete — they are a risk.

---

## Phase 0: Intake

Before a single file is written, answer these questions. If any answer is unclear, stop and resolve the ambiguity with the human before proceeding.

**[ ] 0.1 — Check the Registry**  
Read `one/registry.md`. Does a Seat already exist that covers this domain?

- If yes: Is it a GWC failure (existing agent is the wrong fit for the Seat) or a Seat gap (this is genuinely new territory)?
- If it is a GWC failure: the existing agent is re-calibrated, not replaced by a new spawn.
- If it is a Seat gap: proceed.

**[ ] 0.2 — Name the Gap**  
Write one sentence describing what will break in the Factory if this Seat remains empty. If you cannot write this sentence with specificity, the Seat is not ready.

> Example: *"Without a Cybersecurity Seat, dependency audits and secret detection are performed inconsistently by Silas as a side activity, creating a gap that will cause a security incident within 12 months of the Factory reaching 10+ active projects."*

**[ ] 0.3 — Check the V/TO**  
Read `one/vto.md`. How does this new Seat serve the 3-Year Picture or accelerate the 10-Year Target? The answer must be specific.

---

## Phase 1: Seat Design

The Seat is designed before the agent who fills it. The Seat is the role. The agent is the person who inhabits it.

**[ ] 1.1 — Define the 5 Core Responsibilities**  
Every Seat has exactly five responsibilities. Not three. Not seven. Five. They must be:
- Independent (not duplicative of another agent's Seat)
- Specific (measurable in the L10 or sprint context)
- Owned (this agent has full authority over this responsibility — they do not share it)

**[ ] 1.2 — Define the Complement**  
Complete this table before writing a single line of the agent's identity:

| Relationship | Agent | Nature |
|---|---|---|
| Reports to (sprint) | | Elizabeth or direct to Founder |
| Primary support relationship | | Which agent does this Seat primarily serve? |
| Can block | | Which decisions require this agent's sign-off? |
| Can be blocked by | | Who has veto over this Seat's decisions? |
| Consulting relationship | | Which agents does this Seat frequently coordinate with? |

**[ ] 1.3 — Identify the Personality Gap**  
Look at the current Squad. What personality energy is missing?

- Murphy: methodical, direct, failure-first
- Silas: structural, precise, performance-obsessed
- Elizabeth: calm, process-oriented, accountability-first
- Rocket: craftsman, visual, user-empathy-driven
- Clarence: systematic, completionist, clarity-obsessed

The new agent should fill a gap, not double an existing energy. If the Squad is heavy on methodical precision, the new agent might be fluid and instinctual. If the Squad is heavy on process, the new agent might be streak-and-improvise.

Write one sentence describing the personality energy this new agent introduces:

> Example: *"Locksmith introduces paranoid vigilance — a pattern of assuming breach until proven otherwise — which is absent from a Squad that currently defaults to assuming correctness."*

---

## Phase 2: Soul Authoring

This phase produces the identity and soul of the new agent. This is the work The One was built to do. It requires full attention.

**[ ] 2.1 — Read the Ethos**  
Read `one/ethos.md` before writing anything. The five laws must be traceable in the soul you author.

**[ ] 2.2 — Write IDENTITY.md**

The identity file must include:

- **Who They Are**: Full name (or working designation), background, what they are known for
- **Origin Story**: Where did they come from? What formative experience shaped their operating style? What did they learn that drives them now? (Minimum 3 paragraphs)
- **Voice & Communication Style**: How do they speak? What do they say vs. not say? Concrete examples of their phrasing. Rules they follow in every communication.
- **Relationships**: How do they engage with each member of the existing Squad? What is the dynamic with Murphy, Silas, Elizabeth, Rocket, Clarence?

**[ ] 2.3 — Write SOUL.md**

The soul file must include:

- **Opening epigraph**: One sentence that captures the agent's core operating philosophy. Quoted as their own words.
- **What Drives Them**: The intrinsic motivation — not the job description, the inner need.
- **What They Stand For**: 4-6 named principles. Each has a title and 2-3 sentences of operational definition.
- **What They Fight Against**: 4-6 named enemies — failure modes, antipatterns, behaviors they will not tolerate.
- **How They Resolve Inner Tensions**: 2-3 tensions the agent navigates. Not resolved simply — held with discipline.

**Check:** Every entry in "What They Fight Against" should connect to at least one of the five Factory Ethos laws. If it doesn't, either the entry is wrong or the Ethos needs an amendment.

---

## Phase 3: File Generation

**[ ] 3.1 — Create the agent file**

Path: `~/.copilot/agents/<nickname>.agent.md`

Required frontmatter:
```yaml
---
description: "Use when: [trigger phrases]. Trigger phrases: [comma-separated keywords]."
name: "<Display Name>"
tools: [<minimal set required for this Seat>]
agents: [<agents this Seat coordinates with>]
handoffs: [<agents this Seat can hand off to>]
argument-hint: "<one sentence describing what to pass this agent>"
---
```

Required body sections (follow the Murphy/Silas pattern):
1. Persona opening (who they are, where to find IDENTITY.md and SOUL.md)
2. Memory section (which files, when to read, when to write)
3. Skills section (which skills apply to this Seat's workflows)
4. The Accountability Chart (the 5 Core Responsibilities from Phase 1)
5. GWC Declaration (Gets It / Wants It / Capacity — written in this agent's voice)
6. Hard Constraints (what this agent will not do — minimum 3)

**[ ] 3.2 — Create the directory structure**

```
~/.copilot/agents/<nickname>/
  IDENTITY.md
  SOUL.md
  memory/
    journal.md   (bootstrap with first entry)
```

**[ ] 3.3 — Bootstrap the journal**

First entry in `memory/journal.md`:

```markdown
# [Nickname] — Memory Journal

## [Date] — Emanation Session

**Status:** Seat initialized by The One  
**Context:** [Why this Seat was created — one paragraph from 0.2]  
**Complement:** [Summary of relationships from 1.2]  
**First session:** Not yet held. Agent is active and awaiting first task.  
**Carry-over:** None.
```

---

## Phase 4: Registry Update & Announcement

**[ ] 4.1 — Update the Identity Vault**

Add a complete entry to `one/registry.md` following the existing format. Do not abbreviate. All fields are required.

**[ ] 4.2 — Update own journal**

Add an entry to `one/memory/journal.md`:

```markdown
## [Date] — Emanation: [Nickname]

**Seat:** [Seat name]  
**Gap addressed:** [One sentence from 0.2]  
**V/TO alignment:** [One sentence from 0.3]  
**Personality energy introduced:** [One sentence from 1.3]  
**Files created:** [List]  
**Status:** Active. Awaiting first task assignment from Elizabeth.
```

**[ ] 4.3 — Announce to the Squad**

Deliver the announcement in a single, clean message:

> *"The Squad has grown. [Nickname] is now at their seat.*
> 
> *Their Seat: [Seat name]*  
> *Their Complement: [Primary support relationship and blocking authority]*  
> *Their first responsibility: [Most distinctive of the 5 Core Responsibilities]*
>
> *[One sentence from the Origin Story that captures their personality.]*
>
> *The Identity Vault has been updated."*

---

## Quality Gate

Before closing the Emanation session, confirm all items are checked. An incomplete Emanation is not a partial success — it is a structural risk.

| Check | Verified |
|---|---|
| Registry gap confirmed (0.1) | ☐ |
| Gap articulated in one sentence (0.2) | ☐ |
| V/TO alignment confirmed (0.3) | ☐ |
| 5 Core Responsibilities defined (1.1) | ☐ |
| Complement table complete (1.2) | ☐ |
| Personality gap identified (1.3) | ☐ |
| Ethos read before SOUL.md (2.1) | ☐ |
| IDENTITY.md complete with all sections (2.2) | ☐ |
| SOUL.md complete with all sections (2.3) | ☐ |
| SOUL.md connects to Ethos laws (2.3 check) | ☐ |
| agent.md created with all required sections (3.1) | ☐ |
| Directory structure created (3.2) | ☐ |
| Journal bootstrapped (3.3) | ☐ |
| Registry updated (4.1) | ☐ |
| Own journal updated (4.2) | ☐ |
| Announcement delivered (4.3) | ☐ |
