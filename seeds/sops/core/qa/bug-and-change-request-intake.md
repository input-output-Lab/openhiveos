---
title: "SOP: Bug & Change Request Intake"
owner: "Elizabeth"
team: "Project Delivery"
status: "Active"
version: "1.1"
last-updated: 2026-06-14
review-cycle: "Quarterly"
signatories:
  - name: "Richo"
    role: "Integrator"
    signed:
  - name: "Elizabeth"
    role: "Owner"
    signed: 2026-06-13
tags:
  - sop
  - bugs
  - change-requests
  - intake
  - project-delivery
---

# SOP: Bug & Change Request Intake

> [!info] Ownership
> **Owner:** Elizabeth · **Team:** Project Delivery · **Last Updated:** 2026-06-14 · **Next Review:** 2026-09-14

---

## Purpose

Define a formal, repeatable intake process for bugs and change requests so that every submission arrives with the information required to triage, estimate, and action it — without a follow-up round-trip to the reporter.

This SOP closes the gap between "someone noticed a problem or has an idea" and "a properly formed task exists in the sprint system." It applies to both internal team members and client-facing projects.

---

## Scope

**Included:** All bugs discovered in production or staging. All change requests, feature additions, and scope modifications submitted by operators, clients, or team members.

**Excluded:** P0 incidents (see [[incident-response]]). Project inception and major feature specification (see [[project-inception-package]]). Sprint task status management (see [[sprint-workflow]]).

---

## Roles & Responsibilities

| Role | Responsibility |
|---|---|
| **Reporter** | Completes the intake form for their submission type. Does not self-triage severity or priority — provides facts and business impact. |
| **Elizabeth** | Owns intake triage. Reviews every submission within 1 business day. Assigns severity, priority, and sprint slot. Creates the task in OpenSquad and ClickUp (if client project). |
| **Murphy / Rocket** | Provides technical feasibility and effort signal during triage when complexity is unclear. Does not unilaterally accept or reject submissions. |
| **Scout** | Validates completed bug fixes against acceptance criteria before Elizabeth marks `DONE`. |
| **Integrator (Richo)** | Final sign-off on all P0 and P1 bugs. Approves change requests that affect a current Rock or sprint commitment. |

---

## Definitions

| Term | Definition |
|---|---|
| **Bug** | Behaviour that diverges from the documented or clearly intended specification. Something that worked before is now broken, or something never worked as expected. |
| **Change Request (CR)** | A request to alter existing functionality, add a new capability, or modify agreed scope. Distinct from a bug — the system is working as built, but the build is wrong for current needs. |
| **Triage** | Elizabeth's classification of a submission: severity, priority, sprint slot, and owner assignment. |
| **Severity** | How broken the system is (P0–P3). Assigned by Elizabeth, not the reporter. |
| **Priority** | When it gets fixed (Now / This Sprint / Next Quarter / Backlog). Derived from severity plus sprint capacity. |

---

## Severity Reference (Bugs)

| Level | Definition | Response Time | Default Sprint Slot |
|---|---|---|---|
| **P0 — Critical** | System down, data loss, security breach. No workaround exists. | Immediate — breaks sprint | Hotfix outside sprint |
| **P1 — High** | Core feature non-functional. Workaround exists but degrades user experience significantly. | Within 24h triage | Current sprint (pull from backlog) |
| **P2 — Medium** | Significant deviation from spec. Not blocking primary workflows. | Within 1 business day triage | Next sprint |
| **P3 — Low** | Minor visual or UX issue. No functional impact. | Within 1 week triage | Backlog grooming slot |

---

## Bug Intake Form

Every bug submission must include all required fields. A submission missing required fields is returned to the reporter before triage begins.

```markdown
## Bug Report — [Short description]

**Date:** YYYY-MM-DD
**Reporter:** [Name / Agent]
**Project / System:** [e.g., OpenHiveOS Dashboard, Insoma API]
**Environment:** [Production | Staging | Development]
**Browser / OS (if UI):** [e.g., Chrome 125 / macOS 14]
**App Version / Commit (if known):** [e.g., v0.12.3 or commit SHA]

---

### What happened?
[Exact description of the observed behaviour]

### What was expected?
[What should have happened instead]

### Steps to reproduce
1. 
2. 
3. 

### Frequency
[Always | Intermittent (~X% of attempts) | Only once]

### Business impact
[How is this affecting users, clients, or operations right now?]

### Evidence
[Screenshots, screen recordings, error logs, Sentry links — attach or paste]

---

*Reporter does not assign severity. Elizabeth assigns severity during triage.*
```

---

## Change Request Intake Form

Every change request must include all required fields. A CR missing the business justification or impact assessment is returned before triage.

```markdown
## Change Request — [Short description]

**Date:** YYYY-MM-DD
**Requester:** [Name / Role]
**Project / System:** [e.g., OpenHiveOS Dashboard]
**Type:** [New capability | Scope modification | UX improvement | Integration]

---

### What is being requested?
[Clear description of the change. What should the system do differently?]

### Why is this needed?
[Business justification. What problem does it solve or what opportunity does it unlock?]

### Who is affected?
[Which users, agents, clients, or systems are affected?]

### Urgency signal
[Blocker — cannot proceed without this | High — needed this sprint | Normal — next sprint is fine | Low — backlog]

### Suggested success criteria
[Optional: How will we know this change worked?]

### Known constraints
[Optional: Any technical, design, or scope constraints the team should know about]

---

*CR does not guarantee sprint placement. Elizabeth triage determines slot based on Rock alignment and sprint capacity.*
```

---

## Process Steps

### Step 1 — Submission

The reporter selects the appropriate form (Bug or Change Request) and submits it via one of the following channels:

| Channel | Use When | Submission Format |
|---|---|---|
| `docs/bug-reports/bugs.md` (append) | Internal team — any project under OpenHiveOS | Paste complete intake form (Bug or CR) at end of file |
| Email to `elizabeth@inputoutputlabs.com` | Client or external reporter | Full intake form in email body; attachments OK for screenshots |
| ClickUp Backlog (direct task) | Client-facing projects with ClickUp workspace access | See **ClickUp Submission Workflow** below |

### ClickUp Submission Workflow (v1.1)

For projects with a ClickUp workspace (typically client-facing):

**Submission:**
1. Reporter opens the **Backlog** list in the target project
2. Clicks **+ Add Task** and fills the form using the appropriate template:
   - **Bug template:** Title starts with `[BUG]`, description includes intake form fields (environment, reproduction steps, business impact)
   - **Change Request template:** Title starts with `[FEATURE]` or `[CHANGE]`, description includes intake form fields (justification, urgency, success criteria)
3. Assigns to **Elizabeth** if known, otherwise leaves unassigned
4. Submits the task — Elizabeth will receive a notification

**Elizabeth's triage workflow:**
1. Reviews the task within 1 business day
2. Validates completeness — if fields missing, adds a task comment requesting specific information
3. Updates task status to **Todo** (not Backlog)
4. Assigns severity/priority via task tags or custom fields (per project config)
5. Links to OpenSquad task if this is a cross-system sync (see [[sprint-workflow#Dual-System Sync Protocol]])

**Dual-system sync:** For projects using both ClickUp and OpenSquad (OpenHiveOS), Elizabeth uses the `update_backlog_task` utility to keep ClickUp status in sync with OpenSquad task status. See [[sprint-workflow#Dual-System Sync Protocol]] for the complete transition table (e.g., OpenSquad `wip` → ClickUp `In Progress`).

> [!warning] No Verbal Submissions
> Bugs and change requests raised verbally in a meeting, Slack, or Telegram do **not** exist until they are in writing. The person who raises it verbally is responsible for submitting the form. Elizabeth does not transcribe verbal submissions.

---

### Step 2 — Triage (Elizabeth — within 1 business day)

Elizabeth reviews every new submission and:

1. **Validates completeness** — If required fields are missing, returns to reporter with specific fields requested. Triage clock pauses until resubmitted.
2. **Assigns severity / priority** — Bugs get P0–P3. CRs get urgency slot.
3. **Checks Rock alignment** — Does this CR affect the current Rock or sprint commitment? If yes, Integrator sign-off required before proceeding.
4. **Assesses scope** — For CRs: invokes Murphy or Rocket for a rough effort estimate (XS/S/M/L/XL) if complexity is unclear.
5. **Applies scope guard (CRs only)** — If the CR threatens the current Rock, it is logged to the Issues List or V/TO™ backlog. Reporter is notified in writing with the rationale.

---

### Step 3 — Task Creation

Once triage is complete:

1. **Elizabeth creates the task in OpenSquad** with:
   - Title: `[Bug]` or `[Feature]` prefix per [[github-issue-types]]
   - Description: Full intake form content
   - Priority and severity tags
   - Acceptance criteria (minimum: reproduces → fixed → Scout verifies)
   - Assignee

2. **Elizabeth syncs to ClickUp** (client-facing projects only) via `create_backlog_task`.

3. **Elizabeth notifies the reporter** with the task ID and expected sprint slot.

---

### Step 4 — Sprint Placement

| Severity / Urgency | Placement Rule |
|---|---|
| P0 | Immediate hotfix — breaks sprint if needed. Integrator notified within 15 minutes. |
| P1 | Pulled into current sprint at next daily. Displaces lowest-priority current task if at capacity. Elizabeth documents the trade-off. |
| P2 / CR High | Queued for next sprint during backlog grooming. |
| P3 / CR Normal | Backlog grooming slot — RICE scored against other backlog items. |
| CR Low | V/TO™ backlog — surfaced at next quarterly planning. |

---

### Step 5 — Validation & Closure

- Developer sets task to `REVIEW` when work is complete and includes a validation note.
- Scout verifies against acceptance criteria.
- Elizabeth closes the task (`DONE`) after Scout signs off.
- Reporter is notified of closure.

For bugs: the closure notification includes a one-line summary of root cause and the fix applied.
For CRs: the closure notification confirms what was delivered against what was requested.

---

## What This SOP Does Not Cover

| Scenario | Where to Go |
|---|---|
| P0 production incident (system down) | [[incident-response]] |
| New project or major feature inception | [[project-inception-package]] |
| Sprint task status transitions | [[sprint-workflow]] |
| Security vulnerability disclosure | Locksmith directly — do not use public intake channels |

---

## Quality Gates

Before any bug or CR becomes a task, Elizabeth confirms:

- [ ] All required form fields completed
- [ ] Severity / priority assigned
- [ ] Rock / sprint impact assessed (CRs)
- [ ] Integrator sign-off obtained (CRs affecting current Rock, or P0/P1 bugs)
- [ ] Task created in OpenSquad with acceptance criteria
- [ ] Reporter notified with task ID and sprint slot

---

## Amendment Log

| Version | Date | Change | Author |
|---|---|---|---|
| 1.1 | 2026-06-14 | Add ClickUp submission channel with detailed workflow; link to dual-system sync protocol | Clarence |
| 1.0 | 2026-06-13 | Initial draft — addresses gap identified during OpenHiveOS Sprint 12 bugs.md exercise | Elizabeth + Murphy |
