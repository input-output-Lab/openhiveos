---
title: "ARCH-025 — The One Integration: Agent Files, Protocol SOPs, One Seal, and Emanation API"
date: 2026-06-30
updated: 2026-06-30
author: "Clarence"
owner: "Silas"
status: active
tags:
  - type/architecture
  - project/openhiveos
  - domain/backend
  - domain/security
  - domain/devops
  - domain/frontend
  - audience/technical
review_date: 2026-09-30
doc_id: "ARCH-025"
related:
  - "[[ARCH-008-openhiveos-founding-decisions]]"
  - "[[ARCH-009-sop-seeding-operator-onboarding]]"
  - "[[ARCH-012-squad-api-dashboard-architecture]]"
  - "[[ARCH-013-the-one-ethos-seal]]"
  - "[[ARCH-014-agent-onboarding-dynamic-provisioning]]"
---

# ARCH-025 — The One Integration: Agent Files, Protocol SOPs, One Seal, and Emanation API

*This ADR formalises The One's footprint inside OpenHiveOS: canonical agent file storage, protocol SOPs, a One Seal that protects those protocols from DB tampering at boot, a deploy script for operator harness setup, and REST API endpoints that lay the foundation for a Dashboard-based agent emanation surface. It supersedes the informal arrangement where The One existed only as an external flat file with no integrity guarantees.*

---

## ADR-ARCH-025

**Date:** 2026-06-30
**Project:** openhiveos
**Status:** Decided
**Decision Owner:** Silas
**Approved by:** Richo

---

**Context:**

The One is the constitutional authority for agent Emanation at Input Output Labs — it owns Seat Design, GWC Enforcement, Ethos Stewardship, V/TO Alignment, and Squad Coherence. Despite this central role, The One has had no protected footprint inside OpenHiveOS. Its operating contract (`one.agent.md`) lived exclusively as a flat file in the multi-agent pipeline repository, with no integrity check, no version guarantee, and no connection to the OS boot sequence.

Two failure modes have been observed:

1. **Agent file drift.** The One's `.agent.md` file and the files of the agents it emanates diverge from the canonical `AGENT-OUTLINE.md` specification over time. Manual edits accumulate. When new MCP tools are introduced or rules change, there is no single path to propagate the update — every agent file must be found and edited independently with no enforcement gate.

2. **Protocol drift.** The One's spawn protocol and the AGENT-OUTLINE spec exist only in the pipeline repository alongside the agent files. If those files are modified outside a formal review process, The One silently operates on stale or incorrect protocols. The OS has no awareness of this condition.

The Ethos Seal (ARCH-013) established a boot-time integrity pattern for the constitutional layer. ARCH-009 established SOP seeding as the mechanism for ingesting operator-defined process standards at boot. ARCH-012 established the squad-api Express server and Vue SPA as the Dashboard surface. All three primitives exist; what is missing is their application to The One's operational identity and protocols.

Additionally, the Dashboard has no surface for agent management. The One is currently accessible only through VS Code (via `.agent.md` file activation). The long-term intent is to host The One in the Dashboard so operators can emanate, validate, and review agents without leaving the OS interface.

This ARCH resolves: where The One's agent file lives, how its protocols are stored and protected, what the harness deploy path looks like, what boot-time integrity check applies, and what API surface is built now to support the eventual Dashboard emanation panel.

**Decision:**

Four-phase integration. The One is the only agent whose files are managed by OpenHiveOS. All other agents remain user-supplied and are not stored in this repository.

**Phase 1 — Agent Files and Protocol SOPs.**
A new `agents/` directory is created at the repository root. It contains exclusively The One's files: `agents/one.agent.md` (the canonical operating contract, sourced from the pipeline repo with AGENT-OUTLINE.md drift corrections applied) and `agents/one/` (the identity vault: `IDENTITY.md`, `SOUL.md`, `registry.md`, `ethos.md`, `vto.md`, `spawn-protocol.md`). Git version control is the integrity layer for these files. A new operator script, `scripts/one-deploy.ts`, deploys `agents/one.agent.md` and the `agents/one/` subdirectory to the operator's harness directory (`ONE_HARNESS_DIR` env var; default: `~/.copilot/agents/`) via atomic temp-file + rename. This is the only sanctioned path to install or update The One at the harness level. A new `seeds/sops/one/` directory is created with two SOP files following the existing YAML-frontmatter + markdown format: `spawn-protocol.md` (The One's agent emanation checklist) and `agent-outline.md` (the canonical agent specification: 8 required sections, frontmatter key order, 29-item approval checklist). Both SOPs auto-ingest at boot via the existing Step 3.75 (`runSopIngest`) and become queryable by The One at session start via `search_sops()`.

**Phase 2 — DB Migration.**
A new migration `021_one_seal.sql` creates the `one_seals` table: `id SERIAL PRIMARY KEY`, `signature TEXT NOT NULL` (HMAC-SHA256 hex over the content of the two One SOP seed files), `sealed_at TIMESTAMPTZ DEFAULT NOW()`, `sealed_by TEXT NOT NULL DEFAULT 'one-init'`, `is_active BOOLEAN NOT NULL DEFAULT TRUE`. A partial `UNIQUE INDEX` on `(is_active) WHERE is_active = TRUE` enforces at most one active seal, mirroring the `ethos_seals` convention from `004_ethos_seal.sql`.

**Phase 3 — One Seal Infrastructure.**
A new `one.seal.json` file at the repository root (analogous to `ethos.seal.json`) records the HMAC and seal timestamp. It is configured via `ONE_SEAL_PATH` env var (default: `process.cwd()/one.seal.json`). A new module `src/db/one-seal.ts` exports `checkOneSeal()`, which mirrors the three-step pattern of `src/db/ethos-seal.ts`: Step A reads `one.seal.json`; Step B queries `one_seals WHERE is_active = TRUE`; Step C compares the stored DB signature against the file HMAC using `crypto.timingSafeEqual()`. All failure modes call `process.exit(1)` with operator-facing recovery instructions — no degraded mode (SEC-B8). A new boot Step 3.6 (`await checkOneSeal()`) is inserted immediately after the existing Step 3.5 (`await checkEthosSeal()`). `ONE_SEAL_PATH` is added to `src/config.ts`. `scripts/one-init.ts` is extended: after initialising the Ethos Seal, it computes an HMAC over the deep-stable canonical JSON of the two One SOP seed files (keys sorted alphabetically at every level, identical serialisation to the Ethos Seal), inserts the active row into `one_seals`, and writes `one.seal.json`. A single `npx tsx scripts/one-init.ts` run initialises both seals.

**Phase 4 — Agent Emanation API.**
Three new routes are added to the squad-api Express server, all protected by the existing `authMiddleware` and subject to the existing 20 req/min rate limit:
- `GET /api/one/protocols` — returns the two One SOPs as structured JSON using the `openhiveos_reader` role. Provides the Dashboard with The One's protocols for eventual UI rendering.
- `POST /api/one/validate-agent` — accepts `{ content: string }` (raw agent `.md` content); runs seven machine-checkable rules derived from the agent-outline SOP: frontmatter `name` before `description`, presence of five required section headings (Identity, Session Start Gate, Memory & Coordination, Accountability Chart, Constraints), Session Start Gate contains `get_session_usage` as step 3, Continuous Calibration Protocol present, Task Status Gate heading contains "MANDATORY", section heading is `## Constraints` not `## Hard Constraints`, and the Constraints section contains the NEVER `.md` files rule. Returns `{ valid: boolean, violations: string[] }`. No DB writes; computation only.
- `POST /api/one/emanate` — stub endpoint for the future Dashboard emanation panel. Accepts `{ brief: string, seat: string }`; returns the spawn-protocol SOP content and an empty agent `.md` scaffold with all required sections pre-filled per the AGENT-OUTLINE spec. No LLM call at this stage — The One (the AI agent) performs the actual writing using the returned scaffold and protocol. Full implementation deferred to a future sprint.

**Rationale:**

The Ethos Seal (ARCH-013) and the SOP seeding system (ARCH-009) together provide all the infrastructure needed for this integration — the primary work is applying existing patterns to a new domain. The One Seal follows the Ethos Seal design exactly because the threat model is identical: detect silent modification of a constitutionally significant artifact in the DB without going through the sanctioned update path.

Storing The One's agent files in the repository is justified by The One's unique position. Every other agent is user-supplied and operator-specific; The One is a system component. Its operating contract governs every future agent's structure and ethos. Allowing it to live as an unprotected external flat file violates the integrity model the OS is built on. No other agents are included because doing so would impose OpenHiveOS's opinion on operator-defined roles — the opposite of the portable-OS design goal.

The SOP seeding path (rather than hardcoding the AGENT-OUTLINE spec in application logic) is chosen because it keeps the specification human-readable, operator-revisable via `one-init.ts --revise`, and queryable at runtime by The One itself via `search_sops()`. This means The One's runtime behaviour automatically reflects the latest sealed spec without requiring code changes.

The Dashboard API endpoints are built now, before any UI, because the route and validation logic are independent of the Vue component that will eventually consume them. Building the API first eliminates the back-and-forth of building UI and API simultaneously and gives The One (via the agent's session) a queryable API surface today.

**Trade-offs accepted:**

- `one.seal.json` and `ethos.seal.json` are both committed to the repository root. Both must be added to `.gitignore` if operators do not want seal state tracked in SCM. The default (track in git) is the safer choice for audit purposes but may surprise teams unfamiliar with the Ethos Seal pattern.
- The One Seal HMAC is computed over the SOP seed files (at init time), not over the SOP rows in the database (at boot time). This means the seal detects DB-row tampering (the signature stored in `one_seals` is changed) but does not independently detect a case where the DB SOP `instructions` column is updated while the `one_seals.signature` row is simultaneously updated with a new valid HMAC. This attack requires both DB write access and knowledge of `ONE_SEAL_SECRET` — acceptable at v0.3, flagged for the Ed25519 migration path (SEC-B1).
- `one-deploy.ts` does not write a harness-level integrity record. If an operator manually edits `~/.copilot/agents/one.agent.md` after deploying, the OS has no boot-time visibility into that modification. The OS's drift protection applies to the DB SOPs (the runtime knowledge layer), not to the harness file (the AI session layer). This trade-off is accepted because the harness file is a rendering artifact — The One's canonical behaviour is governed by what it reads from `search_sops()`, not solely from its own system prompt.
- The `POST /api/one/emanate` endpoint is a stub. It returns a scaffold but performs no generation. Teams may expect a fully functional emanation endpoint and be surprised by the deferral. The endpoint is named and stubbed deliberately to establish the contract before the implementation, preventing future API shape churn.
- `ONE_SEAL_SECRET` has no defined rotation SLA, consistent with `ETHOS_SEAL_SECRET`. Rotation requires re-running `npx tsx scripts/one-init.ts --revise`. Key loss has no automated recovery path.

**Consequences:**

- **Repository structure:** New `agents/one.agent.md`, `agents/one/` directory. New `seeds/sops/one/spawn-protocol.md`, `seeds/sops/one/agent-outline.md`. New `one.seal.json` at root. All tracked by git.
- **Schema:** New migration `021_one_seal.sql`. Table `one_seals` with partial unique index on `is_active`. No FK dependencies; no CASCADE. `openhiveos_reader` role requires no changes (SELECT-only; table is readable).
- **Boot sequence:** ARCH-008 boot sequence gains Step 3.6. Updated comment block in `src/index.ts`:
  ```
  //   3.5  Check Ethos Seal  (db/ethos-seal — exits if seal absent or drifted, ARCH-013)
  //   3.6  Check One Seal    (db/one-seal — exits if protocols absent or drifted, ARCH-025)
  //   3.75 SOP ingest        (sops/ingest — upsert seeds/sops/**/*.md, ARCH-009)
  ```
- **Scripts:** New `scripts/one-deploy.ts` (operator CLI; `npx tsx scripts/one-deploy.ts`; reads `agents/one.agent.md`, writes to `ONE_HARNESS_DIR`). Extended `scripts/one-init.ts` (One Seal initialised after Ethos Seal in same run).
- **Config:** New `ONE_SEAL_PATH` in `src/config.ts` and `.env.example`. New `ONE_HARNESS_DIR` in `.env.example` (default `~/.copilot/agents/`; not a required env var — falls back to default).
- **squad-api routes:** Three new routes under `/api/one/`. All use existing `authMiddleware`. `GET /api/one/protocols` uses `openhiveos_reader`. `POST` routes use `pool` (no writes on validate; stub only on emanate).
- **PM2:** No new PM2 entries. `one-init.ts` and `one-deploy.ts` are operator CLI scripts (`npx tsx`), not daemons. The three existing PM2 processes (`squad-api`, `mcp-gateway`, `squad-runner`) are unchanged.
- **Dashboard UI:** No Vue component in this ARCH. The `/api/one/` surface is the foundation. The One Dashboard panel (rendering protocols, validate-agent form, emanate form) is a named future sprint deliverable.
- **AGENT-OUTLINE.md drift fixes applied to `agents/one.agent.md`:** Six corrections required before the file is committed — documented in Phase 1 of the implementation plan. The corrected file becomes the canonical reference all future emanations inherit from.

**Open conditions (implementation gates):**

- **OC-1 (Silas):** Confirm `one_seals` HMAC input format before implementation begins. Recommended: `JSON.stringify({ spawnProtocol: <content>, agentOutline: <content> })` with keys sorted alphabetically at every depth level, matching Ethos Seal serialisation discipline.
- **OC-2 (Locksmith):** Pre-merge security review of `src/db/one-seal.ts` and `scripts/one-init.ts` One Seal extension. Confirm SEC-B6 (`timingSafeEqual`) and SEC-B8 (no degraded mode) compliance.
- **OC-3 (Murphy):** `POST /api/one/validate-agent` input validation. The `content` field must be bounded in length (recommend 64KB max; Zod `z.string().max(65536)`) to prevent memory pressure from pathologically large payloads.
- **OC-4 (Silas):** Confirm `one.seal.json` gitignore policy. Current recommendation: do NOT gitignore — treat seal state as an auditable artifact, consistent with `ethos.seal.json`.

**Security review:**

The One Seal follows the Ethos Seal security model established in ARCH-013. All Ethos Seal SEC-B conditions carry forward by reference. The following additional conditions apply specifically to this ARCH:

- **SEC-C1** — `ONE_SEAL_SECRET` must be 256-bit CSPRNG minimum, unique per deployment, not reused with `ETHOS_SEAL_SECRET` or any other secret in the stack. Generated via `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- **SEC-C2** — `one.seal.json` must be added to `.gitignore` and any equivalent ignore files unless the operator explicitly elects to track seal state in SCM (OC-4 ruling). Default recommendation is to track.
- **SEC-C3** — `one-deploy.ts` must not log the contents of `agents/one.agent.md` or `agents/one/` files. Log only path, byte count, and success/failure status.
- **SEC-C4** — `POST /api/one/validate-agent` must not echo back the submitted `content` in error responses. Return violation list only.
- **SEC-C5** — `POST /api/one/emanate` stub must validate and bound its inputs (`brief` and `seat`) via Zod even in stub form. A stub that accepts unbounded input establishes a permissive contract the full implementation will inherit.
- **SEC-C6** — `ONE_HARNESS_DIR` must be resolved to an absolute path before use in `one-deploy.ts`. Reject any resolved path that traverses outside the user's home directory (path traversal guard).
