---
title: "OpenHiveOS — Agent Spawn Protocol"
date: 2026-05-21
updated: 2026-05-21
author: "Clarence"
owner: "Silas"
status: active
tags:
  - type/guide
  - project/openhiveos
  - domain/backend
  - domain/devops
  - domain/security
  - audience/technical
review_date: 2026-08-21
---

# OpenHiveOS — Agent Spawn Protocol

**What this is:** The three-phase process by which a Squad Instance is constituted and its agents are brought into operational existence. This document is the authoritative binding between the spawn-protocol's phase definitions and the scripts that implement them. Any change to this document triggers a mandatory audit of the implementing scripts (see [Audit Rule](#audit-rule)).

**Owner:** Silas  
**Last updated:** 2026-05-21 (B15/C9 — initial creation; binds one-init.ts Phases 1+2 and provision-all-agents.ts Phase 3)  
**Source authority:** ARCH-013, ARCH-014

---

## Overview

An agent does not simply start — it is brought into being through a declared, ordered procedure that encodes the Squad's constitution into the database before any agent process runs. The three phases are sequential and non-skippable. Each phase has a gate condition that the next phase checks explicitly in code.

```
Phase 1 → Phase 2 → Phase 3
(Structural Assessment) → (Soul Authoring) → (Emanation)
         └── one-init.ts ──┘                provision-all-agents.ts
```

**Operator command sequence:**

```bash
# Phase 1 + 2 (runs both phases in one interactive session)
docker compose --profile init run --rm one-init
# Direct: npx tsx src/scripts/one-init.ts

# Phase 3
docker compose --profile init run --rm provision
# Direct: npx tsx src/scripts/provision-all-agents.ts --write-env <path>
```

---

## Phase 1 — Structural Assessment

**Purpose:** Gather the Squad's structural facts from the manifest. Confirm that the deployment environment is capable of receiving the Ethos Seal.

**Gate condition entering Phase 1:** None. This is the first phase.

**What it does:**

1. Reads `src/squad/manifest.ts` (or the compiled manifest) to load the agent roster — slugs, display names, and seat definitions.
2. Validates that `DATABASE_URL`, `ETHOS_SEAL_SECRET`, and `ETHOS_SEAL_PATH` are present in the environment. Exits immediately with a human-readable error if any are missing.
3. Confirms that PostgreSQL is reachable and that `migrations/004_ethos_seal.sql` has been applied (i.e., the `ethos_seals` table exists).
4. Checks whether an active seal already exists. If yes: requires `--revise` flag to proceed. If no: proceeds to Phase 2.

**Gate condition leaving Phase 1:** Environment validated, manifest loaded, DB reachable, seal state known.

**Implementing script:** `src/scripts/one-init.ts`

**Failure behaviour:** `process.exit(1)` with an operator-facing message naming the recovery action. No partial state is written. No DB writes occur in Phase 1.

---

## Phase 2 — Soul Authoring

**Purpose:** Encode the Squad's constitutional declaration — its identity, Five Laws, and seat definitions — into the database as the Ethos Seal.

**Gate condition entering Phase 2:** Phase 1 completed successfully in the same script invocation (no separate gate check — both phases run in `one-init.ts`).

**What it does:**

1. Prompts the Operator interactively via `node:readline/promises` for:
   - Squad name
   - Five Laws (one per Law — free-form text at v0.2; content schema validation deferred to v0.3 per OQ-1)
   - Seat definition per agent slug from the manifest (role description)
2. Constructs a structured JSON payload from the collected inputs.
3. Signs the payload with HMAC-SHA256 using `ETHOS_SEAL_SECRET` (v0.2 interim — Ed25519 required by v0.3, SEC-B1).
4. Inserts the signed seal into the `ethos_seals` table as the active row (`SERIALIZABLE` isolation on `--revise` path, SEC-B5).
5. Exports `ethos.seal.json` to `ETHOS_SEAL_PATH` on the host file system (the runtime artifact).

**Gate condition leaving Phase 2:** Active seal row committed in `ethos_seals`. `ethos.seal.json` written to `ETHOS_SEAL_PATH`. Both artefacts must be consistent — if the file write fails, the transaction is rolled back.

**Implementing script:** `src/scripts/one-init.ts`

**Security bindings:** SEC-B2, SEC-B3, SEC-B4, SEC-B5, SEC-B6, SEC-B8, SEC-B9 (ARCH-013).

**Revision path:** `npx tsx src/scripts/one-init.ts --revise` — runs Phases 1+2 with `SERIALIZABLE` isolation, atomically replacing the existing active seal.

---

## Phase 3 — Emanation

**Purpose:** Bring all Squad agents into operational existence by issuing bearer tokens and writing the agent registry into the `agents` table.

**Gate condition entering Phase 3:** An active Ethos Seal must exist in `ethos_seals WHERE is_active = TRUE`. The script queries this explicitly via `checkEthosSealGate()` in `src/auth/upsert-agent.ts`. If zero rows are returned or the table does not exist (error code `42P01`), the script exits with `process.exit(1)` and instructs the Operator to run Phase 1+2 first. This gate cannot be bypassed — it is enforced in code, not in Docker Compose `depends_on`.

**What it does:**

1. Reads the agent roster from the manifest. Excludes the `dashboard` agent (provisioned separately via `provision-agent-token.ts dashboard`).
2. For each agent slug: calls `upsertAgent()` in `src/auth/upsert-agent.ts`.
   - **Default behaviour (`--all` only):** `ON CONFLICT DO NOTHING` — already-provisioned agents are skipped.
   - **Rotation (`--force-rotate --confirm`):** Rotates all tokens with a 24-hour grace window via `previous_token_hash` + `previous_token_expires_at` columns (zero-downtime handover).
3. Writes `AGENT_TOKEN_<SLUG>=<token>` lines to the file specified by `--write-env` (mandatory for batch runs, SEC-C3). File is written atomically (tmp + rename) with mode `0o600` (SEC-C4).

**Gate condition leaving Phase 3:** All non-dashboard agents have an active row in the `agents` table. Tokens written to `--write-env` file. Dashboard agent must be provisioned separately before the dashboard can authenticate.

**Implementing script:** `src/scripts/provision-all-agents.ts`

**Security bindings:** SEC-C2, SEC-C3, SEC-C4, SEC-C5 (ARCH-014).

---

## Boot-Time Verification (Post-Phase 3)

After all three phases complete, every subsequent MCP server and squad-api boot verifies Phase 2's output:

1. `checkEthosSeal()` in `src/db/ethos-seal.ts` — reads the active `ethos_seals` row and the `ethos.seal.json` file, compares HMAC signatures using `crypto.timingSafeEqual`.
2. If signatures match: boot proceeds normally.
3. If signatures do not match, or if the seal is absent: `process.exit(1)` with operator-facing error naming the recovery command. Degraded mode is not permitted (SEC-B8).

This is not a phase of the spawn-protocol — it is a runtime enforcement of Phase 2's guarantee.

---

## Audit Rule

**When this document changes, the following files must be audited for drift before the change merges:**

| Phase | Implementing file | What to audit |
|---|---|---|
| 1 + 2 | `src/scripts/one-init.ts` | All phase steps still match the document. Environment checks, manifest loading, seal signing, file export, `--revise` path. |
| 3 | `src/scripts/provision-all-agents.ts` | Ethos Seal gate, agent loop, `ON CONFLICT DO NOTHING` default, `--force-rotate --confirm` path, `--write-env` atomic write, dashboard exclusion. |
| Boot | `src/db/ethos-seal.ts` | `checkEthosSeal()` still compares HMAC using `timingSafeEqual`. `process.exit(1)` on drift. |

**When `one-init.ts` or `provision-all-agents.ts` changes, this document must be reviewed for accuracy.** The audit obligation runs in both directions.

**Binding declarations:**
- ARCH-013 OQ-5: formally closed. See [ARCH-013 — The One inside OpenHiveOS](ARCH-013-the-one-ethos-seal.md).
- ARCH-014 Action C9: formally closed. See [ARCH-014 — Agent Onboarding + Dynamic Provisioning](ARCH-014-agent-onboarding-dynamic-provisioning.md).

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-21 | Created — B15 (ARCH-013 OQ-5) + C9 (ARCH-014). Phases 1+2 bound to `src/scripts/one-init.ts`; Phase 3 bound to `src/scripts/provision-all-agents.ts`. Audit rule declared. |
