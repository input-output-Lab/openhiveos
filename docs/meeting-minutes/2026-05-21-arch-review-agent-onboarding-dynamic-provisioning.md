---
title: "ARCH-014 — Arch Review: Agent Onboarding + Dynamic Provisioning"
date: 2026-05-21
updated: 2026-05-21
author: "Elizabeth"
type: meeting-minutes
tags:
  - type/meeting-minutes
  - project/openhiveos
  - domain/architecture
  - domain/backend
  - domain/devops
  - domain/security
  - audience/technical
---

# ARCH-014 Arch Review — Agent Onboarding + Dynamic Provisioning

**Date:** 2026-05-21
**Facilitator:** Elizabeth
**Protocol:** arch-review.prompt.md
**ADR filed:** [ARCH-014](../ARCH-014-agent-onboarding-dynamic-provisioning.md)

---

## Attendees

| Seat | Agent | Role |
|---|---|---|
| Facilitator / PM | Elizabeth | Problem framing, meeting ownership, action items |
| Systems Architect | Silas | Options proposal (Step 2), Decision matrix (Step 4) |
| Backend | Murphy | Cross-seat review (Step 3) |
| Frontend | Rocket | Cross-seat review (Step 3) |
| DevOps | Cooper | Cross-seat review (Step 3) |
| Cross-project | Nova | Cross-seat review (Step 3) |
| Documentation | Clarence | Cross-seat review (Step 3), ADR authorship (Step 5) |
| Security | Locksmith | Final binding review (Step 3) |

---

## Agenda

1. Problem framing (Elizabeth)
2. Options proposal (Silas)
3. Cross-seat review: Murphy → Rocket → Cooper → Nova → Clarence → Locksmith
4. Decision matrix synthesis (Silas)
5. ADR authorship (Clarence)
6. Memory sync + action items (Elizabeth)

---

## Problem Statement

OpenHiveOS has a token-based agent identity system (ARCH-001, ARCH-008) in which each MCP process authenticates via an `AGENT_TOKEN` env var. Provisioning today means an Operator manually runs `provision-agent-token.ts --agent <slug>` per agent — one-at-a-time, undiscoverable, no batch path, no `--revoke` flag, no Ethos Seal prerequisite gate. ARCH-014 designs the end-to-end onboarding pipeline: from `squad.manifest.json` declaration to fully operational MCP process, with the Ethos Seal as the constitutional gate.

---

## Key Decisions

**D1 — Option B selected unanimously (5/5 seats + Locksmith approved).**
Sibling script `provision-all-agents.ts` + targeted additions to `provision-agent-token.ts`. Docker Compose `provision` init-profile service (Stage 2 of canonical operator onboarding sequence). `--write-env` mandatory for `--all` runs. Option A permanently blocked (OWASP A02). Option C deferred to v0.3.
*Owner: Silas + Murphy. Effective: 2026-05-21.*

**D2 — SHA-256 is correct. ARCH-014 brief was wrong; the code is right.**
`token_hash` stores SHA-256+salt hashes, not bcrypt. SHA-256 is the correct algorithm for 256-bit CSPRNG token output — bcrypt adds cost with no security gain. ADR text corrected. No code changes required. (SEC-C1.)
*Owner: Clarence (ADR text) + Locksmith (confirmed).*

**D3 — `ON CONFLICT DO NOTHING` is the required default batch upsert.**
The batch `--all` path MUST use `INSERT ... ON CONFLICT (slug) DO NOTHING`. Token rotation requires explicit `--force-rotate` flag. Batch rotation requires `--force-rotate --confirm` (or interactive y/N prompt defaulting to N). Unconditional batch rotation is blocked — it is an accidental production DoS. (SEC-C2.)
*Owner: Murphy.*

**D4 — `--write-env` is mandatory (not optional) for `--all` runs.**
`process.exit(1)` if `--all` is passed without `--write-env`. Option A blocked because batch stdout = OWASP A02 = secrets in Docker logs. `PROVISION_ENV_DIR` env var is the required allowlist root for path validation. (SEC-C3, SEC-C4.)
*Owner: Murphy + Cooper (.env.example entry).*

**D5 — DB sentinel gate enforces `one-init` → `provision` ordering.**
Docker Compose `depends_on` cannot express the ordering between two `run --rm` init-profile invocations. Resolution: `provision-all-agents.ts` queries `SELECT 1 FROM ethos_seals WHERE is_active = TRUE` as its first DB operation. Zero rows → `process.exit(1)` with message to run `one-init` first. Fail-closed: PostgreSQL error 42P01 also exits 1. (SEC-C5.)
*Owner: Murphy.*

**D6 — `dashboard` is excluded from batch provisioning.**
The `dashboard` principal (ARCH-012) is NOT in `squad.manifest.json` — it is provisioned separately via `provision-agent-token.ts dashboard`. The batch script must have an explicit exclusion guard and a printed reminder. (Murphy finding.)
*Owner: Murphy.*

**D7 — Shared upsert function extracted to `src/auth/upsert-agent.ts`.**
Both `provision-agent-token.ts` and `provision-all-agents.ts` import from this shared module. Prevents logic drift between the two scripts (Ethos Seal gate query, upsert SQL, hash generation). Murphy's amendment.
*Owner: Murphy.*

**D8 — Canonical Operator Onboarding Sequence declared (v0.2+).**
Stage 1: `docker compose --profile init run --rm one-init` (Ethos Seal, ARCH-013). Stage 2: `docker compose --profile init run --rm provision --write-env .env.tokens` (Agent Tokens, ARCH-014). Stage 3 (separate): `npx tsx scripts/provision-agent-token.ts dashboard`. This sequence is the OpenHiveOS v0.2+ operator standard. Not retrofitted to opensquad-mcp-server (Nova ruling).
*Owner: Clarence (documentation), Cooper (Compose).*

**D9 — `provision-all-agents.ts` is spawn-protocol Phase 3.**
`provision-all-agents.ts` implements Phase 3 (Emanation — agent into operational DB state) of the spawn-protocol. Any revision to `spawn-protocol.md` must trigger an audit of both `one-init.ts` (Phases 1+2) and `provision-all-agents.ts` (Phase 3). This binding must be added to `spawn-protocol.md`. (Nova finding, Action C15.)
*Owner: Clarence (spawn-protocol update).*

---

## Seat Inputs Summary

### Murphy (Backend)
- **Critical finding 1 — SHA-256 vs bcrypt:** The ARCH-014 brief incorrectly stated bcrypt. The actual implementation uses `createHash('sha256')` with per-row salt. Locksmith confirmed SHA-256 is correct. ADR text must be corrected; no code changes.
- **Critical finding 2 — Unconditional rotation risk:** The existing upsert SQL `ON CONFLICT DO UPDATE` rotates ALL active tokens unconditionally. A batch `--all` run would invalidate every live MCP process token simultaneously — all enter the grace window at once. Fix: `ON CONFLICT DO NOTHING` as default; `--force-rotate` explicit opt-in; `--force-rotate --confirm` for batch.
- **Critical finding 3 — `dashboard` exclusion:** `dashboard` is in `agents` table but NOT in `squad.manifest.json`. Batch script must exclude it explicitly with a printed reminder.
- Recommendation: **Option B** with `rotateIfActive` guard and shared `src/auth/upsert-agent.ts` function.

### Rocket (Frontend)
- Option A: Hard blocker. Without reliable provisioning, the Dashboard agent roster cannot be trusted. Missing rows are invisible — the Dashboard doesn't know what it doesn't know.
- Option B: Unlock. `GET /api/agents` becomes reliably complete. Agent roster table (name, active, last_rotation, token age indicator) becomes buildable.
- Ethos Seal gate UX: agents view must check `GET /api/ethos-seal` for `activated_at` and display a contextual banner if null: *"Agent provisioning requires an active Ethos Seal."*
- Recommendation: **Option B**. Option A is a hard blocker for Dashboard integrity.

### Cooper (DevOps)
- **Ordering problem resolution:** `depends_on` cannot express the `one-init` → `provision` ordering because both are `run --rm` init-profile services, not persistent services. Resolution: DB sentinel gate inside `provision-all-agents.ts` — `SELECT 1 FROM ethos_seals WHERE is_active = TRUE` at script start. Zero rows → exit 1 with operator-facing message. This enforces the ordering in code, not in the Compose graph.
- **Secret output model:** `--write-env` is the correct answer regardless of which option is chosen. Docker `run` stdout is capturable but not structured — operator copy-paste at 10 tokens is an operational risk. File output at `0o600` with `PROVISION_ENV_DIR` allowlist is the production-safe model.
- **PRE-A1 is a hard gate for ARCH-014**, not just ARCH-013. The Ethos Seal DB sentinel gate depends on `ethos_seals` existing — which depends on the migrate gate being fixed first.
- Recommendation: **Option B with `--write-env` backported**.

### Nova (Cross-project)
- No opensquad-mcp-server update needed. OpenHiveOS provisions against its own `agents` table independently.
- Init-profile pattern should be documented as OpenHiveOS v0.2+ standard. Do NOT retrofit to opensquad-mcp-server.
- **PRE-A1 escalation:** The migrate gate bug is now blocking ARCH-014 (not just ARCH-013). It must be resolved before either ARCH ships a batch path.
- **SPIKE #250 checkpoint:** When SPIKE #250 (peer-agent auth) closes, compare its token contract against ARCH-014's confirmed SHA-256 format before either goes to production.
- **spawn-protocol Phase 3 binding:** `provision-all-agents.ts` is Phase 3 of the spawn-protocol. This binding must be explicitly declared in the ADR and in `spawn-protocol.md` (Action C15 from ARCH-013 should be extended).
- Recommendation: **Option B with `--write-env` backported**.

### Clarence (Documentation)
- Script is referenced in 7 confirmed file locations: ARCH-001 (2×), ARCH-008, ARCH-013, `docs/glossary.md`, `.env.example`, `src/config.ts`.
- If Option C is chosen, minimum mandatory documentation set before legacy script deletion: `--help` text, operator runbook section, onboarding guide update, glossary update, and ARCH-014 ADR filed and linked.
- Recommendation: **Option B** (short-term cleanest). Would accept Option C only with a hard-gated deprecation sprint.

### Locksmith (Security — binding)
- **Option A: PERMANENTLY BLOCKED.** Batch stdout = OWASP A02:2021 Cryptographic Failures. Secrets in Docker logs. No conditions under which this is unblocked for batch runs.
- **Option B: APPROVED.** With SEC-C1 through SEC-C8 satisfied.
- **Option C: Not blocked. Deferred to v0.3** with explicit re-evaluation criteria (Vault integration, structured JSON consumption by a downstream system).
- Issued 8 binding conditions (SEC-C1 through SEC-C8) — see ADR Security Review section.

---

## Named Seat Disagreements

**None.** All seats converged independently on Option B. Option A was ruled out by Murphy (unconditional rotation risk), Rocket (Dashboard integrity), and Locksmith (OWASP A02) before Locksmith's formal review. Option C was independently deferred by every seat due to the breaking rename cost and SERIALIZABLE complexity not justified at current scale.

---

## Open Questions

| # | Question | Owner | Target |
|---|---|---|---|
| OQ-1 | `expires_at` enforcement: does activation require a migration (`SET NOT NULL`) or is the column already present with correct defaults? | Murphy | v0.3 tech debt |
| OQ-2 | SPIKE #250 checkpoint: does peer-agent auth change the token format in a way that affects ARCH-014 tokens? | Silas | When SPIKE #250 closes |
| OQ-3 | Automated rotation reminders (cron-based, 90-day advisory) — Sprint 3 backlog item? | Elizabeth | Sprint 3 grooming |

---

## Action Items

| # | Task | Owner | Gate |
|---|---|---|---|
| C1 | Confirm PRE-A1 (ARCH-013 #1355) is in progress — this is now a prerequisite for ARCH-014 as well | Murphy | Hard gate — before batch path ships |
| C2 | Extract shared `src/auth/upsert-agent.ts` — token generation, Ethos Seal gate query, upsert SQL (two paths: provision-new / force-rotate) | Murphy | Before C3 and C4 |
| C3 | Add `--revoke <slug>` to `provision-agent-token.ts` with Ethos Seal gate and `UPDATE active = false` (no DELETE) | Murphy | SEC-C7 |
| C4 | Author `scripts/provision-all-agents.ts` — reads manifest, Ethos Seal DB sentinel gate (fail-closed on 42P01), `ON CONFLICT DO NOTHING` default, `--force-rotate` + `--confirm` for rotation, `--write-env` mandatory on `--all`, `PROVISION_ENV_DIR` path validation (4 checks), `dashboard` exclusion guard + printed reminder | Murphy | SEC-C2, C3, C4, C5 |
| C5 | Add `provision` Docker Compose init-profile service — `profiles: ["init"]`, depends on postgres (healthy) + migrate (completed_successfully), `PROVISION_ENV_DIR` bind mount, `--write-env` invocation in the service command | Cooper | After C4 |
| C6 | Add `PROVISION_ENV_DIR` to `.env.example` with inline security comment | Cooper | SEC-C4 |
| C7 | Dashboard agents view: implement agent roster table (name, active, last_rotation, token age); add Ethos Seal gate banner (show if `activated_at` is null) | Rocket | After ARCH-012 A5/A6 (dashboard scaffold) |
| C8 | Confirm `UNIQUE` constraint on `agents.token_hash` in migration; file addendum migration if missing | Murphy | SEC-C8 |
| C9 | Update `spawn-protocol.md` to declare Phase 3 binding: `provision-all-agents.ts` implements Phase 3 (Emanation). Any spawn-protocol change must audit `one-init.ts` AND `provision-all-agents.ts` | Clarence | Action C15 from ARCH-013 extended |
| C10 | `--help` text on both scripts: SEC-C6 requirements (chmod 600 instruction, lost-token recovery note, `--all` requires `--write-env`) | Murphy | SEC-C6 |
| C11 | Locksmith SEC gate review: SEC-C1 through SEC-C8 all satisfied before any ARCH-014 code merges to main | Locksmith | Final merge gate |
| C12 | Author `docs/08-agent-onboarding.md` operator runbook: canonical onboarding sequence (Stage 1, 2, 3), rotation, revocation, `--dry-run` verification, troubleshooting entries (token not accepted, `--write-env` permission denied, agent slug not in manifest) | Clarence | Before Sprint 3 closes |
| C13 | Update `docs/ARCH-001-server-resolved-agent-identity.md` to reference the new canonical provisioning commands | Clarence | After C4 merges |
| C14 | Update `docs/glossary.md` — Agent Token definition updated; confirm `provision-agent-token.ts` reference is accurate for v0.2 | Clarence | Before Sprint 3 closes |
| C15 | SPIKE #250 checkpoint task: when SPIKE #250 closes, Elizabeth flags review of its token contract against ARCH-014's confirmed SHA-256 format | Elizabeth | When SPIKE #250 closes |

---

## Decision: Option B — Technical Specification

| Attribute | Value |
|---|---|
| Single-agent script | `scripts/provision-agent-token.ts` — adds `--revoke <slug>` and Ethos Seal gate |
| Batch script | `scripts/provision-all-agents.ts` — reads manifest, provisions all, `--write-env` mandatory |
| Shared module | `src/auth/upsert-agent.ts` — token generation, gate query, upsert SQL |
| Default batch upsert | `INSERT ... ON CONFLICT (slug) DO NOTHING` |
| Rotation | `--force-rotate` explicit; `--force-rotate --confirm` for batch |
| Secret output | `--write-env <path>` mandatory for `--all` — writes `0o600` env file |
| Path allowlist | `PROVISION_ENV_DIR` env var required; `path.resolve()` + prefix check |
| Ethos Seal gate | `SELECT 1 FROM ethos_seals WHERE is_active = TRUE`; fail-closed (42P01 caught) |
| `dashboard` handling | Excluded from batch loop; provisioned separately; printed reminder |
| Revoke | `UPDATE agents SET active = false, updated_at = NOW()` — no DELETE |
| Compose service | `provision` (profiles: ["init"]) — Stage 2 of canonical onboarding |
| Onboarding sequence | Stage 1: `one-init` → Stage 2: `provision --write-env` → Stage 3: `provision-agent-token.ts dashboard` |
| Hash scheme | SHA-256 + per-row salt — confirmed correct; bcrypt NOT used |
| Token format | `<32-hex-salt>.<64-hex-secret>` — ARCH-008 confirmed, unchanged |
| spawn-protocol binding | Phase 3 declared; audit required on any spawn-protocol change |

---

## Meeting Closed

**Result:** ARCH-014 decided. Option B — unanimously selected (5/5 seats + Locksmith approved). Option A permanently blocked. Option C deferred to v0.3. ADR filed at [docs/ARCH-014-agent-onboarding-dynamic-provisioning.md](../ARCH-014-agent-onboarding-dynamic-provisioning.md). 8 SEC conditions binding. PRE-A1 confirmed as a hard gate for both ARCH-013 and ARCH-014. 15 action items assigned.

*Minutes published by Elizabeth — 2026-05-21*
