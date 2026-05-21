---
title: "Sprint 2 Planning — OpenHiveOS"
date: 2026-05-20
type: meeting-minutes
project: openhiveos
tags:
  - type/meeting-minutes
  - project/openhiveos
  - domain/architecture
  - domain/backend
---

# Sprint 2 Planning — OpenHiveOS

**Date:** 2026-05-20
**Facilitator:** Elizabeth
**Attendees:** Elizabeth (PM), Richo (Founder / Product Owner)
**Agent Inputs:** Silas (DoR audit), Murphy (story review), Locksmith (security review), Cooper (infrastructure review), Clarence (documentation review), Nova (cross-project validation)

---

## Sprint 2 Goal

> Close all ARCH-007 public release security gate conditions (SEC-16, SEC-18, SEC-19) and retire documentation debt — completing the security foundation for OpenHiveOS v0.1.

**Sprint Window:** 2026-05-21 → 2026-06-03 (14 days)
**Sprint Health Prediction:** 🟡 Achievable with risk

---

## Key Decisions

1. **Auth sequencing confirmed** — Doorkeeper has no relevance to OpenHiveOS. `AGENT_TOKEN` env-based auth ships with v0.1 as the permanent approach. Doorkeeper is a post-v1.0 concern at most. Nova hold on S2-01 lifted. S2-01 proceeds as planned. Owner: Richo. Confirmed verbally 2026-05-20.

2. **Coordination Utilities required for v0.1** — Projects, tasks, crons, and sprint board primitives are confirmed in-scope for v0.1 (not v0.2). This moves the v0.1 ship date to end of Sprint 3. Sprint 2 = security gates. Sprint 3 = Coordination Utilities tier. Owner: Richo. Confirmed verbally 2026-05-20.

3. **ARCH-009 mandated** — Silas to file Coordination Utilities schema design ADR before Sprint 3 opens. Same model as ARCH-008 addendum for Sprint 2. No Sprint 3 coding begins until ARCH-009 is decided. Owner: Silas. Due: before Sprint 3 Day 0.

4. **Sprint 2 goal revised** — Original framing ("one switch away from launch") retired. Sprint 2 closes security gates only. v0.1 is a two-sprint close: Sprint 2 (security) + Sprint 3 (Coordination Utilities). Owner: Elizabeth.

5. **S2-08 scoped into S2-01** — `GET /health` `{agents}` field flagged by Locksmith as potential unauthenticated Information Disclosure pre-v0.1. Murphy audits and fixes as part of the S2-01 PR. Not a separate story. Owner: Murphy.

---

## Sprint Stories

| Task ID | Story | Owner | Effort | Status |
|---------|-------|-------|--------|--------|
| #1301 | [Feature] S2-01: Auth middleware — AGENT_TOKEN ConfigSchema + src/auth/identity.ts + 8 primitive handler closures + provisioning script | Murphy | M | TODO |
| #1302 | [Security] S2-02: SEC-16 — Constant-time comparison audit + Locksmith sign-off | Locksmith | S | TODO |
| #1303 | [Security] S2-03: SEC-18 — STRIDE threat model for OpenHiveOS v0.1 | Locksmith | M | TODO |
| #1305 | [Security] S2-04: SEC-19 CI gate — hard merge block on IO Labs internal references | Cooper | S | TODO |
| #1306 | [Docs] S2-05: ARCH-007 documentation debt — README + frontmatter + ARCH-006 header fix | Clarence | S | TODO |
| #1307 | [Docs] S2-06: docs/glossary.md — OpenHiveOS terminology glossary (20 terms) | Clarence | S | TODO |
| #1304 | [Docs] S2-07: Factory Standard — OS Primitives Extraction SOP → Obsidian vault | Clarence | S | TODO |

*S2-08 (health endpoint agents field audit) scoped into S2-01 — no separate task.*

---

## Pre-Sprint Day 0 Deliverables

Must land before 9am May 21. These are blockers, not backlog.

| Deliverable | Owner | Unblocks |
|-------------|-------|---------|
| ARCH-008 addendum: stdio env-token auth (env var name, token format, boot sequence addition, revocation posture, Doorkeeper phase note) | Silas | S2-01 |
| DFD: 4 OpenHiveOS data flows with trust boundaries and sensitivity labels | Silas | S2-03 |
| Glossary seed term list approval | Elizabeth | S2-06 |
| SEC-19 pattern list approval | Locksmith (by Day 3, May 23) | S2-04 |
| Obsidian vault absolute path confirmation | Cooper (by Day 3, May 23) | S2-07 |

---

## Dependency Sequence

```
Day 0:  Silas → ARCH-008 addendum + DFD
        Auth sequencing confirmed ✅ (Richo, this session)
        Glossary seed list approved ✅ (this session)

Day 1:  Clarence → S2-05 (starts — fully unblocked)
        Clarence → S2-06 (starts — fully unblocked)
        Cooper   → local grep audit (input for S2-04 + S2-05)

Day 2:  Murphy → S2-01 coding starts (config.ts + provisioning stub)

Day 3:  Locksmith → pattern list approved → Cooper → S2-04 starts
        Locksmith → S2-03 starts (with Silas DFD)
        Cooper   → vault path confirmed

Days 4–5: Cooper → S2-04 merges (required status check active)
           Clarence → S2-05 + S2-06 DONE

May 28: Murphy → S2-01 PR open (auth middleware + health audit)
        Locksmith → S2-03 DONE (STRIDE model filed to docs/)

May 28 – June 3:
        Locksmith → S2-02 opens and closes (SEC-16 sign-off)
        Clarence  → S2-07 files to vault (if S2-01 merged by then)

June 3: Locksmith → S2-02 DONE ✅  Sprint 2 closes
```

**Critical path:** Silas Day 0 → Murphy S2-01 (May 28) → Locksmith S2-02 (June 3)

---

## DoR Failures Surfaced (Silas)

| Story | Issue | Resolution |
|-------|-------|-----------|
| S2-01 | ARCH-001 covers HTTP middleware (Bearer header, per-request) — does NOT cover stdio env-token auth (process-level identity, one-process-per-agent topology). Token format unconfirmed. AGENT_TOKEN absent from ConfigSchema. | Silas files ARCH-008 addendum on Day 0. Auth sequencing confirmed by Richo this session. |
| S2-02 | No explicit audit checklist. Sign-off artifact format undefined. | Locksmith defines checklist in task. Format: OpenSquad memory entry tagged type:security-approval, adr:SEC-16. |
| S2-03 | DFD not yet produced. Scope boundary undefined. Output format undefined. | Silas delivers DFD Day 0. Output: docs/THREAT-MODEL-001.md. |
| S2-04 | Pattern list not agreed. Exception allowlist format undefined. | Locksmith approves pattern list by Day 3. |
| S2-07 | Vault path unknown. SOP number unassigned. Must sequence after S2-01. | Cooper confirms path by Day 3. Elizabeth assigns SOP number before filing. |

---

## Security Review Findings (Locksmith)

- **S2-01**: Use `crypto.randomBytes(32)` for token generation. `timingSafeEqual` is the only permitted comparison — no `===` fallback anywhere. agentSlug resolved server-side — never accepted from caller. Boot must halt if AGENT_TOKEN missing or resolution fails.
- **S2-02**: Sign-off memory entry must be created in the same session as the audit. No retroactive sign-offs.
- **S2-03**: Health endpoint `GET /health` carries unauthenticated `{agents}` field. Must be included in STRIDE flow 4 and mitigated before v0.1. Mitigation scoped into S2-01.
- **S2-04**: SEC-19 patterns include `openbridge` — Locksmith must review to avoid false positives on openBridge product references.
- **Locksmith bandwidth risk**: Concurrent io_auth ARCH-008 gate reviews (6 gates) overlap with S2-02 and S2-03 deadlines. Elizabeth to schedule with Locksmith at Sprint 2 kickoff to confirm capacity.

---

## Nova Cross-Project Findings

- **S2-01 (held, now resolved)**: 60–70% semantic overlap with io_auth ARCH-008 Doorkeeper auth decision detected. Richo confirmed Doorkeeper is not relevant to OpenHiveOS. env-token v0.1 is the permanent approach. Hold lifted.
- **S2-02 (flag)**: Locksmith has 6 concurrent io_auth ARCH-008 gate reviews. Bandwidth flag retained for scheduling. Not a block.
- **S2-03–S2-07**: No blocking cross-project overlap (<50% semantic overlap on all stories).

---

## v0.1 Release Gate Status (post-Sprint 2 planning)

| Condition | Description | Status |
|-----------|-------------|--------|
| SEC-14 | Branch protection | ✅ Done |
| SEC-15 | Secrets scanning (gitleaks/trufflehog) pre-commit + CI | ✅ Done |
| SEC-16 | Constant-time comparison audit — Locksmith sign-off | ⏳ S2-02 |
| SEC-17 | Per-primitive CVE scan (Trivy) | ✅ Done |
| SEC-18 | STRIDE threat model before v0.1 | ⏳ S2-03 |
| SEC-19 | Zero IO Labs internal references — CI enforced | ⏳ S2-04 |
| SEC-20 | Rate limiting documented | Deferred v1.0 |
| **Coordination Utilities** | Projects, tasks, crons primitives in OpenHiveOS | ⏳ **Sprint 3** |

**v0.1 ships at Sprint 3 close.** All security gates close at Sprint 2. Coordination Utilities land in Sprint 3.

---

## Action Items

| Action | Owner | Due |
|--------|-------|-----|
| Deliver ARCH-008 addendum (stdio env-token auth) | Silas | May 21 AM |
| Deliver OpenHiveOS DFD (4 data flows) | Silas | May 21 AM |
| Approve / amend Cooper's SEC-19 pattern list | Locksmith | May 23 |
| Confirm Obsidian vault absolute path | Cooper | May 23 |
| Assign SOP number for S2-07 | Elizabeth | Before S2-07 files |
| Schedule Locksmith capacity (io_auth vs S2-02/S2-03) | Elizabeth | May 21 |
| File ARCH-009 (Coordination Utilities schema design) | Silas | Before Sprint 3 Day 0 |
| Scope S2-08 (health agents field) into S2-01 PR | Murphy | Sprint 2 kickoff |
