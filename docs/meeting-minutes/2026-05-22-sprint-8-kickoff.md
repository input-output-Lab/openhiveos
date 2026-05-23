# Sprint 8 Kick-Off — Meeting Minutes

**Date:** 2026-05-22
**Facilitator:** Elizabeth
**Project:** OpenHiveOS
**Sprint:** 8
**Window:** 2026-05-24 → 2026-06-07

---

## Attendees

Richo (Founder/Integrator), Elizabeth (PM), Silas, Murphy, Cooper, Scout, Locksmith, Clarence, Nova

---

## Sprint Goal

> **An operator runs `./install.sh`, answers the questions, and has a fully working OpenHiveOS instance — SOPs loaded, company context available, agents connected to their harness of choice.**

---

## Sprint Health: 🟡

Achievable with risk. Three named risks on record:
1. S8-03 compression if ARCH-018 slips past Day 3
2. Cold install boot latency (100+ Gemini calls) — Murphy to measure in S8-02 PR
3. Node 22 + npm required on host — must be documented and checked at install.sh start

---

## Committed Stories

| Story | Owner | Size | DoR | Day 1 State |
|---|---|---|---|---|
| S8-00 ARCH-018: Company/V/TO schema + Ethos Seal extension + ARCH-003 C2+C3 closure | Silas | S | ✅ | OPENS DAY 1 |
| S8-01 Migration 008: `content_hash` + `source_namespace` on `sops` table | Murphy | S | ✅ | Awaiting Silas column ruling |
| S8-02 SOP ingest runner + boot step (Step 3.75) | Murphy | L | ✅ | Awaiting S8-01 + gray-matter ruling |
| S8-03 Company/V/TO ethos: manifest + env-var intake + Ethos Seal + `get_company_ethos` | Murphy | M | 🔴 BACKLOG | Gated on S8-00 |
| S8-04 Dockerfile multi-stage dashboard build | Cooper | M | ✅ | OPENS DAY 1 |
| S8-05a `install.sh` core flow | Cooper | M | ✅ | Skeleton opens Day 1; full WIP after S8-03 |
| S8-05b `install.sh` harness config generation | Cooper | M | 🟡 P2 | Conditional — after S8-05a DONE |
| S8-06 Tests: SOP ingest runner | Scout | M | ✅ | Opens after S8-02 DONE |
| S8-07 Tests: `install.sh` | Scout | M | ✅ | Opens after S8-05a DONE |
| S8-08 SEC review (staged) | Locksmith | S | ✅ | Surface 4 by Day 5 · Surfaces 1+2 by Day 9-10 |
| S8-09 Operator runbook rewrite | Clarence | S | ✅ | Opens Day 1; finalises after S8-05a |
| S8-10 P2 carry — `src/primitives/**` coverage | Scout | L | 🟡 P2 | Drops if S8-06 not in REVIEW by Day 9 |

---

## Locked Decisions

| Decision | Ruling | Source |
|---|---|---|
| Migration number | 008 — `008_sops_ingest_columns.sql` (007 slot already taken) | Silas DoR check |
| Boot position for SOP ingest | After `checkEthosSeal()`, before `resolveIdentity()` (Step 3.75) | Silas DoR check |
| `VITE_DASHBOARD_AGENT_TOKEN` in Docker ARG | ACCEPTABLE — token is baked into JS bundle; ARG adds no marginal attack surface | Locksmith (binding) |
| install.sh chicken-and-egg | Path A: host `npm run dashboard:build` + bind mount `./dist/dashboard`; S8-04 Dockerfile stage = distribution builds only | Cooper |
| install.sh idempotency | Prompt to overwrite if `.env` exists; fail-fast on any step failure | Elizabeth |
| Harness container name | `docker compose exec -i mcp` — never hardcode `openhiveos-mcp-1` | Clarence |
| Ethos Seal breaking change (S8-03) | All existing installs require `one-init.ts --revise` after deploying S8-03. Document in runbook | Silas |

---

## Security Conditions — Binding Merge Gates

| Condition | Merge Gate |
|---|---|
| SEC-D1: gitleaks covers `VITE_DASHBOARD_AGENT_TOKEN` | S8-04 + S8-05a |
| SEC-D2: CI masks token in pipeline logs | S8-04 |
| SEC-D3: `docker history` exposure documented in operator security notes | S8-04 |
| SEC-D4: install.sh uses `printf '%s\n'` for secret writing — no unquoted expansion | S8-05a |
| SEC-D5: Ingest runner logs `source_path` per SOP; runbook includes prompt injection warning | S8-02 |

---

## Dependency Sequence

```
Day 1     ARCH-003 C2+C3 pre-filed (Silas, pre-condition)
          S8-00 WIP · S8-04 WIP · S8-05a skeleton WIP · S8-09 WIP

Day 1-2   Silas: column ruling + gray-matter ruling → S8-01 WIP

Day 2-3   S8-00 closes → S8-03 unblocked
          S8-01 closes → S8-02 WIP

Day 3     Cooper delivers install.sh draft to Locksmith for Surface 4 review

Day 5     S8-08 Surface 4 sign-off → S8-05a steps 6-11 proceed

Day 5-8   S8-02 delivers → S8-06 WIP (Scout)

Day 7     S8-03 closes → S8-05a completes

Day 8-10  S8-05a integration on test server · S8-06 delivers · S8-07 WIP

Day 9-10  S8-08 Surfaces 1+2 sign-off → S8-02 + S8-03 merge ready
          S8-04 merges (SEC-D1/D2/D3 verified) · S8-09 finalises

Day 12    S8-07 delivers · S8-05a merges

Day 12-14 Buffer + S8-10 P2 + S8-05b P2 if capacity
```

---

## Day 1 Orders

**Silas:**
1. File ARCH-003 C2+C3 addendums (pre-condition)
2. Open ARCH-018 — lock company block schema and Ethos Seal extension contract
3. Issue column ruling: `source_namespace TEXT` vs `is_core BOOLEAN` (reconcile ARCH-009)
4. Issue gray-matter ruling: approve as runtime dep or require inline parser?
5. Clarify ARCH-013 cross-repo gate: does `get_company_ethos` require a parallel tool in opensquad-mcp-server?

**Murphy:**
- Hold on S8-01 until Silas issues column ruling
- Prepare codebase audit: locate every `checkEthosSeal()` / `resolveIdentity()` reference to confirm boot position

**Cooper:**
- S8-04: Start multi-stage Dockerfile (ARG pattern, outDir fix)
- S8-05a: Build scaffold — steps 1-4 (company prompts, API key prompts) and step 11 (docker compose up) are buildable without S8-03
- Confirm test server availability for Day 5 (2026-05-28) by end of Day 1

**Scout:**
- No WIP Day 1 — review S8-02 and S8-05a ACs; prepare test strategy for each

**Locksmith:**
- No WIP Day 1 — await Cooper's install.sh draft by Day 3 for Surface 4 review

**Clarence:**
- S8-09: Open runbook rewrite; draft structure using harness specs already in hand
- Sync harness config spec with Cooper (confirm which paths will be documented)

---

## Action Items

| Action | Owner | Due |
|---|---|---|
| File ARCH-003 C2+C3 addendums | Silas | 2026-05-24 |
| Issue source_namespace vs is_core column ruling | Silas | 2026-05-25 |
| Issue gray-matter dependency ruling | Silas | 2026-05-25 |
| Clarify ARCH-013 cross-repo gate | Silas | 2026-05-25 |
| Confirm `provision-agent-token.js` stdout is clean (one line only) | Murphy | 2026-05-27 |
| Confirm test server available Day 5 | Cooper | 2026-05-24 |
| Align harness config format spec | Clarence + Cooper | 2026-05-27 |
| Locksmith sign-off on Claude Desktop literal token pattern | Locksmith | 2026-05-30 |
| Schedule Pre-S9A dashboard product strategy session | Elizabeth | 2026-06-01 |
| `git tag v0.4.0 && git push origin v0.4.0` | Richo | PENDING |

---

## Pre-Sprint 9 Gates (Sequential)

1. **Pre-S9A:** Dashboard product strategy session — Rocket + Richo + Nova + Elizabeth. Output: operator dashboard product requirements doc → Sprint 9 backlog input.
2. **Pre-S9B:** The One architecture session — Silas leads (Silas, Murphy, Locksmith, Rocket). Input: Pre-S9A output. Output: ARCH-019. Sprint 9 scope derives from ARCH-019.

Sprint 9 does not open until both gates are closed.

---

*Minutes closed: 2026-05-22 | Published within 24h of session*
