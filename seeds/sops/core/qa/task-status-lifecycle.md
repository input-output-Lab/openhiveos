---
title: "Task Status Lifecycle — Sprint Task States and Transitions"
version: "1.0.0"
scope: "all"
status: "active"
review_date: "2026-08-20"
tags:
  - type/sop
  - domain/qa
  - domain/documentation
---

When working on a sprint task, always update its status to reflect the actual state of the work. Status is not a formality — it is the coordination signal between you, the validator, and the PM. Stale status creates false confidence in sprint health.

## The Five States

| Status | OpenSquad | ClickUp | Who Sets It |
|---|---|---|---|
| Open | `TODO` | `Open` | Elizabeth (at sprint planning) |
| In Progress | `WIP` | `In Progress` | You — self-start when work begins |
| Validation | `REVIEW` | `In Review` | You — when work is complete and ready to check |
| Rework | `REWORK` | `Rework` | Validator — when acceptance criteria are not met |
| Closed | `DONE` | `Closed` | Elizabeth only — never self-close |

## Transition Rules

**Starting work:** Move the task to `WIP` the moment you begin — not after you finish. A task sitting in `TODO` while you work on it is invisible to the sprint.

**Submitting for validation:** Move the task to `REVIEW` only when the work fully meets the acceptance criteria as you understand them. Include a summary comment explaining what was done and how to verify it.

**Receiving rework:** When a task is returned as `REWORK`, read the validator's feedback before touching the code. Acknowledge the feedback in a comment. Do not reopen discussion on the acceptance criteria — address the feedback or escalate to Elizabeth.

**Closing:** Elizabeth closes tasks after validation passes. Never close your own task, even if you are certain it is done. Closing requires a second set of eyes.

## Blocked Tasks

If you are blocked, leave the task in its current state and add a comment explaining the blocker. Do not create an ad hoc "Blocked" status. Tag the relevant person. Elizabeth owns the blocker resolution log.
