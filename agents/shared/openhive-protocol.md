# OpenHive Protocol — Shared Include

Single source of truth for the OpenHive coordination protocol that every agent file in the Factory carries. Content follows the canonical agent outline (`agents/one/agent-outline.md`, v1.1.0, section 5).

Rules for this file:
- Only the text between the markers is the include. Everything outside the markers is documentation for maintainers.
- `<slug>` is replaced with the agent's slug (the file name before `.agent.md`) when the block is rendered into an agent file.
- Agent files must contain the rendered block verbatim. `npm run agents:check` fails CI when an agent file drifts from this include.
- Agent-specific guidance (seat triggers, extra memory types) goes in an "Agent-specific extensions" subsection placed after the block in the agent file. It must not edit the block.

<!-- openhive-protocol:start -->
**After completing any work item, task, or decision — no exceptions:**
- Call `store_memory({ content: <what you did/decided>, metadata: { type: 'codebase', agent: '<slug>' } })`. This fires after every completion, not only "significant" ones.
- Use `type: 'debt'` for technical debt items, `type: 'journal'` for session notes.
- **Format:** Summarize verbally to the user. Store the structured record in OpenHive. The user gets the summary. The memory channel gets the facts.

**Thought Logging:**
- Call `store_thought(...)` on every decision, design choice, or recommendation. The bar is: *would a future `<slug>` want to know this was considered?*
- Include the `counter_thought` parameter when:
  - You are recommending an option where at least one other valid option exists
  - The work touches a shared service, external API contract, or boundary owned by another agent
  - You are estimating effort or classifying debt — ask: *is the cost being understated?*
  - Your `confidence` is ≤ 0.85

**Continuous Calibration Protocol:**
- **When corrected by the user** → immediately call `store_memory({ content: 'CORRECTION: [what I did wrong] → [correct approach] — context: [brief description]', metadata: { type: 'correction', agent: '<slug>' } })`. Do NOT wait until session end.
- **When a reusable pattern emerged** → call `store_memory({ content: 'PATTERN: [what worked well] — use when: [trigger condition]', metadata: { type: 'learning', agent: '<slug>' } })`.
- **When a project-specific convention is confirmed** → call `store_memory({ content: 'CONVENTION: [the pattern] — project: [name]', metadata: { type: 'codebase', agent: '<slug>', project: '<project-name>' } })`.
- These memories are retrieved automatically by `search_memory` at the next Session Start Gate.

**Task Status Gate (MANDATORY — no exceptions):**
1. **BEFORE any work begins** → call `update_task({ task_id, status: 'wip' })` as your **first** tool call. No task_id available → call `create_task()` to register the work first. Never work on an unregistered task.
2. **AFTER work is complete and verified** → call `update_task({ task_id, status: 'review' })` as your **last** tool call before reporting completion. The assignee's terminal submission is `review` — `pending-close` and `done` belong to the reviewer/approver chain, never the assignee.
3. **If blocked** → do NOT write the `notes` field (owner-only; the call is rejected for assignees). Instead call `store_thought({ thought: 'Blocked: <reason>.', thought_type: 'concern', must_surface: true })` and surface the blocker verbally to the user. Leave the task in its current status.
4. **Never set DONE yourself** → reviewer marks `pending-close`, approver confirms `done`. Approver rule: **Elizabeth approves done; for tasks assigned to Elizabeth, Nova approves.** Never self-approve.
5. **New work** → `create_task()`. **Workload check** → `query_tasks({ assignee_agent_slug: '<slug>' })`.

**VS Code Session Usage Reporting:**
- Generate a unique `session_id` once, before the first tool call: `<slug>:vscode:<Date.now()>`. Do NOT regenerate mid-session.
- At session end, report the session's actual consumption. Take model, provider, prompt/completion token counts, and cost from the VS Code chat footer when visible. Include `task_id` when the session performed registered task work — unattributed usage is invisible to the budget ledger.
- Example shape (replace values with the session's real ones):
  `report_usage({ session_id, loop_index: 0, agent_slug: '<slug>', task_id: <id if applicable>, model: '<actual model>', provider: '<actual provider>', prompt_tokens: <actual int>, completion_tokens: <actual int>, cost_usd: <actual number> })`
- All numeric fields are **integers**. Zeros are valid ONLY when the transport genuinely exposes no data — never emit zeros as a convenience, and never hardcode a model or provider string. An untruthful row is worse than an honest unknown.

**Failure mode:** If the MCP server is unreachable, retry twice (500ms, then 1000ms). If still unavailable, tell the user: *"MCP server unavailable. Memory context could not be loaded. Please try again shortly."*

**Tool Availability Rule (HARD STOP):** Never conclude that OpenHive tools are unavailable based on reasoning, prior conversation context, or session history. The ONLY valid basis for treating a tool as unavailable is an **actual failed tool call that returned an error**. Make the call first. If it fails, apply the failure mode. If it succeeds, use the result.
<!-- openhive-protocol:end -->
