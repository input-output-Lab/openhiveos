# Meeting Notes — OpenSquad → OpenHiveOS Transition Alignment Check

**Date:** 2026-05-24
**Project:** OpenHiveOS
**Participants:** Elizabeth, Murphy, Rocket, Clarence, Cooper, Locksmith, Silas
**Facilitator:** Elizabeth
**Status:** 🟡 Sprint 9 delivery on track. Public repo publish gate: 🔴 BLOCKED.

---

## Objective

Confirm the completeness and security readiness of the OpenSquad → OpenHiveOS naming transition before Sprint 9 opens and assess whether the codebase is cleared for public repository publish.

## Pre-Mortem

*"Imagine it is 2026-06-06 and the transition failed. Why did it happen?"*

- **Murphy:** We shipped Sprint 9 features on top of stale ARCH-004 grant scope and never verified the deferred FK constraint state post-009. The infra layer silently broke and we found out in production.
- **Rocket:** We renamed the user-facing strings but shipped `squadApi.ts` unrenamed into the public repo. The brand debt became permanent because no one owned the PR review gate.
- **Clarence:** We published the public repo before the prose audit was complete. ARCH-001 and ARCH-002 had no frontmatter. Operators read contradictory naming in the docs and trusted neither version.
- **Cooper:** The PM2 process `opensquad-mcp` was still running under the old name when the public repo went live. DB role `opensquad_app` was never migrated — a text-replace was attempted instead of a proper migration and we lost access to production data.
- **Locksmith:** The token remediation was deferred past the publish gate. The migration script was already public. Any operator with access to the repo computed agent tokens in under five minutes.
- **Silas:** Track owners were assigned but the five minimum publish conditions were never formally tracked as sprint items. The gate was assessed informally and failed.

---

## Discussion

### Elizabeth (Opening)

Sprint 9 opens in two days. This meeting has one job: confirm what is done, name what is not, assign every gap an owner and a date, and formally establish the public repo publish gate status. We will close with five decisions minimum. Every open item leaves this room with a name and a date on it.

### Murphy

Two structural gaps remain in the architecture layer. `ARCH-004` still lists stale `factory_*` table names in the `openbridge_app` grant scope body — the canonical boundary between `factory_*` (opensquad-mcp-server layer only) and OpenHiveOS tables is not documented in `coordination-utilities-reference.md`. Separately, the deferred FK constraint state on `memories.task_id` and `thoughts.task_id` has not been verified post-migration `009`. Murphy proposes two Sprint 9 tasks to close both gaps.

### Rocket

No user-visible "OpenSquad" strings remain in the dashboard — that check is clean. However, three views (`InboxView`, `AgentsView`, `EthosSealView`) contain the phrase "this Squad instance" — a live brand defect that can be patched without a sprint story. The internal layer carries a second category of debt: `squadApi.ts`, `SquadApiError`, and `VITE_SQUAD_API_URL` all carry the `squad` prefix. Renaming `squadApi.ts` → `hiveApi.ts` is a zero-logic change but requires a Scout PR review gate and `VITE_SQUAD_API_URL` requires Cooper coordination before the rename ships.

### Clarence

Documentation health is mixed. `README.md`, `ARCH-006`, and the frontmatter on `ARCH-004/5/6` are clean. `ARCH-003` has one wrong line (line 4) — a single-line fix. `ARCH-001` and `ARCH-002` have no frontmatter at all. `00-inception.md` contains six prose references that fall outside the scope defined in `ARCH-007` and must be resolved before public publish. A body-level prose audit across the full `docs/` tree is required before the public repo gate opens.

### Cooper

Infrastructure naming is mostly clean. Compose container names and DNS are confirmed correct. The outstanding risk is the PM2 process `opensquad-mcp` on production — it is currently stopped and must be renamed before Sprint 9 opens (2026-05-26). The DB role `opensquad_app` is a live Postgres artifact and requires a formal migration (not a text replace) to `openhiveos_app`. `.env.example` contains stale references that need correcting. `VITE_SQUAD_API_URL` rename requires a joint Cooper + Rocket sync before it ships.

### Locksmith

**Blocking finding.** `009_opensquad_cutover.sql` uses MD5 placeholder token hashes with deterministic slug-based input. Anyone who holds the migration script can compute any agent's token. This is not a theoretical risk — it is a mechanical vulnerability. Per-agent CLI reprovisioning is unconfirmed. `ARCH-004` `SEC-1` through `SEC-8` are all still Open with no closure evidence on record. `ARCH-016` `SEC-D1–D11` have not been reviewed; `SEC-D3` (log token redaction, token as query param) carries the highest individual risk. This system is **not cleared for external operator deployment.** The publish gate is formally blocked.

### Silas (Closing Technical Voice)

P2 was previously unscoped and has now been defined across five parallel tracks: (A) Token remediation — MD5 → SHA-256 in `009`, per-agent CLI reprovisioning confirmed; (B) `ARCH-004` grant scope correction + SEC-3 closure with Silas confirmation; (C) Repo rename and infra cleanup — PM2 rename, DB role migration; (D) Docs prose audit and `ARCH-016` Locksmith review; (E) `ARCH-004` SEC-1–8 formal closure or risk-acceptance with evidence. Tracks B and C can run in parallel with A and E. The honest timeline: if Track A and Track E complete within Sprint 9, the publish gate will be assessed at sprint close (2026-06-06); if either slips, the gate assessment moves to Sprint 10.

---

## Decisions

| # | Decision | Owner | Due Date |
|---|---|---|---|
| D-1 | Public repo publish gate is formally **BLOCKED**. Five minimum conditions must be met before gate is reassessed. Gate keeper: Silas. | Silas | Assessed at Sprint 9 close — 2026-06-06 |
| D-2 | Token remediation (Track A): `009_opensquad_cutover.sql` MD5 placeholder tokens replaced with SHA-256. Per-agent CLI reprovisioning confirmed before migration ships. | Silas + Locksmith | 2026-06-04 |
| D-3 | PM2 process `opensquad-mcp` on production renamed before Sprint 9 opens. | Cooper | 2026-05-26 |
| D-4 | DB role `opensquad_app` migrated to `openhiveos_app` via a new formal Postgres migration — not a text replace. Migration tested in staging before production apply. | Cooper + Silas | 2026-06-04 |
| D-5 | `ARCH-004` grant scope body corrected (stale `factory_*` names removed) and `coordination-utilities-reference.md` updated with canonical boundary documentation. | Murphy + Silas | 2026-06-04 |
| D-6 | `ARCH-001` and `ARCH-002` frontmatter added. `ARCH-003` line 4 corrected. | Clarence | 2026-05-28 |
| D-7 | Full body-level prose audit of `docs/` tree completed. `00-inception.md` six out-of-scope references resolved. | Clarence | 2026-06-04 |
| D-8 | `ARCH-004` SEC-1–8 formally closed with evidence or risk-accepted with written rationale (Track E). Owner confirms per-item. | Locksmith + Silas | 2026-06-04 |
| D-9 | `ARCH-016` SEC-D1–D11 reviewed by Locksmith. SEC-D3 (token as query param, log redaction) closed or escalated as blocking. | Locksmith | 2026-06-04 |
| D-10 | `squadApi.ts` → `hiveApi.ts` rename (zero-logic) submitted as a standalone PR with Scout review gate. `VITE_SQUAD_API_URL` rename coordinated between Rocket and Cooper in the same PR. | Rocket + Cooper | 2026-05-30 |
| D-11 | User-visible "this Squad instance" strings patched in `InboxView`, `AgentsView`, and `EthosSealView` immediately — no sprint story required. | Rocket | 2026-05-27 |
| D-12 | `.env.example` stale references corrected. | Cooper | 2026-05-27 |
| D-13 | Deferred FK constraint state on `memories.task_id` and `thoughts.task_id` verified post-`009`. Result documented. | Murphy | 2026-05-29 |

---

## Action Items

- [ ] Rename PM2 process `opensquad-mcp` on production to `openhiveos-mcp` before Sprint 9 opens — **Owner:** Cooper — **Due:** 2026-05-26
- [ ] Patch "this Squad instance" in `InboxView.vue`, `AgentsView.vue`, `EthosSealView.vue` — **Owner:** Rocket — **Due:** 2026-05-27
- [ ] Correct `.env.example` stale `opensquad` references — **Owner:** Cooper — **Due:** 2026-05-27
- [ ] Add frontmatter to `ARCH-001` and `ARCH-002`; fix `ARCH-003` line 4 — **Owner:** Clarence — **Due:** 2026-05-28
- [ ] Verify deferred FK constraint state on `memories.task_id` and `thoughts.task_id` post-`009`; document result — **Owner:** Murphy — **Due:** 2026-05-29
- [ ] Submit `squadApi.ts` → `hiveApi.ts` rename PR (includes `VITE_SQUAD_API_URL` rename); tag Scout for review gate — **Owner:** Rocket (Rocket + Cooper joint for env var) — **Due:** 2026-05-30
- [ ] Draft DB role migration `010_rename_app_role.sql`: `opensquad_app` → `openhiveos_app`; test in staging — **Owner:** Cooper — **Due:** 2026-06-02
- [ ] Correct `ARCH-004` grant scope body (remove stale `factory_*` names); update `coordination-utilities-reference.md` with canonical boundary doc — **Owner:** Murphy — **Due:** 2026-06-04
- [ ] Complete full body-level prose audit of `docs/` tree; resolve six out-of-scope references in `00-inception.md` — **Owner:** Clarence — **Due:** 2026-06-04
- [ ] Deliver `ARCH-016` SEC-D1–D11 review; close or escalate SEC-D3 (token query param + log redaction) — **Owner:** Locksmith — **Due:** 2026-06-04
- [ ] Close `ARCH-004` SEC-1–8 with evidence or file written risk-acceptance per item — **Owner:** Locksmith + Silas — **Due:** 2026-06-04
- [ ] Complete token remediation: replace MD5 tokens in `009` with SHA-256; confirm per-agent CLI reprovisioning works — **Owner:** Silas + Locksmith — **Due:** 2026-06-04
- [ ] Apply production DB role migration (`opensquad_app` → `openhiveos_app`) after staging test clears — **Owner:** Cooper + Silas — **Due:** 2026-06-05
- [ ] Assess publish gate at Sprint 9 close; issue formal go/no-go with written rationale — **Owner:** Silas — **Due:** 2026-06-06
- [ ] File Sprint 9 backlog tasks for Murphy items: (1) canonical boundary doc, (2) FK constraint verification — **Owner:** Elizabeth — **Due:** 2026-05-26

---

## Issues for Next L10 IDS

| Issue | Raised By | Priority |
|---|---|---|
| `009_opensquad_cutover.sql` MD5 tokens with deterministic inputs — token compromise risk for all agents | Locksmith | P0 — Sprint 9 |
| `ARCH-004` SEC-1–8 all Open, no closure evidence filed | Locksmith | P1 — Sprint 9 |
| `ARCH-016` SEC-D1–D11 not reviewed; SEC-D3 highest risk | Locksmith | P1 — Sprint 9 |
| Per-agent CLI reprovisioning unconfirmed | Locksmith | P1 — Sprint 9 |
| `opensquad_app` DB role live in production — rename requires migration, not text replace | Cooper | P1 — Sprint 9 |
| PM2 process `opensquad-mcp` still running under old name on production | Cooper | P1 — before Sprint 9 opens |
| `ARCH-001` / `ARCH-002` missing frontmatter entirely | Clarence | P2 — Sprint 9 |
| `00-inception.md` six prose references outside `ARCH-007` scope — must resolve before publish | Clarence | P2 — Sprint 9 |
| `ARCH-004` grant scope body lists stale `factory_*` table names — boundary not documented | Murphy | P2 — Sprint 9 |
| Deferred FK constraints on `memories.task_id` / `thoughts.task_id` not verified post-`009` | Murphy | P2 — Sprint 9 |
| `squadApi.ts` / `VITE_SQUAD_API_URL` carry `squad` prefix — DX debt blocks clean public publish | Rocket | P2 — Sprint 9 |
| SEC-3 (`openbridge_app` scope) — Silas confirmation never formally received and recorded | Silas | P2 — Sprint 9 |

---

## Elizabeth's Closing Note

The Sprint 9 delivery goal — squad-api read routes and the dashboard SPA — is intact and proceeds on schedule. That is the good news. The unambiguous news is this: Locksmith has issued a formal block on public repo publish, and it is correct. We do not publish a repository where a migration script allows any reader to compute any agent's token. That is not a theoretical concern — it is a mechanical one, and it does not care about our sprint timeline. Five tracks are defined, every track has an owner, and the gate will be assessed honestly at Sprint 9 close on June 6th. If Tracks A and E are complete, Silas opens the gate. If they are not, we publish in Sprint 10 — and that is the acceptable outcome. The most important thing to keep in focus: **token remediation and SEC closure are not background tasks**. They are the sprint's second critical path, running alongside the dashboard build. Cooper's PM2 rename happens before Tuesday. Everything else follows its date.

---

*Filed by Elizabeth — 2026-05-24*
*Next L10: Sprint 9 Day 1 standup — 2026-05-26*
