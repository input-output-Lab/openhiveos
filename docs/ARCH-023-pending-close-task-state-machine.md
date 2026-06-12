---
title: "ARCH-023 — pending-close Status in Task State Machine"
date: 2026-06-12
updated: 2026-06-12
author: "Clarence"
owner: "Silas"
status: decided
tags:
  - type/architecture
  - project/openhiveos
  - domain/backend
  - audience/technical
review_date: 2026-09-12
doc_id: "ARCH-023"
related:
  - "[[ARCH-005-agent-os-canonical-architecture]]"
  - "[[ARCH-019-sprint-9-api-surface]]"
  - "[[ARCH-009-sop-seeding-operator-onboarding]]"
---

*This ADR formalises the missing architectural backing for the SOP restriction on task closure. It documents the decision to introduce `pending-close` as a first-class state and mandates the M3 handler-level gate before any task state transition is processed.*

---

## ADR — ARCH-023: pending-close Status in Task State Machine

**Date:** 2026-06-12
**Project:** openhiveos
**Status:** Decided
**Decision Owner:** Silas
**Approved by:** Elizabeth

---

## Context

The codebase shipped Model C (assignee path) on 2026-05-21, allowing assignee agents to call `update_task` and advance their own task status. The Sprint Workflow SOP (v1.1) restricted the final `done` transition to Elizabeth only — but no ADR existed to justify or define the boundary. This gap meant the restriction lived in documentation with no code enforcement.

Two additional findings sharpened the problem: (1) Locksmith identified that the `notes` field is blocked on the assignee path, making any "zero code changes" approach architecturally false — the API surface was already asymmetric. (2) No handler-level gate (M3) existed to prevent an assignee from writing `done` directly. The SOP alone was the only barrier. That is insufficient.

---

## Decision

Add `pending-close` as a valid task status in the state machine. Assignees submit `pending-close` when work is complete. Elizabeth (or a designated validator) batch-approves those tasks to `done`. A mandatory M3 gate is added at the handler level, blocking any `done` write from the assignee role path regardless of payload — the gate fires before persistence and returns a `403` with a structured error if the caller is not Elizabeth or the system.

---

## Rationale

Option B is the only option that (a) requires no SOP-only trust, (b) accurately models the existing two-actor close process as a state rather than a convention, and (c) makes the Elizabeth-approval step machine-verifiable. The `pending-close` state makes batch-approval visible on the board without requiring Elizabeth to poll or infer completion from `review` alone.

---

## Trade-offs Accepted

An extra board state increases the board's surface area and requires assignees to learn the new terminal step. There is a transitional period during which tasks created before this change will not have `pending-close` in their history — sprint reports must note this boundary (Sprint beginning 2026-06-12).

---

## Consequences

- **Schema:** Add `pending-close` to the task status enum. Migration required.
- **Code:** M3 gate added to `update_task` handler — blocks `done` writes from assignee-role tokens.
- **MCP tools:** `update_task` tool description updated to document valid assignee transitions and surface the `pending-close` step.
- **SOP:** Sprint Workflow SOP v1.2 updated — assignee terminal step changes from `review` → `pending-close`. Elizabeth approval step is now mandatory close gate by policy *and* by code.
- **Docs:** This ADR supersedes the undocumented SOP restriction on `done` transitions. All references to that restriction must link here.

---

## Security Review

Locksmith finding incorporated: the asymmetric `notes` field block on the assignee path confirmed the API already distinguishes role-scoped capabilities. M3 gate closes the corresponding gap on status writes. Risk posture: **resolved** pending M3 implementation and migration. No secrets or data-access scope changes involved.

---

## Rejected Alternatives

- **Option A — Zero code changes, SOP-only enforcement:** Rejected. Locksmith confirmed the `notes` field is already blocked on the assignee path, making a "no code changes" claim false. SOP-only enforcement leaves `done` writable by any assignee token and cannot be audited after the fact.
- **Option C — Hard block on assignee path entirely:** Rejected. Model C (assignee self-progression) shipped and is in production use. Removing it reverts a deliberate architectural choice and breaks existing agent workflows without demonstrable security benefit.
