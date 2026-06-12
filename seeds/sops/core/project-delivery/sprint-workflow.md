---
title: "SOP: Sprint Workflow"
owner: "Elizabeth"
team: "Project Delivery"
status: "Active"
version: "1.2"
last-updated: 2026-06-12
review-cycle: "Quarterly"
signatories:
  - name: "Richo"
    role: "Integrator"
    signed: 2026-04-20
  - name: "Elizabeth"
    role: "Owner"
    signed: 2026-04-20
tags:
  - sop
  - sprint
  - project-delivery
---

# SOP: Sprint Workflow

> [!info] Ownership
> **Owner:** Elizabeth · **Team:** Project Delivery · **Last Updated:** 2026-06-12 · **Next Review:** 2026-09-12

---

## Purpose
Define the complete lifecycle of a sprint at IO Labs — from task creation through closure — so that every team member knows exactly what to do, who owns each gate, and what "done" means.

---

## Scope

**Included:** All sprint activity from backlog grooming through retrospective close. Covers task status rules, dual-system sync protocol, ceremonies, and gate ownership.

**Excluded:** Client onboarding and project intake (see [[operations-client-projects]]). GitHub issue creation and labelling (see [[github-issue-types]]). Component documentation requirements (see [[component-documentation-standard]]).

---

## Roles & Responsibilities

| Role | Responsibility |
|---|---|
| **Elizabeth** (PM) | Runs all ceremonies, owns sprint planning and scope guard, is the sole person who may close a task (`DONE` / `Closed`) |
| **Assignee** (developer or agent) | Self-starts work, moves task to `WIP` / `In Progress`, moves to `REVIEW` / `In Review` when done, owns rework |
| **Validator** (Elizabeth or peer designated by Elizabeth) | Reviews work against validation criteria, moves to `REWORK` / `Rework` on failure with written feedback |
| **Murphy** | Backend technical authority for tool infrastructure and OpenSquad MCP tooling |
| **Clarence** | Documentation gate — no task that touches a doc deliverable closes without a documentation artifact |

---

## Prerequisites

- ClickUp workspace active with a Backlog list and a Sprint Board folder for the project.
- OpenSquad MCP server running and accessible.
- Every task has the required creation fields before it enters a sprint (see [Definition of Done — At Creation](#definition-of-done)).

> [!info] Backlog vs Sprint List — Status Model
> The **Backlog list** uses ClickUp's default statuses. Tasks sit in `to do` until Sprint Planning pulls them into a sprint. No custom status setup is needed on the Backlog list.
>
> The five sprint statuses (`Open`, `In Progress`, `In Review`, `Rework`, `Closed`) are configured on **Sprint lists only** — one-time, per sprint list, at Sprint Planning. See Phase 1.

> [!warning] One-Time Setup Per Sprint List
> Before the first sprint begins, Elizabeth must manually configure the five sprint statuses on each new sprint list in the ClickUp UI. This is a per-sprint-list action, not a per-project action. It must be done during Sprint Planning — before tasks are moved from the Backlog.

---

## The Status Model

These five statuses are the only valid states a task may be in. No ad hoc statuses. No "almost done." No "blocked" column that lives outside this model — blocked tasks stay in their current status with a comment explaining the blocker.

| Status | OpenSquad | ClickUp | Meaning | Gate Owner |
|---|---|---|---|---|
| Open | `todo` | `Open` | In backlog, not started | Elizabeth assigns to sprint |
| In Progress | `wip` | `In Progress` | Actively being worked | Assignee self-starts |
| Pending Close | `pending-close` | `In Review` | Work complete — queued for Elizabeth approval | **Assignee terminal step.** Elizabeth approves or returns to Rework |
| Rework | `rework` | `Rework` | Failed approval, returned with specific feedback | Elizabeth moves; assignee owns resolution |
| Closed | `done` | `Closed` | Approved, DoD confirmed | **Elizabeth only — enforced by M3 gate (ARCH-023)** |

> [!warning] Elizabeth's Close-Only Rule — Code Enforced
> No developer, agent, or peer reviewer closes their own task. Ever. Moving a task to `done` / `Closed` is Elizabeth's exclusive action. **This restriction is enforced at the code level by the M3 gate in `src/utilities/update-task.ts` (see [[ARCH-023-pending-close-task-state-machine|ARCH-023]]). Any `done` write from an assignee-path token returns a `403` — the SOP restriction and the code are aligned.** If Elizabeth is unavailable, tasks accumulate in `pending-close` until she returns — they do not self-close. This rule has no exceptions.

---

## Sprint Lifecycle

A sprint has five phases. Each phase has defined entry criteria, a named owner, and specific exit criteria that must be met before the next phase begins.

---

### Phase 1 — Sprint Planning

**When:** Saturday before the sprint start date.
**Run by:** Elizabeth.
**Duration:** Up to 90 minutes.

#### Entry Criteria
- Backlog is groomed: all candidate tasks have a title, owner, and draft validation criteria.
- Elizabeth has confirmed team capacity for the sprint window.

#### Steps

1. **Set the sprint window** — Confirm start and end dates. The sprint list name format is `Sprint N — YYYY-MM-DD` where the date is the sprint **end date** (e.g., `Sprint 3 — 2026-05-09`).

2. **Create the sprint list** — Create the sprint list in the ClickUp UI manually.

   > [!warning] Pending Infrastructure
   > The `create_sprint_list` MCP tool is not yet built. Sprint lists must be created manually in the ClickUp UI until this tool ships. Murphy: this is a backlog item. The tool should accept `sprint_number`, `project_id`, and `end_date` and return a `list_id`.

3. **Configure sprint list statuses** — Confirm the five statuses (`Open`, `In Progress`, `In Review`, `Rework`, `Closed`) are active on the new list in the ClickUp UI. Do this before the ceremony ends.

4. **Pull tasks from backlog into sprint** — For each task selected for the sprint, Elizabeth moves it from the Backlog list to the sprint list in ClickUp and confirms the OpenSquad status is `TODO`.

5. **Assign each task** — Every task exiting Sprint Planning must have a named assignee. No unassigned tasks enter an active sprint.

6. **Set due dates** — Every task must have a due date.

   > [!warning] Pending Infrastructure
   > The `due_date` parameter is not yet implemented on `create_backlog_task`. Until it ships, due dates must be set manually in the ClickUp UI after task creation. Murphy: this is a backlog item.

7. **Confirm validation criteria** — Read the validation criteria on each task aloud. If a task has no clear, testable criteria, it does not enter the sprint. Rewrite or defer.

8. **Publish the sprint** — Announce the sprint start in the team channel with the sprint list name, window dates, and task count.

#### Exit Criteria
- Sprint list exists in ClickUp with correct statuses.
- All sprint tasks have: title, assignee, due date, validation criteria.
- All tasks are in `TODO` (OpenSquad) / `Open` (ClickUp).
- Sprint announced to team.

---

### Phase 2 — Active Sprint

**When:** Sprint start date through sprint end date.
**Run by:** Assignees (daily work), Elizabeth (oversight and scope guard).

#### Entry Criteria
- Sprint Planning complete. All tasks in `Open` status.

#### Steps

1. **Self-start a task** — When an assignee begins work on a task, they immediately update both systems. Do not work on a task that is still showing `Open` / `TODO` — update it first.

   **Required tool calls (must be made together):**
   ```
   # OpenSquad
   update_task({ id: <task_id>, status: "WIP" })

   # ClickUp
   update_backlog_task({ task_id: "<clickup_task_id>", status: "In Progress" })
   ```

2. **Work the task** — Complete the work. When done, validate against the task's own acceptance criteria before moving to the next step.

3. **Submit for close** — When the assignee believes the work is complete and meets the validation criteria, they move the task to `pending-close` / `In Review`. They must add a comment to the task confirming what was completed and where to find the output (link, file path, PR URL, or doc location).

   `pending-close` is the **assignee's terminal step**. It signals to Elizabeth that the work is ready for her approval. Elizabeth reviews from the `pending-close` queue and either approves (→ `done`) or returns (→ `rework`).

   **Required tool calls (must be made together):**
   ```
   # OpenSquad
   update_task({ id: <task_id>, status: "pending-close" })

   # ClickUp
   update_backlog_task({ task_id: "<clickup_task_id>", status: "In Review" })
   ```

   > [!warning] Common Mistake
   > Moving a task to `pending-close` without leaving a comment. Elizabeth cannot confirm what was delivered without knowing where to look. A task with no completion comment in `pending-close` will be returned to `rework` immediately.

4. **Apply the scope guard** — If a new request arrives during the sprint that was not in the sprint plan, do not touch the board. Bring it to Elizabeth. See [Scope Guard](#scope-guard).

#### Exit Criteria
- All tasks are in `pending-close` or have been returned to `rework`.
- No tasks remain in `wip`.

---

### Phase 3 — Validation Gate

**When:** Continuous during the sprint. Elizabeth validates tasks as they arrive in `REVIEW`.
**Run by:** Elizabeth (primary validator). Elizabeth may designate a peer reviewer for specific tasks — but she remains the final closer.

#### Entry Criteria
- Task is in `pending-close` (OpenSquad) / `In Review` (ClickUp).
- Task has a completion comment from the assignee.

#### Steps

1. **Read the validation criteria** — Locate the task's validation criteria. These were set at sprint planning. If they are missing or untestable, the task goes to `REWORK` with a note that criteria must be rewritten.

2. **Verify the output** — Follow the link or instructions in the assignee's completion comment. Check each criterion one by one.

3. **On pass — close the task:**

   **Required tool calls (Elizabeth only — must be made together):**
   ```
   # OpenSquad
   update_task({ id: <task_id>, status: "DONE" })

   # ClickUp
   update_backlog_task({ task_id: "<clickup_task_id>", status: "Closed" })
   ```

4. **On fail — return to rework:**

   The validator moves the task to `REWORK` and must leave a comment that includes: which criteria failed, exactly what is wrong, and what the assignee must produce to pass on the next submission.

   **Required tool calls (must be made together):**
   ```
   # OpenSquad
   update_task({ id: <task_id>, status: "REWORK" })

   # ClickUp
   update_backlog_task({ task_id: "<clickup_task_id>", status: "Rework" })
   ```

5. **Assignee resolves rework** — The assignee addresses every point in the validator's feedback comment, then re-submits by moving back to `pending-close` / `In Review` with a new completion comment noting what was changed.

   **Required tool calls (must be made together):**
   ```
   # OpenSquad
   update_task({ id: <task_id>, status: "pending-close" })

   # ClickUp
   update_backlog_task({ task_id: "<clickup_task_id>", status: "In Review" })
   ```

> [!warning] Common Mistake
> A task cycling through `rework` → `pending-close` → `rework` more than twice without resolution indicates unclear validation criteria, not just poor execution. If a task has been reworked twice and still fails, Elizabeth calls a 15-minute sync with the assignee to align on what “done” actually means before the third submission.

#### Exit Criteria
- Task is `DONE` (OpenSquad) and `Closed` (ClickUp).
- Both systems match. No task may be `DONE` in one system and open in the other.

---

### Phase 4 — Sprint Review

**When:** Friday, last day of the sprint.
**Run by:** Elizabeth.
**Attendees:** Full team (Richo, Murphy, Rocket, Clarence, Silas, Elizabeth).
**Duration:** 30–45 minutes.

#### Steps

1. **Pull the sprint summary** — Before the meeting, Elizabeth queries all tasks in the sprint and prepares a count of: Closed, still in Review, in Rework, and not started.

2. **Demo completed work** — Each assignee demos their closed tasks. Focus on the output, not the process.

3. **Address open items** — For any task not closed by Review: confirm whether it carries over to the next sprint or is descoped. Document the decision as a comment on the task.

4. **Record the outcome** — Elizabeth posts a sprint summary to the team channel: tasks closed, tasks carried over, tasks descoped, and any scope guard decisions made during the sprint.

#### Exit Criteria
- All tasks have a final status decision (Closed, Carried Over, or Descoped).
- Sprint summary posted to team channel.
- No task remains ambiguous.

---

### Phase 5 — Retrospective & Sprint Close

**When:** Immediately after Sprint Review, same day.
**Run by:** Elizabeth.
**Duration:** 30 minutes maximum.

#### Steps

1. **Three questions, timed:**
   - *What worked well this sprint?* (5 minutes)
   - *What did not work?* (10 minutes)
   - *What is the one change we make next sprint?* (10 minutes)

2. **Identify the one change** — The team agrees on a single process improvement for the next sprint. Elizabeth owns documenting it. If it requires an SOP update, Clarence is assigned the task.

3. **Archive the sprint** — Elizabeth confirms the sprint list in ClickUp is fully closed (no tasks in any open status) before ending the session.

4. **Open the next backlog** — If the next sprint window is within 72 hours, Elizabeth moves any carried-over tasks to the new sprint list.

#### Exit Criteria
- One improvement identified and assigned.
- Sprint list fully closed in ClickUp.
- No tasks in any open status in either system for this sprint.

---

## Definition of Done

Every task has two DoD checkpoints: one at creation, one at close.

### At Creation (Sprint Planning Gate)

A task may not enter an active sprint without all of the following:

- [ ] **Title** — Clear, action-oriented, specific. Not "Fix thing." — "Fix CORS wildcard in production on `insoma_api`."
- [ ] **Owner** — A single named assignee. Not a team. Not TBD.
- [ ] **Validation criteria** — At least one testable, binary criterion. The validator must be able to say definitively yes or no. "Looks good" is not a criterion.
- [ ] **Due date** — A calendar date within the sprint window.

### At Close (Validation Gate)

A task may not move to `DONE` / `Closed` without all of the following:

- [ ] Every validation criterion has been checked and passed.
- [ ] The assignee has left a completion comment with output location (link, file path, PR URL, or doc reference).
- [ ] Both OpenSquad (`DONE`) and ClickUp (`Closed`) are updated — not just one.
- [ ] If the task touched a documentation artifact: Clarence has confirmed the doc exists, is findable, and meets the Clarence Standard.
- [ ] Elizabeth (and only Elizabeth) executed the close.

---

## Dual-System Sync Protocol

IO Labs operates two task systems simultaneously. They must always match.

| System | Role | Audience | Tool |
|---|---|---|---|
| **OpenSquad MCP** | Internal source of truth | Agents and internal team | `update_task` |
| **ClickUp** | Client-visible project tracking | Client and external stakeholders | `update_backlog_task` |

**The rule is simple:** Every status change requires two tool calls — one to each system — made in the same action. There is no valid reason to update one and not the other.

### Transition Reference Table

| Transition | OpenSquad call | ClickUp call | Who |
|---|---|---|---|
| Start work | `update_task({ id: <int>, status: "wip" })` | `update_backlog_task({ task_id: "<str>", status: "In Progress" })` | Assignee |
| Submit for close | `update_task({ id: <int>, status: "pending-close" })` | `update_backlog_task({ task_id: "<str>", status: "In Review" })` | Assignee |
| Fail approval | `update_task({ id: <int>, status: "rework" })` | `update_backlog_task({ task_id: "<str>", status: "Rework" })` | Elizabeth |
| Resubmit after rework | `update_task({ id: <int>, status: "pending-close" })` | `update_backlog_task({ task_id: "<str>", status: "In Review" })` | Assignee |
| Close (approve) | `update_task({ id: <int>, status: "done" })` | `update_backlog_task({ task_id: "<str>", status: "Closed" })` | **Elizabeth only — M3 gate** |

> [!warning] System Drift
> If you discover a task that is `DONE` in OpenSquad but not `Closed` in ClickUp (or vice versa), this is a sync error. Flag it to Elizabeth immediately. Do not attempt to self-correct a task you do not own. Elizabeth audits for drift during Sprint Review.

---

## Sprint Ceremonies

### Sprint Planning
- **When:** Saturday before sprint start
- **Run by:** Elizabeth
- **Output:** Sprint list created, all tasks assigned with due dates and validation criteria, sprint announced to team

### L10 / Weekly Standup
- **When:** Weekly, Tuesday preferred
- **Run by:** Elizabeth
- **Format:** Issues List review, sprint task status pass, blockers surface — resolved or escalated same day. Any task in `pending-close` for more than 3 sprint-days automatically surfaces as an IDS item for the current L10 (see [Queue Age Policy](#queue-age-policy)).
- **Output:** Blockers assigned an owner and a resolution date before the meeting ends

### Sprint Review
- **When:** Friday, last day of sprint
- **Run by:** Elizabeth
- **Output:** Sprint summary (closed / carried over / descoped counts) posted to team channel

### Retrospective
- **When:** Immediately after Sprint Review, same day
- **Run by:** Elizabeth
- **Output:** One process improvement identified, assigned, and logged

---

## Sprint Container

The **Backlog list** is a parking lot. Tasks live here until Sprint Planning selects them. No custom statuses, no lifecycle. ClickUp default statuses are sufficient — no setup required.

At Sprint Planning, selected tasks move from the Backlog into a named **Sprint list** inside the Sprint Board folder. The Sprint list is where the 5-status lifecycle runs. Each sprint has its own list.

### Sprint List Naming Convention

```
Sprint N — YYYY-MM-DD
```

Where `N` is the sprint number (sequential per project) and `YYYY-MM-DD` is the sprint **end date**.

**Example:** `Sprint 3 — 2026-05-09`

> [!warning] Pending Infrastructure — `create_sprint_list`
> The MCP tool `create_sprint_list` does not yet exist. Until it is built, Elizabeth creates sprint lists manually in the ClickUp UI during Sprint Planning.
>
> **Murphy — required tool spec:**
> - Tool name: `create_sprint_list`
   > - Parameters: `sprint_board_folder_id` (string — the folder ID returned by `create_project`, not the space ID), `sprint_number` (integer), `end_date` (ISO 8601 date string)
   > - Returns: `list_id` (string), `list_name` (string), `clickup_url` (string)
   > - Must auto-configure the five sprint statuses on the new list via the ClickUp `statuses` array on list creation (`POST /folder/{folder_id}/list`)
   > - When this tool ships, Phase 1 Step 3 (manual status configuration in the ClickUp UI) is no longer required
---

## Scope Guard

Any request to add, change, or remove scope during an active sprint must go through Elizabeth's scope guard before touching the board.

### The Scope Guard Process

1. **New request arrives** — From any source (client, Richo, team member, or agent).
2. **Do not act on it** — The assignee does not begin work, create a task, or modify any existing task.
3. **Bring it to Elizabeth** — State: what the request is, who requested it, and why it cannot wait for the next sprint.
4. **Elizabeth decides** — One of three outcomes:
   - **Defer:** Added to the backlog for next sprint planning.
   - **Swap:** An existing sprint task of equal size is descoped to make room. The descoped task is documented as such with a comment.
   - **Emergency:** In rare cases, Elizabeth authorizes adding scope with no swap. This requires Richo's acknowledgement that the sprint velocity is impacted.
5. **If approved, Elizabeth creates or modifies the task** — Not the requestor.

> [!warning] Common Mistake
> Developers starting "quick" work that was not in the sprint plan without running the scope guard. There is no such thing as a small change that does not need tracking. If it takes time, it takes capacity from committed sprint work. Run the scope guard — always.

---

## Queue Age Policy

Tasks that sit in `pending-close` without Elizabeth's approval create invisible completion risk. This policy ensures the queue does not age silently.

**Rule:** Any task that has been in `pending-close` for more than **3 sprint-days** without a `done` or `rework` response from Elizabeth is automatically surfaced as an IDS item at the next L10.

**Definition of a sprint-day:** A calendar day within the active sprint window (not counting days outside the sprint).

**IDS item format:** *"Task #NNN — `[task title]` has been in pending-close for N days. Decision needed: approve, rework, or defer."*

**Outcome options at L10:**
1. **Approve now** — Elizabeth closes the task in the meeting.
2. **Rework** — Elizabeth moves to `rework` with written feedback before the meeting ends.
3. **Defer** — If the task is blocked on external input (not assignee-owned), Elizabeth adds a blocker comment and resets the 3-day clock.

> [!warning] Why This Matters
> A stale `pending-close` queue is a sprint close blocker. Tasks cannot be counted as delivered until they are `done`. The IDS process ensures Elizabeth's approval queue is actively managed, not passively accumulated.

---

## Acceptance Criteria / Definition of Done (for this SOP)

- [ ] Every team member can describe the five sprint statuses without looking them up.
- [ ] No task is ever closed by anyone other than Elizabeth. (Code-enforced by the M3 gate — see [[ARCH-023-pending-close-task-state-machine|ARCH-023]].)
- [ ] Both OpenSquad and ClickUp are updated simultaneously on every status change.
- [ ] No task enters a sprint without a title, owner, validation criteria, and due date.
- [ ] Sprint Review happens on the last day of every sprint — not the following week.
- [ ] Every sprint closes with a retrospective and one named improvement.

---

## Tools Used

| Tool | Purpose |
|---|---|
| `update_task` (OpenSquad MCP) | Update task status in the internal tracking system |
| `update_backlog_task` (ClickUp MCP) | Update task status in the client-visible ClickUp board |
| `create_backlog_task` (ClickUp MCP) | Create new tasks in the Backlog list |
| `query_tasks` (OpenSquad MCP) | Pull sprint task list for Review prep |
| ClickUp UI | Sprint list creation (manual — see pending infrastructure notes) |

---

## Related SOPs

- [[operations-client-projects]]
- [[github-issue-types]]
- [[component-documentation-standard]]

## Related Architecture Decisions

- [[ARCH-023-pending-close-task-state-machine|ARCH-023 — pending-close Status in Task State Machine]] — Formalises the M3 gate that code-enforces the Elizabeth-only close rule and introduces `pending-close` as the assignee terminal step.

---

## Known Exceptions

**Documentation tasks (Clarence-owned):** Tasks assigned to Clarence do not have a PR URL. The `github_pr_url` validation rule does not apply to documentation tasks. Elizabeth closes documentation tasks when Clarence confirms the artifact exists and is findable — not when a PR is merged.

---

## Decisions Requiring Elizabeth's Ratification

The following decisions were made during drafting and need Elizabeth's explicit sign-off before this SOP moves from Draft to Active:

1. **Peer validator designation** — This SOP allows Elizabeth to designate a peer reviewer for specific tasks. The SOP assumes Elizabeth retains final close authority regardless. Confirm this is the intended model.
2. **Rework cycle limit** — The SOP specifies a sync is called after two failed rework cycles. Confirm the number (two) is correct, or adjust.
3. **Retrospective format** — The three-question, 30-minute format is specified. Confirm this matches IO Labs' current L10-adjacent retrospective format.
4. **Scope guard emergency path** — The SOP documents a Richo acknowledgement path for emergency scope additions. Confirm Richo's role here or adjust to Integrator-level (Elizabeth alone).

---

## Open Items for Murphy

Before this SOP can move from Draft to Active, the following infrastructure items must be resolved:

1. **`create_sprint_list` tool** — Must be built before sprint list creation can be included in the ceremony steps as a tool call rather than a manual UI action. See the pending infrastructure callout in [Sprint Container](#sprint-container).
2. **`due_date` on `create_backlog_task`** — Must be added before due date assignment can be part of the automated task creation flow. See the pending infrastructure callout in [Phase 1 — Sprint Planning](#phase-1--sprint-planning).
3. **Status parameter on `update_backlog_task`** — Confirm the exact parameter name and accepted values for status updates in the ClickUp MCP tool. This SOP assumes `status` as the parameter name and the exact string values `"In Progress"`, `"In Review"`, `"Rework"`, `"Closed"`.

---

## Version History

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-04-19 | Clarence | Initial draft |
| 1.1 | 2026-04-20 | Clarence | Ratification — Elizabeth and Richo sign-off; peer validator model, rework cycle limit, retrospective format, and scope guard emergency path confirmed |
| 1.2 | 2026-06-12 | Clarence | Task #1751 — `pending-close` introduced as assignee terminal step (ARCH-023); M3 gate code enforcement documented; queue age policy (3 sprint-days) added; ARCH-023 referenced |
