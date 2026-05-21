---
title: "ARCH-013 — Arch Review: The One inside OpenHiveOS — Ethos Seal Storage, CLI Provisioning, Dashboard Surface"
date: 2026-05-21
updated: 2026-05-21
author: "Elizabeth"
type: meeting-minutes
tags:
  - type/meeting-minutes
  - project/openhiveos
  - domain/architecture
  - domain/backend
  - domain/frontend
  - domain/devops
  - domain/security
  - audience/technical
---

# ARCH-013 Arch Review — The One inside OpenHiveOS

**Date:** 2026-05-21
**Facilitator:** Elizabeth
**Protocol:** arch-review.prompt.md
**ADR filed:** [ARCH-013](../ARCH-013-the-one-ethos-seal.md)

---

## Pre-Session Ruling

**Richo (Founder) — Option S ruling:** `counter_thought` on `store_thought` remains optional. The Zero is constitutional in identity, advisory in infrastructure. No schema enforcement work required in ARCH-013.

---

## Attendees

| Seat | Agent | Role |
|---|---|---|
| Facilitator / PM | Elizabeth | Meeting ownership, Step 1 problem framing, action items |
| Systems Architect | Silas | Options (Step 2), Decision matrix (Step 4) |
| Backend | Murphy | Cross-seat review (Step 3) |
| Frontend | Rocket | Cross-seat review (Step 3) |
| DevOps | Cooper | Cross-seat review (Step 3) |
| Strategic / Cross-project | Nova | Cross-seat review (Step 3) |
| Security | Locksmith | Cross-seat review (Step 3), binding security ruling |
| Documentation | Clarence | ADR authorship (Step 5) |

---

## Agenda

1. Founder ruling on counter_thought enforcement (pre-session)
2. Problem framing (Elizabeth)
3. Options proposal (Silas)
4. Cross-seat review — all seats in parallel
5. Decision matrix synthesis (Silas)
6. ADR authorship (Clarence)
7. Memory sync + action items (Elizabeth)

---

## Key Decisions

**D1 — Option A selected unanimously (5/5 seats).**
DB-canonical `ethos_seals` table + CLI provisioning script (`one-init.ts`) + exported `ethos.seal.json` file. Options B and C blocked.
*Owner: Silas. Effective: 2026-05-21.*

**D2 — HMAC-SHA256 interim; Ed25519 required by v0.3.**
Signing scheme is symmetric HMAC-SHA256 for v0.2 only. Locksmith requires Ed25519 asymmetric signing by v0.3. Named in ADR as SEC-B1. Silas owns design; Murphy owns implementation.
*Owner: Silas + Murphy.*

**D3 — Boot integrity failure blocks boot.**
`process.exit(1)` with operator-facing error on drift. Degraded mode is not acceptable for a constitutional integrity failure. Cooper and Locksmith both independently required this. Named in ADR as SEC-B8.
*Owner: Murphy.*

**D4 — Migration numbering: `004_ethos_seal.sql`.**
ARCH-012 already owns `003_*`. Ethos seal migration must be `004`. Hard coordination gate with Murphy before PR opens.
*Owner: Murphy + Silas.*

**D5 — `GET /api/ethos-seal` defaults to metadata only.**
Full payload gated behind `?include=payload`. Payload must not appear in Morgan logs. Named in ADR as SEC-B7.
*Owner: Murphy.*

**D6 — `one-init` runs as a Compose init profile.**
`profiles: ["init"]` keeps it off the normal `docker compose up` path. Invoked: `docker compose --profile init run --rm one-init`.
*Owner: Cooper.*

**D7 — Dual-repo simultaneity required.**
`ethos_seals` schema must be built in `opensquad-mcp-server` and `openhiveos` simultaneously (Nova ruling). Silas owns canonical schema. No sequential implementation.
*Owner: Silas.*

**D8 — `counter_thought` stays optional.**
Richo ruling (Option S). No schema enforcement. The Zero is constitutional in identity, advisory in infrastructure.
*Owner: N/A — closed.*

---

## Seat Inputs Summary

### Murphy (Backend)
- Option A: Approved with 2 amendments.
- Amendment 1: `--revise` transaction pattern — `SERIALIZABLE` isolation OR `current_seal_id` singleton pointer table (cleaner for transition atomicity). Silas to decide before migration is written.
- Amendment 2: HMAC vs Ed25519 must be an explicit ADR sub-decision. If HMAC, `ETHOS_SEAL_SECRET` is long-lived high-value; rotation = re-seal event.
- Migration numbering conflict flagged: `003_*` taken by ARCH-012. Ethos seal must be `004_ethos_seal.sql`.
- Boot-time check: `checkEthosSeal()` in `src/db/ethos-seal.ts`, positioned between fingerprint (Step 3) and identity resolution (Step 4).
- squad-api: metadata by default, `?include=payload` for full content, payload not in Morgan logs.
- Options B and C: independently disqualified.

### Rocket (Frontend)
- Option A: Acceptable. `EthosSealView` = version badge, Five Laws as labeled prose blocks (Tailwind `prose`, `max-w-prose`), seat definitions table, version history (last 10, collapsed).
- Option B: Hard no — hash-only yields only a status chip; dedicated Dashboard route is wasted.
- Option C: Preferred from UX seat (revision stays in AI client, Dashboard remains read-only). Architecturally equivalent to A from display perspective. Preference noted; not a blocker.
- API note: version history must be capped at last 10 in endpoint response.

### Cooper (DevOps)
- Option A: Approved with 2 hard pre-conditions.
- **PRE-A1:** Migrate service gate must be updated. Current gate (check `agents` table exists) will silently bypass `004_ethos_seal.sql` on existing stacks.
- **PRE-A2:** Drift check behavior decided: block boot (`process.exit(1)`). Closed at ADR ratification.
- `one-init` Compose service: `profiles: ["init"]`, depends on postgres (healthy) + migrate (completed_successfully), bind-mount via `ETHOS_SEAL_PATH`.
- `ethos.seal.json`: host bind mount via `ETHOS_SEAL_PATH`. Must not be committed to VCS. Must not be a Docker named volume.
- New `.env.example` entries: `ETHOS_SEAL_SECRET`, `ETHOS_SEAL_PATH`.
- `ETHOS_SEAL_SECRET` rotation SLA: not defined — must be defined before v0.3. Rotation = re-seal event.

### Nova (Cross-project)
- Schema not yet built anywhere — no `ethos_seals` table exists in either `opensquad-mcp-server` or `openhiveos`. ARCH-013 is the first canonical implementation. **Must be built simultaneously in both repos.**
- The One authority question: CLI permits operators to author any Five Laws. spawn-protocol implies IO Labs as authority. This is a named governance gap (OQ-1, SEC-B10).
- `ETHOS_SEAL_SECRET` per-Squad keys are correct (no shared key needed). Key recovery protocol is absent — key loss = unbootable Squad with no recovery path. Named as OQ-2.
- spawn-protocol / CLI drift risk: no declared binding. ADR must state that `one-init.ts` implements spawn-protocol phases and must be audited on any spawn-protocol change. Named as OQ-5.
- Option A recommended. Options B and C ruled out.

### Locksmith (Security — binding)
- Options B and C: **BLOCKED.**
- Option A: **CONDITIONALLY APPROVED** — 10 binding merge gates.
- **SEC-B1:** Ed25519 migration commitment in ADR before ratification. HMAC-SHA256 interim only.
- **SEC-B2:** `ETHOS_SEAL_SECRET` — 256-bit CSPRNG minimum, unique per Squad, not reused.
- **SEC-B3:** `ETHOS_SEAL_SECRET` — env only, never in source control or image layers.
- **SEC-B4:** `ethos.seal.json` — in `.gitignore` and `.dockerignore`.
- **SEC-B5:** `--revise` path — `SERIALIZABLE` isolation only.
- **SEC-B6:** Boot-time check — `crypto.timingSafeEqual`, not string equality.
- **SEC-B7:** `GET /api/ethos-seal` — metadata default, payload behind `?include=payload`, payload not in logs.
- **SEC-B8:** Boot integrity failure — `process.exit(1)`. No degraded mode.
- **SEC-B9:** `ethos_seals` INSERT — CLI context only. No runtime API write path.
- **SEC-B10:** Content validation gap — must be explicitly risk-accepted by The One in ADR text.
- MCP server must NOT require `ETHOS_SEAL_SECRET` at runtime — boot check compares stored signatures, does not re-derive.

---

## Named Seat Disagreement (Non-Blocking)

**Rocket (UX) vs field on Option C:**
Rocket preferred Option C: revision stays in the AI client, Dashboard remains a pure read-only surface, no form complexity. This is a legitimate UX position. Option C is blocked by Locksmith (foundry token blast radius) and Murphy (bootstrapping circularity). Rocket accepts Option A as architecturally equivalent from the display perspective. The preference should inform Phase 2 revision UX design — when revision UI eventually comes to the Dashboard, it should follow the Emanation ceremony pattern Rocket described, not a simple text form.

---

## Open Questions (Documented in ADR — Non-Blocking)

| # | Question | Owner | Resolution Target |
|---|---|---|---|
| OQ-1 | The One Authority Question — operator authors own Laws vs IO Labs canonical Laws | The One | v0.3 — risk-accepted by The One in ADR text |
| OQ-2 | Key Recovery Protocol — key loss = unbootable Squad, no recovery path | Silas + Cooper | v0.3 |
| OQ-3 | `ETHOS_SEAL_SECRET` Rotation SLA | Silas + Locksmith | v0.3 |
| OQ-4 | Ed25519 migration commitment | Silas (design) + Murphy (impl) | v0.3 design kickoff |
| OQ-5 | spawn-protocol / CLI drift binding | Clarence + Silas | Named in ADR before implementation begins |
| OQ-6 | Dual-repo simultaneity (`ethos_seals` in both repos) | Silas | Implementation gate |

---

## Action Items

| # | Task | Owner | Gate |
|---|---|---|---|
| B1 | Fix migrate service gate: extend check to verify full migration sequence, not just `agents` table | Cooper + Murphy | PRE-A1 — before one-init can run |
| B2 | Create `004_ethos_seal.sql` migration — `ethos_seals` table + UNIQUE partial index. Silas to decide: partial index swap OR `current_seal_id` singleton pointer | Murphy | After Silas schema ruling on pointer vs index |
| B3 | Silas schema ruling: `ethos_seal_config` singleton pointer vs UNIQUE partial index for `--revise` atomicity | Silas | Before B2 |
| B4 | Author `scripts/one-init.ts` — readline CLI, HMAC-SHA256 signing, `SERIALIZABLE` revise path, file export, mirrors `provision-agent-token.ts` structure | Murphy | After B1 + B2 |
| B5 | Implement `checkEthosSeal()` in `src/db/ethos-seal.ts` — boot-time integrity check with `crypto.timingSafeEqual`, block boot on failure, clear operator error message | Murphy | SEC-B6, SEC-B8 |
| B6 | Add `one-init` Docker Compose service (`profiles: ["init"]`) with correct depends_on and volume bind | Cooper | After B2 |
| B7 | Update `.env.example`: add `ETHOS_SEAL_SECRET`, `ETHOS_SEAL_PATH` | Murphy | SEC-B2, SEC-B3 |
| B8 | Add `ethos.seal.json` to `.gitignore` and `.dockerignore` | Murphy | SEC-B4 |
| B9 | squad-api route `GET /api/ethos-seal` — metadata default, `?include=payload` gated, version history capped at 10, payload not in Morgan logs | Murphy | SEC-B7 |
| B10 | `EthosSealView` Vue 3 component — version badge, Five Laws prose blocks (Tailwind prose), seat definitions table, version history list (collapsed) | Rocket | After B9 |
| B11 | Locksmith SEC gate review (SEC-B1 through SEC-B10) before any ethos seal code merges to main | Locksmith | Final merge gate |
| B12 | Create `004_ethos_seal.sql` for `opensquad-mcp-server` simultaneously with openhiveos migration (OQ-6 Nova) | Silas (schema) + Murphy (impl both repos) | OQ-6 gate |
| B13 | The One formal risk acceptance for SEC-B10 (OQ-1 content validation gap) — written statement in ADR or linked document | The One | Before ADR ratification |
| B14 | File task: define `ETHOS_SEAL_SECRET` rotation SLA and key recovery protocol (OQ-2, OQ-3) | Silas + Locksmith | v0.3 planning |
| B15 | Declare binding between `one-init.ts` and `spawn-protocol.md` — add to ADR and spawn-protocol (OQ-5, Clarence) | Clarence | Before implementation begins |

---

## Decision: Option A — Technical Specification

| Attribute | Value |
|---|---|
| Storage | `ethos_seals` PostgreSQL table (payload JSONB, signature TEXT, is_active BOOLEAN) |
| Migration | `004_ethos_seal.sql` (after ARCH-012's `003_*`) |
| Write path | `scripts/one-init.ts` (CLI only, not MCP, not API) |
| Signing scheme | HMAC-SHA256 interim (v0.2). Ed25519 required v0.3 (SEC-B1) |
| Signing key | `ETHOS_SEAL_SECRET` (256-bit CSPRNG, env only, unique per Squad) |
| Export file | `ethos.seal.json` at `ETHOS_SEAL_PATH` (host bind mount, not VCS) |
| Boot check | `checkEthosSeal()` — `crypto.timingSafeEqual`, block boot on failure |
| Revise isolation | `SERIALIZABLE` |
| squad-api route | `GET /api/ethos-seal` — metadata default, `?include=payload` for full content |
| Dashboard | `EthosSealView` — read-only Phase 1, prose blocks, version history (last 10) |
| MCP tool | Deferred to Phase 2 (read-only `get_ethos_seal`) |
| Compose service | `one-init` (profiles: ["init"]) |
| counter_thought | Optional (Option S, Richo ruling) |
| ARCH-014 prereq check | `SELECT 1 FROM ethos_seals WHERE is_active = TRUE` — if zero rows, abort onboarding |

---

## Meeting Closed

**Result:** ARCH-013 decided. ADR filed at [docs/ARCH-013-the-one-ethos-seal.md](../ARCH-013-the-one-ethos-seal.md). All 10 SEC conditions binding. PRE-A1 is a hard gate. 15 action items assigned. ARCH-014 is unblocked — it has a defined prerequisite check.

*Minutes published by Elizabeth — 2026-05-21*
