---
title: "ARCH-014 — Agent Onboarding + Dynamic Provisioning"
date: 2026-05-21
updated: 2026-05-21
author: "Clarence"
type: adr
tags:
  - type/adr
  - project/openhiveos
  - domain/backend
  - domain/devops
  - domain/security
  - audience/technical
status: Decided
---

## ADR — ARCH-014: Agent Onboarding + Dynamic Provisioning

**Date:** 2026-05-21
**Project:** openhiveos
**Status:** Decided
**Decision Owner:** Silas
**Approved by:** Elizabeth

---

## Context

OpenHiveOS has a token-based agent identity system (ARCH-001, ARCH-008) in which each MCP process authenticates via an `AGENT_TOKEN` environment variable. The token resolves to a named agent slug via a SHA-256+salt hash lookup against the `agents` table. Provisioning today means an Operator manually runs `provision-agent-token.ts --agent <slug>` for each agent — a one-at-a-time, imperative, undiscoverable operation.

There is no script that reads `squad.manifest.json` and ensures all declared agents are provisioned. There is no deactivation flow. There is no revocation primitive (`--revoke` is confirmed missing). There is no gate that verifies the Ethos Seal exists before any provisioning runs (ARCH-013 prerequisite). As squads scale beyond two or three agents, this model creates operational risk: tokens provisioned out of order, agents in manifest with no DB row, DB rows with no manifest entry — all invisible until boot failure.

ARCH-014 designs the end-to-end agent onboarding pipeline: how an agent goes from a line in `squad.manifest.json` to a fully provisioned, operational MCP process — with the Ethos Seal as the constitutional gate.

**Hash scheme clarification:** The `agents.token_hash` column stores SHA-256+salt hashes, not bcrypt. SHA-256 is the correct choice for 256-bit CSPRNG token output — bcrypt's cost factor provides no security gain for full-entropy random tokens. The auth middleware (`identity.ts`) uses `crypto.timingSafeEqual` on `Buffer` objects. This is correct and confirmed by Locksmith.

---

## Prerequisites

| Gate | Status | Owner |
|---|---|---|
| **PRE-A1** (ARCH-013): Fix migrate service gate — extend beyond `agents` table check to cover full migration sequence | Open | Murphy |
| **PRE-B1** (ARCH-012): Migrations `003_squad_api_role.sql` and `003_dashboard_agent.sql` applied | Open | Murphy |
| ARCH-013 ethos_seals table (`004_ethos_seal.sql`) applied | Open | Murphy |

**All three prerequisites must be confirmed closed before the ARCH-014 batch path (`provision-all-agents.ts --all`) ships in any environment.**

---

## Decision

**Option B — Sibling script `provision-all-agents.ts` + targeted additions to existing `provision-agent-token.ts`.**

The existing single-agent script receives two targeted additions: a `--revoke <slug>` flag and the Ethos Seal gate. A new sibling script, `scripts/provision-all-agents.ts`, handles batch provisioning exclusively. The batch script reads `squad.manifest.json`, verifies the Ethos Seal gate via a DB sentinel query, and upserts all declared agents (excluding `dashboard`, which is provisioned separately) using `ON CONFLICT (slug) DO NOTHING` as the default path. An explicit `--force-rotate` flag triggers the rotation upsert, and `--force-rotate --confirm` is required for batch rotation. The `--write-env <path>` flag is **mandatory** when `--all` is passed — token output to stdout is not permitted for batch runs. The batch script is registered as a Docker Compose `provision` init-profile service, mirroring the `one-init.ts` pattern from ARCH-013. The Composer operator onboarding sequence becomes Stage 1 (`one-init`) then Stage 2 (`provision`).

---

## Rationale

**Why not Option A (in-place extension):** Locksmith permanently blocked Option A. Batch token emission to stdout constitutes OWASP A02:2021 Cryptographic Failures — secrets are captured in Docker logs, container orchestration output, and terminal scrollback with no audit trail. There are no conditions under which Option A may be unblocked for batch runs.

**Why not Option C (unified `agent-lifecycle.ts` subcommand CLI):** Option C is architecturally correct at v0.3 scope but is not justified in the current sprint. The breaking rename of `provision-agent-token.ts` carries operator and documentation risk (7 confirmed file references), the SERIALIZABLE batch transaction adds complexity not required at 10-agent scale, and the `commander` dependency requires a formal approval per the ARCH-008 dependency approval process. Option C is explicitly reserved for v0.3 when Vault integration or structured JSON consumption by a downstream system becomes a concrete requirement.

**Why Option B:** Option B delivers every named requirement — `--revoke`, Ethos Seal gate, idempotent batch provisioning, Docker Compose init-profile integration, and `--write-env` safe secret output — while keeping each file's responsibility bounded and preserving backward compatibility with the existing single-agent rotation path. The shared upsert logic (Murphy amendment) is extracted to `src/auth/upsert-agent.ts` to prevent logic drift between the two scripts.

---

## Trade-offs Accepted

1. **Two provisioning scripts with overlapping preamble logic.** Mitigated by extracting the shared upsert function to `src/auth/upsert-agent.ts`. Both scripts import it. Any change to the upsert SQL or the Ethos Seal gate query is made in one place.
2. **`dashboard` excluded from batch provisioning.** The `dashboard` named principal (ARCH-012) is NOT declared in `squad.manifest.json` — it is a DB-only principal. It must be provisioned separately via `provision-agent-token.ts dashboard` after the batch completes. The batch script must have an explicit exclusion guard and a printed reminder.
3. **Docker Compose `depends_on` cannot express `one-init` → `provision` ordering.** Mitigated by DB sentinel gate: `provision-all-agents.ts` opens a DB connection first and runs `SELECT 1 FROM ethos_seals WHERE is_active = TRUE`; if zero rows, it exits 1 with an operator-facing message directing them to run `one-init` first. This enforces the ordering in code, not in the Compose graph.
4. **`expires_at` enforcement deferred.** The `expires_at` column in the `agents` table is not enforced by the auth middleware. This remains named tech debt. ARCH-014 does not address it.
5. **Automated rotation scheduling deferred.** No cron-based rotation reminder is introduced. This is a future sprint item.
6. **spawn-protocol Phase 3 binding.** `provision-all-agents.ts` implements Phase 3 (Emanation — agent into operational DB state) of the spawn-protocol. Any revision to `spawn-protocol.md` must trigger an audit of both `one-init.ts` (Phase 1+2) and `provision-all-agents.ts` (Phase 3). This binding is declared here and must be added to `spawn-protocol.md` (Clarence, action item C15).

---

## Consequences

### New files
- `scripts/provision-all-agents.ts` — batch provisioning CLI (Compose init-profile service)
- `src/auth/upsert-agent.ts` — shared upsert function imported by both provisioning scripts

### Modified files
- `scripts/provision-agent-token.ts` — adds `--revoke <slug>` flag + Ethos Seal gate
- `docker-compose.yml` — adds `provision` init-profile service
- `.env.example` — adds `PROVISION_ENV_DIR` documentation
- `squad.manifest.json` — confirmed authoritative; no change required

### New migration (if SEC-C8 fails)
- If `agents.token_hash` `UNIQUE` constraint is missing from existing migrations, an addendum migration adds it.

### Operator onboarding sequence (canonical, v0.2+)
```bash
# Stage 1 — Ethos Seal (ARCH-013)
docker compose --profile init run --rm one-init

# Stage 2 — Agent Tokens (ARCH-014)
docker compose --profile init run --rm provision --write-env .env.tokens

# Provision dashboard principal separately
npx tsx scripts/provision-agent-token.ts dashboard
# Copy AGENT_TOKEN=<token> to .env
```

### Dashboard consequence (Rocket)
`GET /api/agents` is now reliably complete after the provisioning sequence. The Dashboard agent roster view becomes trustworthy. The agents view must check `GET /api/ethos-seal` for `activated_at` and surface a banner state if null: *"Agent provisioning requires an active Ethos Seal. Run the one-init service first."*

### spawn-protocol consequence (Clarence + Silas)
Action C15 declares the binding between `provision-all-agents.ts` (Phase 3) and `spawn-protocol.md`. This must be added to `spawn-protocol.md` and referenced in this ADR (update when filed).

---

## Security Review

**Locksmith — APPROVED (Option B), BLOCKED (Option A), DEFERRED (Option C)**

**Binding merge gates — SEC-C1 through SEC-C8:**

| # | Condition | Risk if violated |
|---|---|---|
| **SEC-C1** | ADR text corrected: `token_hash` uses SHA-256, not bcrypt | Confusion; future implementation error |
| **SEC-C2** | Batch `--all` uses `ON CONFLICT DO NOTHING`; rotation requires `--force-rotate`; batch rotation requires `--force-rotate --confirm` | Accidental production DoS — all active tokens invalidated simultaneously |
| **SEC-C3** | `--write-env <path>` mandatory when `--all` is passed; `process.exit(1)` if absent | OWASP A02 — secrets in Docker logs and terminal scrollback |
| **SEC-C4** | `--write-env` path validation: `path.resolve()` canonicalization + `PROVISION_ENV_DIR` prefix whitelist + parent directory existence check + `{ mode: 0o600 }` file write | Path traversal; world-readable secrets file |
| **SEC-C5** | Ethos Seal gate and migrate gate wrapped in `try/catch` with explicit `42P01` handling; `process.exit(1)` on failure; fail-closed always; PRE-A1 confirmed closed | Batch runs on uninitialised DB; undefined behaviour; silent bypass |
| **SEC-C6** | `--help` output includes: `chmod 600` instruction, lost-token recovery note, `--all` requires `--write-env` note | Operator creates world-readable secret file |
| **SEC-C7** | `--revoke` uses `UPDATE agents SET active = false, updated_at = NOW()` — no `DELETE` | Loss of audit trail; forensic gap |
| **SEC-C8** | `UNIQUE` constraint on `agents.token_hash` confirmed in migration; migration added if missing | Race condition on double-provision; double-active-token risk |

**Option A is permanently blocked.** Batch token emission to stdout cannot be unblocked under any conditions. OWASP A02:2021.

No conditions were waived. All eight must be confirmed closed in the PR comment by Locksmith before merge.

---

## Rejected Alternatives

### Option A — In-place extension of `provision-agent-token.ts`
**Rejected. Permanently blocked by Locksmith.**
Reason: Batch `--all` emits all agent tokens sequentially to stdout. Secrets are captured in Docker container logs, CI/CD pipeline output, and terminal scrollback. This is OWASP A02:2021 Cryptographic Failures — the batch output model has no path to remediation within Option A's single-file architecture. Additionally, flag-collision guards (e.g. `--revoke` + `--all`) are fully manual without a parsing contract, creating a growing blast-radius risk as flags accumulate.

### Option C — Unified `agent-lifecycle.ts` subcommand CLI
**Rejected. Deferred to v0.3 with explicit re-evaluation criteria.**
Reason: The subcommand architecture is architecturally correct but over-engineered for v0.2 scope. The breaking rename of `provision-agent-token.ts` affects 7 confirmed file references. The SERIALIZABLE batch transaction is not justified at 10-agent scale. A `commander` dependency requires formal approval per ARCH-008. `--write-env` (the primary differentiator) is backported to Option B as a mandatory flag, eliminating the key value gap between B and C.

**Re-evaluation criteria for v0.3:** when a consuming system requires structured JSON output (e.g. Vault integration, CI/CD secret pipeline), or when the number of distinct provisioning operations exceeds what two scripts can cleanly express, Option C should be re-proposed with a formal deprecation plan, migration runbook, and Locksmith path-traversal review.

---

## Open Questions

| # | Question | Owner | Target |
|---|---|---|---|
| OQ-1 | When `expires_at` enforcement is activated, does it require a migration to SET NOT NULL, or is the column already present with correct defaults? | Murphy | v0.3 tech debt sprint |
| OQ-2 | SPIKE #250 (peer-agent auth in opensquad) — does its output change the token format or introduce a cross-squad auth contract that affects ARCH-014 tokens? | Silas | When SPIKE #250 closes |
| OQ-3 | Should automated rotation reminders (cron-based, 90-day advisory) be a task added to the `crons` table as part of v0.2 bootstrap? | Elizabeth | Sprint 3 backlog grooming |

---

## Changelog

| Version | Date | Author | Change |
|---|---|---|---|
| v1.0 | 2026-05-21 | Clarence (ADR) / Elizabeth (facilitation) / Silas (design) | Initial decision — Option B selected, Options A and C rejected |
