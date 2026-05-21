---
title: "OpenHiveOS — Cron Utilities Tool Reference"
date: 2026-05-21
updated: 2026-05-21
author: "Clarence"
owner: "Clarence"
status: active
tags:
  - type/guide
  - project/openhiveos
  - domain/backend
  - audience/technical
review_date: 2026-08-21
---

# OpenHiveOS — Cron Utilities Tool Reference

**What this is for:** A complete reference for the five Cron Utility MCP tools shipped in Sprint 4. For every tool: what it does, what inputs it accepts, what it returns, and what errors it can produce.

**Audience:** Any agent using the OpenHiveOS MCP server. Also useful for operators building automation workflows around a Squad Instance.

**Schema authority:** [ARCH-011 — Cron Utilities Schema](ARCH-011-cron-utilities-schema.md)  
**Source files:** `src/utilities/create-cron.ts`, `src/utilities/update-cron.ts`, `src/utilities/query-crons.ts`, `src/utilities/delete-cron.ts`, `src/utilities/query-sprints.ts`  
**Last updated:** 2026-05-21 (Sprint 4 ship — v0.1.0)

---

## What crons are

A cron record schedules a recurring call to one of the Squad's registered MCP tools. It stores a cron expression (the schedule), the name of the tool to call (`tool_name`), and an optional `payload` to pass to that tool. Crons are registered intent — the worker tier that actually executes them is shipped in Sprint 5. Registering a cron now means the Squad has the schedule and payload ready the moment the worker goes live.

**In plain English:** A cron record is a sticky note that says "run this tool with these arguments on this schedule." The worker will pick it up. The tools in this reference let you write, edit, find, and remove those notes.

---

## Authorization model

Every **write** tool (`create_cron`, `update_cron`, `delete_cron`) enforces ownership automatically. The server reads your identity from your bearer token and injects it as the `owner_agent_slug`. You cannot modify a cron you do not own — the query returns not-found and the tool returns `not_found_or_unauthorized`. You cannot tell the difference between "this does not exist" and "this exists but you do not own it." That is intentional.

`create_cron` additionally checks that the target `project_id` is owned by the calling agent. You cannot schedule work against a project you do not own.

`query_crons` is an **open read** with a filter allowlist. Any authenticated agent can list crons. Filter by `owner_agent_slug` to scope to your own.

`query_sprints` is **caller-scoped**: the server automatically filters to projects you own. You never see another agent's sprint history.

**`tool_name` allowlist (SEC-26):** The `tool_name` field on `create_cron` and `update_cron` must be one of the 21 registered tool names in `src/utilities/tool-registry.ts`. The server rejects any value outside this list. See [Appendix — Registered tool names](#appendix--registered-tool-names).

---

## Cron Tools

### `create_cron`

Registers a new cron schedule. The calling agent becomes the owner.

**Inputs**

| Field | Type | Required | Limits | Notes |
|---|---|---|---|---|
| `project_id` | integer | ✅ | positive int | Must be a project you own. The server verifies ownership before inserting. |
| `name` | string | ✅ | 1–200 chars | Human-readable label for this cron. |
| `schedule` | string | ✅ | valid cron expression | Standard 5-field cron expression. Validated with `cron-parser`. Example: `"0 9 * * 1"` (Monday 09:00). |
| `tool_name` | string | ✅ | registered tool only | The MCP tool this cron will invoke. Must appear in the SEC-26 allowlist. |
| `description` | string | — | max 2 000 chars | Optional. Describe what this cron does and why. |
| `payload` | object | — | max 16 KB, max 5 levels deep | Optional JSONB payload passed to the tool at execution time. Must be a plain object (not an array, not a primitive). |

You do not supply `status`. New crons always start as `active`.  
You do not supply `owner_agent_slug`. The server injects this from your bearer token.  
You do not supply `last_run_at`. The worker tier populates this at first execution.

**Success response**

```json
{
  "id": 7,
  "project_id": 70,
  "owner_agent_slug": "murphy",
  "name": "Daily standup summary",
  "description": "Queries open tasks and posts a morning summary.",
  "schedule": "0 9 * * 1-5",
  "tool_name": "query_tasks",
  "payload": { "status": "WIP" },
  "status": "active",
  "last_run_at": null,
  "created_at": "2026-05-21T09:00:00.000Z",
  "updated_at": "2026-05-21T09:00:00.000Z"
}
```

**Error responses**

| Error key | When |
|---|---|
| `invalid_schedule` | The `schedule` string is not a valid cron expression. |
| `invalid_tool_name` | The `tool_name` is not in the SEC-26 allowlist. |
| `invalid_payload` | The payload exceeds 16 KB, exceeds 5 nesting levels, or is not a plain object. |
| `not_found_or_unauthorized` | The `project_id` does not exist or you do not own it. |

---

### `update_cron`

Updates one or more fields on an existing cron. Only the owner can update.

This is a **patch** operation — you only supply the fields you want to change. Fields you omit are left as-is.

**Inputs**

| Field | Type | Required | Limits | Notes |
|---|---|---|---|---|
| `id` | integer | ✅ | positive int | The cron's numeric ID. |
| `name` | string | — | 1–200 chars | New name for this cron. |
| `description` | string or null | — | max 2 000 chars, or `null` | Pass `null` to clear the description. |
| `schedule` | string | — | valid cron expression | New schedule. Validated with `cron-parser`. |
| `tool_name` | string | — | registered tool only | Must appear in the SEC-26 allowlist. |
| `payload` | object or null | — | max 16 KB, max 5 levels deep, or `null` | Pass `null` to clear the payload. |
| `status` | string | — | `"active"` or `"paused"` | To delete a cron, use `delete_cron`. |

You must supply at least one optional field alongside `id`.

**Patch semantics for nullable fields:** Omitting `description` or `payload` preserves the current value. Passing `null` explicitly clears it.

**Success response**

Returns the full updated cron row — same shape as `create_cron` success.

**Error responses**

| Error key | When |
|---|---|
| `invalid_schedule` | The new `schedule` is not a valid cron expression. |
| `invalid_tool_name` | The new `tool_name` is not in the SEC-26 allowlist. |
| `invalid_payload` | Payload validation fails (size, depth, or type). |
| `not_found_or_unauthorized` | The `id` does not exist, you do not own it, or it has been deleted. |

---

### `query_crons`

Lists crons, with optional filters. Returns all agents' crons by default (open read). Filter by `owner_agent_slug` to see only your own.

**Inputs** (all optional)

| Field | Type | Notes |
|---|---|---|
| `project_id` | integer | Filter to a specific project. |
| `status` | string | One of `"active"`, `"paused"`, `"deleted"`. Defaults to excluding deleted crons when omitted. |
| `owner_agent_slug` | string | Filter to a specific agent's crons. Pass your own slug to scope to yourself. |

When no `status` filter is passed, deleted crons are hidden automatically.

**Success response**

```json
[
  {
    "id": 7,
    "project_id": 70,
    "owner_agent_slug": "murphy",
    "name": "Daily standup summary",
    "description": "Queries open tasks and posts a morning summary.",
    "schedule": "0 9 * * 1-5",
    "tool_name": "query_tasks",
    "payload": { "status": "WIP" },
    "status": "active",
    "last_run_at": null,
    "created_at": "2026-05-21T09:00:00.000Z",
    "updated_at": "2026-05-21T09:00:00.000Z"
  }
]
```

Returns an empty array when no crons match the filters. Never errors on an empty result.

---

### `delete_cron`

Soft-deletes a cron. The record is marked `status = 'deleted'` — it is never physically removed from the database. Only the owner can delete.

**Inputs**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | integer | ✅ | The cron's numeric ID. |

**Success response**

Returns the full cron row as it looked at the moment of deletion (status will be `"deleted"`).

**Error responses**

| Error key | When |
|---|---|
| `already_deleted` | The cron exists but was already deleted. |
| `not_found_or_unauthorized` | The `id` does not exist or you do not own it. |

**Important:** Once deleted, a cron cannot be reactivated. Create a new cron record if you need to reschedule it.

---

## Sprint Tools

### `query_sprints`

Lists sprint history for your projects. The server automatically scopes results to projects you own — you will never see another agent's sprints.

**Inputs** (all optional)

| Field | Type | Notes |
|---|---|---|
| `project_id` | integer | Filter to a specific project. Must be a project you own — returns empty if you do not own it. |
| `sprint_number` | integer | Filter to a specific sprint number within a project. |

**Success response**

```json
[
  {
    "id": 12,
    "project_id": 70,
    "sprint_number": 4,
    "goal": "Ship Cron Utilities tier — Sprint 4",
    "started_at": "2026-05-20T00:00:00.000Z",
    "ended_at": null,
    "created_at": "2026-05-20T12:00:00.000Z"
  }
]
```

`ended_at` is `null` for the active sprint. Returns an empty array when no sprints match.

---

## Cron expression format

OpenHiveOS uses standard 5-field cron expressions (POSIX / Vixie cron):

```
┌───── minute (0–59)
│ ┌───── hour (0–23)
│ │ ┌───── day of month (1–31)
│ │ │ ┌───── month (1–12)
│ │ │ │ ┌───── day of week (0–7, 0 and 7 = Sunday)
│ │ │ │ │
* * * * *
```

**Common examples**

| Expression | Meaning |
|---|---|
| `0 9 * * 1-5` | 09:00 every weekday |
| `*/15 * * * *` | Every 15 minutes |
| `0 0 * * 0` | Midnight every Sunday |
| `30 17 1 * *` | 17:30 on the 1st of every month |

The server validates every expression using `cron-parser` before accepting the record. Invalid expressions are rejected immediately.

**6-field expressions are not supported.** Do not include a seconds field.

---

## Appendix — Registered tool names

The `tool_name` field must be one of the 21 tools currently registered in the Squad:

**OS Primitives (8)**

`get_disposition` · `query_thoughts` · `ratify_thought` · `search_memory` · `search_sops` · `set_disposition` · `store_memory` · `store_thought`

**Coordination Utilities (9)**

`advance_sprint` · `create_project` · `create_task` · `get_project_board` · `query_projects` · `query_sprints` · `query_tasks` · `update_project` · `update_task`

**Cron Utilities (4)**

`create_cron` · `delete_cron` · `query_crons` · `update_cron`

The canonical allowlist is maintained in `src/utilities/tool-registry.ts`. Sprint 5 additions will be added to this file and are subject to a Locksmith SEC review before merging.

---

## Related documents

- [coordination-utilities-reference.md](coordination-utilities-reference.md) — Sprint 3 tool reference (projects, tasks, sprints)
- [ARCH-011 — Cron Utilities Schema](ARCH-011-cron-utilities-schema.md) — Schema decisions, SEC-26 through SEC-30 binding conditions
- [glossary.md](glossary.md) — Term definitions for all OpenHiveOS concepts

---

*Maintained by Clarence. Last updated: 2026-05-21 (Sprint 4 close — v0.1.0).*

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-21 | Created — Sprint 4 ship (v0.1.0). Covers create_cron, update_cron, query_crons, delete_cron, query_sprints. |
