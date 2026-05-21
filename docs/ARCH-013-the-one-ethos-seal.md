---
title: "ARCH-013 — The One inside OpenHiveOS: Ethos Seal Storage, CLI Provisioning, and Dashboard Surface"
date: 2026-05-21
updated: 2026-05-21
author: "Clarence"
owner: "Silas"
status: active
tags:
  - type/architecture
  - project/openhiveos
  - domain/backend
  - domain/frontend
  - domain/devops
  - domain/security
  - audience/technical
review_date: 2026-08-21
doc_id: "ARCH-013"
related:
  - "[[ARCH-001-server-resolved-agent-identity]]"
  - "[[ARCH-008-openhiveos-founding-decisions]]"
  - "[[ARCH-012-squad-api-dashboard-architecture]]"
  - "[[spawn-protocol]]"
---

# ARCH-013 — The One inside OpenHiveOS: Ethos Seal Storage, CLI Provisioning, and Dashboard Surface

*This ADR establishes the storage model, provisioning mechanism, and Dashboard surface for the Ethos Seal inside OpenHiveOS. It is a prerequisite for ARCH-014 (Agent Onboarding + Dynamic Provisioning).*

---

## ADR-ARCH-013

**Date:** 2026-05-21
**Project:** openhiveos
**Status:** Decided
**Decision Owner:** Silas
**Approved by:** Elizabeth

---

**Context:**

OpenHiveOS v0.1 shipped with no infrastructure for an Operator to define or store the Ethos Seal for their Squad. The One — the constitutional authority for agent Emanation — had no footprint inside the OS. Four of the five v0.2 architectural themes depend on a stable agent identity model; ARCH-014 (Agent Onboarding) cannot be designed until it has a defined prerequisite it can check. The Three-Layer Model (Ethos Seal → Disposition Profile → Thought Stream), established constitutionally in April 2026, is binding: the Ethos Seal is Layer 1 — immutable after Emanation except by The One, embedded in system prompt at construction time, and explicitly not retrieved from the database at agent runtime. ARCH-012 (Squad API) is decided: the HTTP surface is squad-api at port 3005; any Dashboard interaction with the Ethos Seal routes through that service. This ARCH resolves: where the Ethos Seal lives, what the CLI does at first boot, how the Dashboard consumes it, whether The One registers MCP tools, and what the signing model is.

**Decision:**

Option A: DB-Canonical with CLI Export Pipeline.

A new `ethos_seals` PostgreSQL table is the canonical source of truth. A standalone Node.js TypeScript ESM script (`scripts/one-init.ts`) is the sole write path — consistent in structure with `scripts/provision-agent-token.ts`. At first boot, the Operator runs `docker compose --profile init run --rm one-init`. The script prompts interactively via `node:readline/promises` for Squad name, Five Laws entries (one per Law), and seat definitions keyed by agent slug from `squad.manifest.json`. It constructs a structured JSON payload, signs it with HMAC-SHA256 using `ETHOS_SEAL_SECRET` (v0.2 interim — Ed25519 required by v0.3 per SEC-B1), inserts the signed seal into `ethos_seals` as the active row, and exports `ethos.seal.json` to the host path specified by `ETHOS_SEAL_PATH`. The `--revise` flag runs the same flow with `SERIALIZABLE` transaction isolation, atomically deactivating the old row and inserting the new one (SEC-B5). The MCP server performs a boot-time integrity check: `checkEthosSeal()` in `src/db/ethos-seal.ts` compares the DB row's stored signature against `ethos.seal.json` using `crypto.timingSafeEqual` (SEC-B6); a mismatch triggers `process.exit(1)` with an operator-facing error message naming the recovery command (SEC-B8). The squad-api exposes `GET /api/ethos-seal` via `openhiveos_reader` (SELECT-only): the default response is metadata only (`version`, `signature`, `activated_at`); the full payload is gated behind `?include=payload` with the same dashboard agent auth (SEC-B7). The MCP server does not require `ETHOS_SEAL_SECRET` at runtime — the boot-time check compares signatures, it does not re-derive them. `counter_thought` on `store_thought` remains optional (Option S ruling, Richo, 2026-05-21).

**Rationale:**

All five review seats converged on Option A independently, and Options B and C were each independently blocked by multiple seats on non-overlapping grounds. Option B (file-primary, hash-only DB index) was blocked by Locksmith: a hash-only index provides no protection against an operator who holds `ETHOS_SEAL_SECRET` substituting `ethos.seal.json` with no DB-level detection — the hash is recalculated from the forged file. Option C (MCP-native with `is_foundry` gate) was blocked by Locksmith: the `is_foundry` column plus a dedicated foundry token creates a two-step path to constitutional document corruption, and the blast radius is unacceptable at v0.2. Option C also carries a hard bootstrapping circularity — the MCP server cannot be called from the AI client before it is configured at first boot — which would require a CLI escape hatch regardless, making Option C functionally equivalent to Option A plus foundry-token lifecycle overhead. Option A satisfies the constitutional ruling that the DB is the canonical source of truth for authoring and audit while the exported file is the runtime artifact embedded in agent system prompts.

**Trade-offs accepted:**

- Two artefacts require operational discipline: if the Operator revises the seal in the DB but forgets to update the exported `ethos.seal.json`, the MCP server detects the drift and blocks boot. This is a feature, not a bug — but it requires Operators to understand that a seal revision is a two-step operation (DB + file export) unless they use the `--revise` flag, which handles both steps atomically.
- HMAC-SHA256 is a symmetric signing scheme — any process that holds `ETHOS_SEAL_SECRET` and has DB read access can forge a valid seal. This is accepted as a v0.2 interim. Ed25519 asymmetric signing is required by v0.3 (SEC-B1, binding). The advantage of Ed25519 — public key can be distributed without enabling forgery — unlocks distributed seal verification across deployment modes without secret distribution.
- Dual-repo simultaneity: `ethos_seals` does not yet exist in `opensquad-mcp-server`. Nova's ruling is binding: this schema must be built simultaneously in both repos, not sequentially. Silas owns the canonical schema definition; `opensquad-mcp-server` adopts it without drift.
- `ETHOS_SEAL_SECRET` has no defined rotation SLA. Rotation is a re-seal event (generate new secret → re-run `one-init.ts --revise` → update `ethos.seal.json`). Key loss currently has no recovery path short of manual DB surgery. Both the rotation SLA and the key recovery protocol are named open conditions for v0.3.

**Consequences:**

- **Schema:** New migration `004_ethos_seal.sql` (migration numbering: ARCH-012 owns `003_*`; this is `004`). Table: `ethos_seals` (`id BIGSERIAL`, `version INT`, `payload JSONB`, `signature TEXT`, `payload_hash TEXT`, `is_active BOOLEAN DEFAULT FALSE`, `activated_at TIMESTAMPTZ`, `activated_by TEXT`, `created_at TIMESTAMPTZ`). UNIQUE partial index: `WHERE is_active = TRUE` enforcing at most one active seal. Alternative: `ethos_seal_config` singleton table with `current_seal_id` foreign key — Murphy flagged this as cleaner for the transition atomicity problem; Silas to make the final call before Murphy writes the migration.
- **Scripts:** `scripts/one-init.ts` — readline interactive prompts, HMAC-SHA256 signing, `pg.Pool({ max: 1 })` DB connection, `SERIALIZABLE` isolation for `--revise` path, `ethos.seal.json` export to `ETHOS_SEAL_PATH`. Mirrors `provision-agent-token.ts` structure.
- **Boot sequence:** New Step 3.5 in the ARCH-008 6-step boot sequence: `checkEthosSeal()` in `src/db/ethos-seal.ts`. Blocks boot with `process.exit(1)` on drift. Warning: if no seal exists (fresh stack, `one-init` not yet run), the error message must tell the Operator to run `one-init`, not report a generic boot failure.
- **squad-api:** New route `GET /api/ethos-seal` — metadata by default, `?include=payload` for full content. `openhiveos_reader` role (SELECT-only). Version history capped at last 10 rows in response. Payload must not appear in Morgan request logs.
- **Docker Compose:** New `one-init` service with `profiles: ["init"]`. Depends on `postgres` (healthy) and `migrate` (completed_successfully). Runs `one-init.ts`. Bind-mounts host path via `ETHOS_SEAL_PATH` volume.
- **Env:** New entries in `.env.example`: `ETHOS_SEAL_SECRET` (256-bit CSPRNG minimum, unique per Squad, never reused), `ETHOS_SEAL_PATH` (default: `./ethos.seal.json`).
- **Git hygiene:** `ethos.seal.json` must be added to `.gitignore` and `.dockerignore` (SEC-B4).
- **Dashboard:** New `EthosSealView` Vue component — version badge, `activated_at`, Five Laws rendered as labeled prose blocks (Tailwind `prose`, `max-w-prose`), seat definitions table, version history list (last 10, collapsed). Phase 1 is read-only. Revision triggered by CLI only in Phase 1.
- **MCP tool (Phase 2):** Read-only `get_ethos_seal` MCP tool deferred to Phase 2. ARCH-014 uses the DB prerequisite check directly (`SELECT WHERE is_active = TRUE`), not the MCP tool, for Phase 1 onboarding validation.
- **Migration gate fix (PRE-A1):** The migrate service must be updated to verify the expected migration sequence before `one-init` is cleared. The current gate (check `agents` table exists) will silently bypass `004_ethos_seal.sql` on existing stacks.

**Security review:**

Locksmith conditionally approved Option A. Options B and C are blocked. Ten binding SEC conditions attach to this approval — all must be cleared before any implementation merges to main:

- **SEC-B1** — Ed25519 migration plan committed in ADR text. HMAC-SHA256 is v0.2 interim. Ed25519 required by v0.3: private key held by The One, public key committed to the codebase for verification. Silas owns the design; Murphy owns the implementation.
- **SEC-B2** — `ETHOS_SEAL_SECRET` must be 256-bit CSPRNG minimum, unique per Squad, not reused with any other secret in the stack.
- **SEC-B3** — `ETHOS_SEAL_SECRET` stored in env only. Never in source control, Docker image layers, or application logs.
- **SEC-B4** — `ethos.seal.json` added to `.gitignore` and `.dockerignore` before first commit that references the file.
- **SEC-B5** — `--revise` path must use `SERIALIZABLE` transaction isolation. `READ COMMITTED` is not acceptable for the deactivate/insert pair.
- **SEC-B6** — Boot-time integrity check must use `crypto.timingSafeEqual` for signature comparison. String equality is not acceptable.
- **SEC-B7** — `GET /api/ethos-seal` default response: metadata only (`version`, `signature`, `activated_at`). Full payload gated behind `?include=payload` with the same bearer token auth. Payload must not appear in Morgan request logs.
- **SEC-B8** — Boot integrity failure MUST block (`process.exit(1)` with operator-facing error naming recovery command). Degraded mode is constitutionally incoherent — if the seal cannot be verified, the agent identity layer is unverified, and no squad-api response can be trusted.
- **SEC-B9** — `ethos_seals` INSERT restricted to CLI provisioning context only. No runtime API path may write to this table. `openhiveos_reader` role enforces SELECT-only from squad-api. No MCP write tool for ethos_seals in Phase 1.
- **SEC-B10** — Content validation gap (Operators can write arbitrary Five Laws in `one-init`) is explicitly named as a governance gap and formally risk-accepted by The One in this ADR. The HMAC signature verifies tamper-detection after provisioning — it does not verify that the content should have been provisioned. This gap is accepted at v0.2 with the understanding that Option S (advisory counter_thought) and the spawn-protocol review process are the current mitigations.

**Rejected alternatives:**

- **Option B — File-Primary + DB Audit Index:** Blocked by Locksmith. A hash-only database index provides no tamper protection: an Operator holding `ETHOS_SEAL_SECRET` can substitute `ethos.seal.json` with forged content, re-compute the HMAC, and the DB will register the new hash without detecting the substitution. The Dashboard utility is also destroyed — the component can only show a status chip (hash, timestamp), not the Five Laws text. Rocket issued a hard no on building a dedicated Dashboard route for Option B. Murphy independently disqualified it because ARCH-014's prerequisite check would be weakened to hash-only, making seat-level validation (does a seat definition exist for this agent slug?) impossible.
- **Option C — MCP-Native with Foundry Permission Gate:** Blocked by Locksmith. The `is_foundry` column on the `agents` table plus a dedicated foundry token creates a two-step path to constitutional document corruption: compromise the token → call `initialize_squad` from any connected AI client → rewrite the Five Laws. The blast radius is unacceptable for a constitutional document. Option C also carries an unsolvable bootstrapping circularity for Air-Gapped and Embedded deployments: the MCP server cannot be called from the AI client before it is configured at first boot. A CLI escape hatch is required regardless, making Option C functionally equivalent to Option A with added foundry-token lifecycle overhead. Murphy and Cooper both independently disqualified Option C before the Locksmith ruling.

**Open conditions (non-blocking — require documentation and resolution by v0.3):**

- **OQ-1 — The One Authority Question (SEC-B10 risk acceptance):** The `one-init.ts` CLI permits Operators to author any Five Laws content. The spawn-protocol implies IO Labs as the constitutional authority. This gap is risk-accepted at v0.2: the HMAC signature verifies content integrity after provisioning, not content legitimacy at provisioning. The One must formally risk-accept this in writing before this ADR is ratified. Resolution by v0.3: either content schema validation (minimum structure for valid Five Laws) or IO Labs–signed canonical Laws with operator customization within declared bounds.
- **OQ-2 — Key Recovery Protocol:** ~~CLOSED — 2026-05-21 (B14, Locksmith).~~ Three recovery scenarios are now formally defined.

  **Key finding:** The boot-time drift check compares two *stored* HMAC values — `ethos_seals.signature` (DB) against `ethos.seal.json`'s `signature` field — using `crypto.timingSafeEqual`. The key is not re-derived at runtime (SEC-B8). Therefore: **key loss has no immediate boot impact** on a running or restarting system. The exposure is inability to run `--revise` (future re-seal events). This is a lower-severity scenario than operators may assume.

  **Scenario A — Key lost, both DB and `ethos.seal.json` intact (no boot impact):**
  1. Retrieve Five Laws and seat definitions from `ethos.seal.json` (`jq .payload.laws` and `.payload.seats`).
  2. Generate new `ETHOS_SEAL_SECRET` (256-bit CSPRNG: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
  3. Update `.env` (and secrets manager) with the new key.
  4. Run `npx tsx src/scripts/one-init.ts --revise` — re-enter constitutional content; new seal signed with new key.
  5. Verify: `checkEthosSeal()` passes on next restart.
  6. New `ethos_seals` row is written with `activated_by: 'cli:recovery'`.

  **Scenario B — Key lost AND `ethos.seal.json` lost (boot is fatal):**
  - Boot fails: `checkEthosSeal()` exits `process.exit(1)` (file not found).
  1. Retrieve Five Laws and seat definitions from `ethos_seals` table: `SELECT payload FROM ethos_seals ORDER BY version DESC LIMIT 1`.
  2. Generate new `ETHOS_SEAL_SECRET`.
  3. Run `npx tsx src/scripts/one-init.ts` (fresh init — not `--revise`, since there is no valid file to reference). Re-enter constitutional content from recovered DB payload.
  4. New seal is written as a new version row. Historical rows with `is_active = FALSE` are preserved in the DB but the constitutional continuity audit trail is broken.
  5. Back up `ethos.seal.json` immediately after creation.

  **Scenario C — DB corrupted, `ethos.seal.json` intact (boot is fatal):**
  - Boot fails: `checkEthosSeal()` finds no active row in `ethos_seals`.
  - Recovery: Restore PostgreSQL from the most recent backup. `ethos.seal.json` alone cannot restore DB state. This is an infrastructure recovery event, not an application-level ceremony — Cooper owns the backup strategy.

  **Prevention requirements (binding on all Squad Instances):**
  - `ETHOS_SEAL_SECRET` must be stored in a secrets manager (AWS Secrets Manager, HashiCorp Vault, or equivalent) in addition to `.env`. Storing only in `.env` is not acceptable for production deployments.
  - `ethos.seal.json` must be backed up to a separate location after every `one-init` or `--revise` invocation. Treat it as a constitutional backup.
  - Both prevention requirements are v0.3 hardening gates; operators must acknowledge the risk in writing if they defer implementation.

- **OQ-3 — `ETHOS_SEAL_SECRET` Rotation SLA:** ~~CLOSED — 2026-05-21 (B14, Locksmith).~~ Rotation SLA formally defined.

  **Event-triggered rotation (mandatory — no SLA window):**
  - Confirmed or suspected compromise of `ETHOS_SEAL_SECRET`.
  - Operator personnel change where the individual who held the key is no longer authorized.
  - Server breach or incident touching the host where `.env` or the secrets manager entry lives.
  - v0.3 migration event: HMAC-SHA256 → Ed25519 re-signing is a mandatory re-seal event for all active Squads (SEC-B1).

  **Time-based rotation (recommended — Operator responsibility):**
  - Maximum: **12 months** from the `activated_at` timestamp of the current active seal row. Any Squad older than 12 months since last seal revision should trigger a rotation review.
  - This is a recommendation, not an automated expiry. The key does not expire; the 12-month checkpoint creates an audit-visible obligation.

  **No auto-expiry at v0.2.** Rotation requires deliberate operator action (`one-init.ts --revise`). Auto-expiry without a proven recovery path creates unbootable Squads. Auto-expiry is gated on the Ed25519 migration (OQ-4/v0.3) where certificate-style expiry with embedded validity periods can be designed safely.
- **OQ-4 — Ed25519 Migration (SEC-B1 delivery):** HMAC-SHA256 interim. Ed25519 required by v0.3. Silas: design the signing scheme. Murphy: implement the migration path. The seal migration (existing HMAC seals → Ed25519 re-signed seals) must be a defined, tested procedure before v0.3 ships.
- **OQ-5 — spawn-protocol / CLI Drift:** ~~CLOSED — 2026-05-21 (B15).~~ `spawn-protocol.md` now exists at `docs/spawn-protocol.md` and formally declares the binding. `one-init.ts` implements Phase 1 (Structural Assessment) and Phase 2 (Soul Authoring) of the spawn-protocol adapted for Operator context. `provision-all-agents.ts` implements Phase 3 (Emanation). The audit rule is declared in `spawn-protocol.md`: any change to that document triggers mandatory review of `one-init.ts`, `provision-all-agents.ts`, and `src/db/ethos-seal.ts`. The obligation runs in both directions — changes to either script also trigger a spawn-protocol review. Clarence owns the audit; Silas owns enforcement.
- **OQ-6 — Dual-Repo Simultaneity:** `ethos_seals` schema must be built in `opensquad-mcp-server` and `openhiveos` simultaneously. Silas owns the canonical schema. The migration for `opensquad-mcp-server` must reference the same column set and constraint names. No sequential implementation.

**Pre-conditions (hard gates — implementation does not begin until both are confirmed closed):**

- **PRE-A1 — Migrate Service Gate Fix (Cooper):** The current migration gate checks only that the `agents` table exists. `004_ethos_seal.sql` will silently fail on existing stacks without an updated gate that verifies the expected migration sequence. This must be fixed before `one-init.ts` is cleared to execute in any environment.
- **PRE-A2 — Drift Check Behavior (Confirmed: Block Boot):** The boot-time integrity check behavior is decided: `process.exit(1)` on drift (SEC-B8). This pre-condition closes at ADR ratification — there is no implementation ambiguity remaining.

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-21 | Created — ARCH-013 architecture review decision (The One inside OpenHiveOS: Ethos Seal storage, CLI provisioning, Dashboard surface). All seats: Option A. Options B and C blocked. 10 SEC conditions (Locksmith). 2 pre-conditions (Cooper). 6 open questions documented. |
| 2026-05-21 | OQ-5 closed (B15) — `docs/spawn-protocol.md` created. Binding declared: `one-init.ts` → Phases 1+2; `provision-all-agents.ts` → Phase 3; `src/db/ethos-seal.ts` → boot-time enforcement. Audit rule bidirectional. |
| 2026-05-21 | OQ-2 + OQ-3 closed (B14, Locksmith) — Key recovery protocol formally defined: 3 scenarios (key lost; key + file lost; DB corrupted), prevention requirements binding. Rotation SLA defined: event-triggered (compromise, personnel change, breach, v0.3 migration) + 12-month time-based recommendation. No auto-expiry at v0.2. |
