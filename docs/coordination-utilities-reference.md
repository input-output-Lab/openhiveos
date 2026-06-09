---
title: "OpenHiveOS — Coordination Utilities Tool Reference"
date: 2026-05-20
updated: 2026-05-20
author: "Clarence"
owner: "Clarence"
status: active
tags:
  - type/guide
  - project/openhiveos
  - domain/architecture
  - audience/technical
review_date: 2026-08-20
---

# OpenHiveOS — Coordination Utilities Tool Reference

**What this is for:** A complete reference for the eight Coordination Utility MCP tools shipped in Sprint 3. For every tool: what it does, what inputs it accepts, what it returns, and what errors it can produce.

**Audience:** Any agent using the OpenHiveOS MCP server. Also useful for operators onboarding a new Squad Instance.

**Schema authority:** [ARCH-010 — Coordination Utilities Schema](ARCH-010-coordination-utilities-schema.md)  
**Source files:** `src/utilities/` and `src/db/queries/projects.ts`, `src/db/queries/tasks.ts`  
**Last updated:** 2026-05-20 (Sprint 3 ship)

---

## Authorization model

Every write tool in this tier enforces ownership automatically. The server reads your identity from your bearer token and injects it as the `owner_agent_slug`. You cannot write to a project or task you do not own — the query returns zero rows and the tool returns `not_found_or_unauthorized`. You cannot tell the difference between "this does not exist" and "this exists but you do not own it." That is intentional.

Read tools (`query_projects`, `query_tasks`) are scoped differently — see each tool's authorization note.

---

## Project Tools

### `create_project`

Creates a new project. The calling agent becomes the owner.

**Inputs**

| Field | Type | Required | Limits | Notes |
|---|---|---|---|---|
| `slug` | string | ✅ | 2–80 chars | Lowercase alphanumeric and hyphens only. No leading or trailing hyphens. Must be unique across the Squad Instance. Example: `openhiveos`, `client-abc-sprint-1` |
| `name` | string | ✅ | 1–200 chars | Human-readable project name |
| `description` | string | — | max 2 000 chars | Optional description |
| `business_value` | integer | — | 1, 3, or 5 | Required for Matrix prioritization |
| `strategic_fit` | integer | — | 1, 3, or 5 | Required for Matrix prioritization |
| `effort` | integer | — | 1, 3, or 5 | Required for Matrix prioritization |
| `risk_index` | integer | — | 1–5 | Technical risk (default 1) |

You do not supply `status` on creation. New projects always start as `active`.  
You do not supply `owner_agent_slug`. The server injects this from your bearer token.

**Success response**

```json
{
  "id": 42,
  "slug": "openhiveos",
  "name": "OpenHiveOS",
  "description": null,
  "status": "active",
  "owner_agent_slug": "murphy",
  "business_value": 5,
  "strategic_fit": 5,
  "effort": 1,
  "risk_index": 1,
  "created_at": "2026-05-20T10:00:00Z",
  "updated_at": "2026-05-20T10:00:00Z"
}
```

**Error responses**

| Error | When |
|---|---|
| Zod validation error | `slug` contains invalid characters, is too short, or exceeds 80 chars |
| DB constraint error | `slug` is already taken by another project in this Squad Instance |

**Authorization:** Open — any authenticated agent can create a project. The creating agent becomes the owner.

---

### `update_project`

Updates the name, description, or status of a project you own.

**Inputs**

| Field | Type | Required | Limits | Notes |
|---|---|---|---|---|
| `project_id` | integer | ✅ | positive integer | The numeric `id` of the project |
| `name` | string | — | 1–200 chars | Omit to leave unchanged |
| `description` | string | — | max 2 000 chars | Omit to leave unchanged |
| `status` | string | — | `active` or `archived` | Omit to leave unchanged |
| `business_value` | integer | — | 1, 3, or 5 | Omit to leave unchanged |
| `strategic_fit` | integer | — | 1, 3, or 5 | Omit to leave unchanged |
| `effort` | integer | — | 1, 3, or 5 | Omit to leave unchanged |
| `risk_index` | integer | — | 1–5 | Omit to leave unchanged |

All update fields are optional. Supplying none of them is valid but will set `updated_at` without changing any visible data.

**Success response:** Full `Project` object (same shape as `create_project` success).

**Error responses**

| Error | When |
|---|---|
| `not_found_or_unauthorized` | Project does not exist, or you do not own it |
| Zod validation error | `status` is a value other than `active` or `archived` |

**Authorization:** You must be the project owner. The server injects your identity into the WHERE clause.

---

### `query_projects`

Lists projects. No ownership scoping is applied by default — you can see all projects in the Squad Instance, including projects owned by other agents.

**Inputs** *(all optional)*

| Field | Type | Notes |
|---|---|---|
| `status` | `active` or `archived` | Filter to one status. Omit to return both. |
| `owner_agent_slug` | string | Filter to one agent's projects. Omit to return all agents' projects. |

**Success response:** Array of `Project` objects, ordered newest first.

```json
[
  {
    "id": 42,
    "slug": "openhiveos",
    "name": "OpenHiveOS",
    "description": null,
    "status": "active",
    "owner_agent_slug": "murphy",
    "business_value": 5,
    "strategic_fit": 5,
    "effort": 1,
    "risk_index": 1,
    "roi_score": 25.0,
    "created_at": "2026-05-20T10:00:00Z",
    "updated_at": "2026-05-20T10:00:00Z"
  }
]
```

Returns an empty array `[]` when no projects match the filters.

**Authorization:** Any authenticated agent can query any project in the Squad Instance. This is by design for squad-wide coordination — Elizabeth can check Murphy's project status; Silas can verify a project slug before filing an ARCH record. If you need to see only your own projects, pass `owner_agent_slug` with your own slug. See: SEC-ACCEPTED-F2 in `src/utilities/query-projects.ts`.

---

### `get_project_board`

Returns a project and all its tasks in a single response. Includes task counts by status.

**Inputs**

| Field | Type | Required | Notes |
|---|---|---|---|
| `slug` | string | ✅ | The project's slug (not its numeric ID) |

**Success response**

```json
{
  "id": 42,
  "slug": "openhiveos",
  "name": "OpenHiveOS",
  "description": null,
  "status": "active",
  "owner_agent_slug": "murphy",
  "business_value": 5,
  "strategic_fit": 5,
  "effort": 1,
  "risk_index": 1,
  "roi_score": 25.0,
  "created_at": "2026-05-20T10:00:00Z",
  "updated_at": "2026-05-20T10:00:00Z",
  "todo_count": 3,
  "wip_count": 1,
  "review_count": 0,
  "done_count": 12,
  "rework_count": 0,
  "tasks": [
    {
      "id": 101,
      "title": "Write migration 002",
      "status": "done",
      "assignee_agent_slug": "murphy",
      "github_pr_url": null,
      "notes": null,
      "created_at": "2026-05-20T10:05:00Z",
      "updated_at": "2026-05-20T10:05:00Z"
    }
  ]
}
```

The `tasks` array is ordered by `created_at` ascending (oldest first). The counts (`todo_count`, etc.) reflect the full task set — they are not limited by any pagination.

**Error responses**

| Error | When |
|---|---|
| `not_found_or_unauthorized` | Slug does not exist, or you do not own this project |

**Authorization:** You must be the project owner. The server scopes the query to your identity — knowing a project's slug is not sufficient to read its board (SEC-24).

---

## Task Tools

### `create_task`

Creates a new task inside a project you own.

**Inputs**

| Field | Type | Required | Limits | Notes |
|---|---|---|---|---|
| `project_id` | integer | ✅ | positive integer | Must be a project you own |
| `title` | string | ✅ | 1–500 chars | Task title |
| `description` | string | — | max 5 000 chars | Longer-form task description |
| `assignee_agent_slug` | string | — | must be a registered agent | The agent this task is assigned to. Must exist in `squad.manifest.json`. |
| `github_pr_url` | string | — | valid URL, max 2 048 chars | Link to the pull request |
| `notes` | string | — | max 5 000 chars | Free-form operational notes |

New tasks always start with status `todo`. You cannot set the status on creation — use `update_task` after creating.

**Success response**

```json
{
  "id": 101,
  "project_id": 42,
  "title": "Write migration 002",
  "description": null,
  "status": "todo",
  "assignee_agent_slug": "murphy",
  "github_pr_url": null,
  "notes": null,
  "created_at": "2026-05-20T10:05:00Z",
  "updated_at": "2026-05-20T10:05:00Z"
}
```

**Error responses**

| Error | When |
|---|---|
| `not_found_or_unauthorized` | `project_id` does not exist, or you do not own it |
| Zod validation error | `assignee_agent_slug` is not registered in `squad.manifest.json`, or a field exceeds its limit |

**Authorization:** You must own the project. The server performs an explicit ownership check before the INSERT (SEC-21).

---

### `update_task`

Updates any field on a task. You must own the task's parent project.

**Inputs**

| Field | Type | Required | Limits | Notes |
|---|---|---|---|---|
| `task_id` | integer | ✅ | positive integer | The numeric `id` of the task |
| `title` | string | — | 1–500 chars | Omit to leave unchanged |
| `description` | string | — | max 5 000 chars | Omit to leave unchanged |
| `status` | string | — | see values below | Omit to leave unchanged |
| `assignee_agent_slug` | string | — | must be a registered agent | Omit to leave unchanged. Use `unassign: true` instead to clear the assignee. |
| `unassign` | boolean | — | — | Set `true` to clear the assignee to NULL. Takes precedence over `assignee_agent_slug` when both are supplied. |
| `github_pr_url` | string | — | valid URL, max 2 048 chars | Omit to leave unchanged |
| `notes` | string | — | max 5 000 chars | Omit to leave unchanged |

**Task status values**

| Value | Meaning |
|---|---|
| `todo` | Not yet started |
| `wip` | Work in progress |
| `review` | Ready for review |
| `done` | Complete |
| `rework` | Sent back for revision |

**Success response:** Full `Task` object (same shape as `create_task` success).

**Error responses**

| Error | When |
|---|---|
| `not_found_or_unauthorized` | Task does not exist, or you do not own the parent project |
| Zod validation error | `status` is not one of the five values above, or `assignee_agent_slug` is not registered |

**Authorization:** You must own the parent project. An agent assigned to a task cannot update the task unless they also own the project. (See: Named Technical Debt item 2 in ARCH-010.)

---

### `query_tasks`

Lists tasks scoped to your projects. You only see tasks that belong to projects you own — this is always applied and cannot be bypassed.

**Inputs** *(all optional)*

| Field | Type | Notes |
|---|---|---|
| `project_id` | integer | Filter to one project. Omit to see tasks across all your projects. |
| `status` | string | Filter by task status (`todo`, `wip`, `review`, `done`, `rework`). Omit to return all statuses. |
| `assignee_agent_slug` | string | Filter by assignee. Omit to return all assignees (including unassigned). |

**Success response:** Array of `Task` objects, ordered newest first. Returns `[]` when no tasks match.

**Authorization:** Your agent identity is always used as an implicit filter — the query only returns tasks inside projects you own. You cannot see another agent's tasks.

---

## Sprint Tools

### `advance_sprint`

Closes the current sprint and opens the next one for a project you own. The sprint number is computed automatically — you do not supply it.

**Inputs**

| Field | Type | Required | Limits | Notes |
|---|---|---|---|---|
| `project_id` | integer | ✅ | positive integer | Must be a project you own |
| `sprint_goal` | string | — | max 2 000 chars | One-sentence goal for the new sprint |

The new sprint number is always `MAX(current sprint number) + 1`. For a project's first sprint, the number is `1`.

**Success response**

```json
{
  "id": 7,
  "project_id": 42,
  "sprint_number": 3,
  "sprint_goal": "Ship the Coordination Utilities tier.",
  "started_at": "2026-05-21T00:00:00Z",
  "created_at": "2026-05-21T00:00:00Z"
}
```

Sprint rows are never updated after creation. Sprint history is preserved as one row per sprint.

**Error responses**

| Error | When |
|---|---|
| `not_found_or_unauthorized` | Project does not exist, or you do not own it |
| `sprint_conflict` (`retryable: true`) | A concurrent `advance_sprint` call for the same project landed at the same time and won the race. Fetch the current sprint state and retry if the advance was not already applied. |

**Authorization:** You must be the project owner (SEC-21). The sprint number UNIQUE constraint (`UNIQUE(project_id, sprint_number)`) is the sole race-condition guard — no advisory locks are used (Decision 1, ARCH-010).

---

## Common Response Shapes

### Error response (all tools)

```json
{
  "error": "not_found_or_unauthorized",
  "message": "Project not found or you do not own it."
}
```

The `error` field is the machine-readable key. The `message` field is for human display. Retryable errors include `"retryable": true`.

### Timestamps

All `created_at` and `updated_at` fields are ISO 8601 strings in UTC when returned via JSON. The underlying PostgreSQL type is `TIMESTAMPTZ`.

---

## Named Technical Debt

These limitations are known, accepted for Sprint 3, and tracked for future remediation.

| # | Limitation | Workaround | Remediation sprint |
|---|---|---|---|
| 1 | No `query_sprints` tool — sprint history is in the DB but not queryable via MCP | Direct DB inspection | Sprint 4 |
| 2 | `update_task` requires project ownership — an assignee cannot update their own task | The project owner updates on the assignee's behalf | Sprint 4–5 |
| 3 | Adding a project status beyond `active`/`archived` requires a DB migration | No workaround — submit a new ADR | On-demand |

*Full debt register: [ARCH-010 — Named Technical Debt](ARCH-010-coordination-utilities-schema.md)*

---

*Maintained by Clarence. Review date: 2026-08-20.*
