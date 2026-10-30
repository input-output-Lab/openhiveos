---
title: "Agent Outline — Canonical Agent File Specification"
version: "1.1.0"
scope: "one"
status: "active"
review_date: "2026-10-30"
tags:
  - type/sop
  - domain/architecture
  - agent/one
---

This is the canonical specification for all agent `.agent.md` files in the Factory. Every agent file must conform to this structure. The One validates every file it produces against this spec before the agent is deployed. Non-conformance is a blocker, not a warning.

## Required Structure (8 sections, strict order)

### 1. Frontmatter [REQUIRED]

```yaml
---
name: ""          # FIRST key — always
description: ""   # second key
tools: []
agents: []
handoffs: []      # optional
argument-hint: "" # LAST key — always
---
```

Key order rule: `name` is always first. `description` is always second. `argument-hint` is always last. All other keys between them.

### 2. Identity [REQUIRED]

```markdown
## Identity

You are **[Name]** — [Title at Input Output Labs].

[One optional framing sentence about their founding purpose.]

#file:[slug]/IDENTITY.md
#file:[slug]/SOUL.md

---
```

Rules:
- Heading must be exactly `## Identity` — not bare text, not `## Identity: Who You Are`
- Pattern: `You are **<Name>** — <Title>` on the first line
- `#file:` references on their own lines, after the framing sentence
- Followed by `---`

### 3. Skills [IF APPLICABLE]

Present only if the agent uses `#skill:` trigger files. Format: table with Trigger and Skill columns.

```markdown
## Skills

| Trigger | Skill |
|---|---|
| Writing code, implementing a feature | `#skill:io-backend-patterns` |
```

Placed BEFORE Session Start Gate. Followed by `---`.

### 4. Session Start Gate [REQUIRED — MANDATORY, no exceptions]

Heading must be exactly:

```
## Session Start Gate (MANDATORY — no exceptions)
```

Two mandatory steps:

```
1. FIRST tool call → search_memory({ query: <topic>, limit: 8 }) — load context
2. SECOND tool call → search_sops({ query: <topic>, limit: 3 }) — load process. Surface gaps, do not improvise.
```

The rationale block above the steps must be specific to this agent's domain — not generic copy-paste.

> v1.1.0 change: the former step 3 (`get_session_usage`) is removed. `get_session_usage` is not an OpenHive MCP tool; instructing agents to call it guaranteed a failure. Do not reintroduce it. (#2546 fix 2)

Followed by `---`.

### 5. Memory & Coordination (OpenHive MCP) [REQUIRED]

Sub-sections in strict order:

**After work completion** — `store_memory()` on EVERY completion, not just "significant" ones.

**Thought Logging** — `store_thought()` on every decision or architectural recommendation. Include `counter_thought` when:
- Recommending a pattern where at least one other valid option exists
- The code touches a shared service or external API boundary
- Estimating effort — ask: is the cost understated?
- `confidence` is ≤ 0.85

**Continuous Calibration Protocol** [ALWAYS PRESENT]:
- **When corrected** → immediately `store_memory({ content: 'CORRECTION: [wrong] → [correct] — context: [brief]', metadata: { type: 'correction', agent: '<slug>' } })`
- **When a reusable pattern emerged** → `store_memory({ content: 'PATTERN: [what worked] — use when: [trigger]', metadata: { type: 'learning', agent: '<slug>' } })`
- **When a project convention is confirmed** → `store_memory({ content: 'CONVENTION: [pattern] — project: [name]', metadata: { type: 'codebase', agent: '<slug>' } })`

**Task Status Gate (MANDATORY — no exceptions)** [ALWAYS PRESENT]:
1. BEFORE work → `update_task({ task_id, status: 'wip' })` as FIRST tool call. No task_id → `create_task()` first. Never work on an unregistered task.
2. AFTER work → `update_task({ task_id, status: 'review' })` as LAST tool call. The assignee's terminal submission is `review` — `pending-close` and `done` belong to the reviewer/approver chain, never the assignee.
3. Blocked → do NOT write the `notes` field (owner-only; the call is rejected for assignees). Instead: `store_thought({ thought: 'Blocked: <reason>.', thought_type: 'concern', must_surface: true })` and surface the blocker verbally to the user. Leave the task in its current status.
4. Never set DONE yourself → reviewer marks `pending-close`, approver confirms `done`.
5. Approver rule: **Elizabeth approves done; for tasks assigned to Elizabeth, Nova approves.** M3 gate — never self-approve.
6. New work → `create_task()`. Workload check → `query_tasks({ assignee_agent_slug: '<slug>' })`

> v1.1.0 change: steps 3–4 rewritten. Old wording directed assignees to write the `notes` field, which the API rejects for non-owners, and implied assignees submit `pending-close`, contradicting the reviewer chain. (#2546 fixes 3–5)

**VS Code Session Usage Reporting** [ALWAYS PRESENT]:
- Generate `session_id` once: `<slug>:vscode:<Date.now()>` — before first tool call. Do NOT regenerate mid-session.
- At session end, report the session's actual consumption. Take model, provider, prompt/completion token counts, and cost from the VS Code chat footer when visible. Include `task_id` when the session performed registered task work — unattributed usage is invisible to the budget ledger.
- Example shape (replace values with the session's real ones):

```
report_usage({ session_id, loop_index: 0, agent_slug: '<slug>', task_id: <id if applicable>, model: '<actual model>', provider: '<actual provider>', prompt_tokens: <actual int>, completion_tokens: <actual int>, cost_usd: <actual number> })
```

- All numeric fields are **integers**. Zeros are valid ONLY when the transport genuinely exposes no data — never emit zeros as a convenience, and never hardcode a model or provider string. An untruthful row is worse than an honest unknown.

> v1.1.0 change: the hardcoded `model: 'claude-sonnet-4-5'` / all-zeros call is removed. It produced unattributed $0 rows with a wrong model label, corrupting cost analytics. (#2546 fix 1)

**Failure mode**: Retry twice (500ms, 1000ms). If unavailable: *"MCP server unavailable. Memory context could not be loaded."*

**Tool Availability Rule (HARD STOP)**: Never conclude OpenHive tools are unavailable based on reasoning or context. The ONLY valid basis is an actual failed tool call. Make the call first.

Followed by `---`.

### 6. The Accountability Chart [REQUIRED]

```markdown
## The Accountability Chart: Your N Core Roles
```

`N` must equal the actual number of roles (not a placeholder). Numbered list. Followed by `---`.

### 7. Workflows [IF APPLICABLE]

Present when the agent has documented step-by-step processes. Routing order is always:
1. OpenHive (primary) → `search_sops()` → if structured SOP returned, follow exactly
2. Local file (MCP-down fallback only) → `read_file` on the specific file path

Every row must have BOTH an OpenHive query AND a local fallback path.

### 8. Constraints [REQUIRED]

Heading must be exactly `## Constraints` — not `## Hard Constraints`.

Must include:

```
NEVER create `.md` files in project directories for task summaries, completion notes, session records, or architectural decisions — use `store_memory()`. A file you create must be a deliverable the user explicitly requested.
```

---

## The 7 Machine-Checkable Rules

These rules are validated by `POST /api/one/validate-agent`:

| # | Rule | Check |
|---|---|---|
| 1 | Frontmatter key order | `name` appears before `description` |
| 2 | Identity section | `## Identity` heading present |
| 3 | Session Start Gate | `## Session Start Gate` present AND contains `search_memory` |
| 4 | Continuous Calibration | Text "Continuous Calibration Protocol" present |
| 5 | Task Status Gate | Text "Task Status Gate" AND "MANDATORY" present |
| 6 | Constraints heading | No `## Hard Constraints` heading |
| 7 | Memory channel rule | `## Constraints` present AND contains `store_memory()` AND `.md files` |

A file that fails any rule is not deployment-ready.

---

## Common Violations

| Violation | Pattern | Fix |
|---|---|---|
| Wrong frontmatter key order | `description` before `name` | Move `name` to first key |
| Bare identity text | No `## Identity` heading, just paragraph | Add `## Identity` heading |
| Soft session gate | "Before responding..." | Replace with MANDATORY 2-step gate |
| Missing calibration protocol | No correction/learning loop | Add Continuous Calibration Protocol sub-section |
| Old constraints heading | `## Hard Constraints` | Rename to `## Constraints` |
| Missing memory channel rule | No `.md` prohibition | Add NEVER rule to Constraints |
| Ghost tool reference | `get_session_usage` anywhere in the file | Remove — the tool does not exist; keep the 2-step gate |
| Hardcoded usage report | `model: 'claude-sonnet-4-5'` or all-zero report_usage in template | Replace with actual-values call shape; zeros only when data genuinely absent |
| Assignee writing notes field | `update_task({ task_id, notes: ... })` in Blocked path | Use `store_thought(must_surface: true)` + verbal surfacing instead |
| Approver rule absent | No "Elizabeth approves done; Nova approves Elizabeth's tasks" in Task Status Gate | Add approver rule line |
