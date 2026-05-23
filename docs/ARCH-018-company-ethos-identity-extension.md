---
title: "ARCH-018 — Company/V/TO Identity Extension: Ethos Seal Payload + get_company_ethos Tool"
date: 2026-05-22
status: Decided
decision_owner: Silas
approved_by: Elizabeth
filed_by: Silas
authored_by: Silas
adr: ARCH-018
related: ARCH-013, ARCH-009, ARCH-003
tags:
  - type/adr
  - project/openhiveos
  - domain/architecture
  - domain/backend
  - domain/security
  - audience/technical
review_date: 2026-08-22
---

# ARCH-018 — Company/V/TO Identity Extension: Ethos Seal Payload + get_company_ethos Tool

**Date:** 2026-05-22
**Project:** OpenHiveOS
**Status:** Decided
**Decision Owner:** Silas
**Approved By:** Elizabeth
**Sprint:** 8 (Onboarding Sprint)
**Implements:** S8-00, S8-03
**Related:** ARCH-013 (Ethos Seal storage), ARCH-003 (Agent OS designation), ARCH-009 (SOP seeding)

---

## Context

The Ethos Seal (ARCH-013) is the constitutional document for an OpenHiveOS Squad. Its current payload covers squad identity, Five Laws, and seat definitions. It carries no company-level identity: no operator name, no mission, no strategic framing.

An operator bootstrapping OpenHiveOS for their AI squad has no way to communicate *why their company exists* and *what their three-year target looks like* to the agents. The `search_sops` tool surfaces operating procedures; no tool surfaces the strategic context those procedures serve. The result is agents that know *how* to work but lack the framing of *what they are working toward*.

The Ethos Seal is the right location for this identity. It is operator-provisioned, HMAC-signed, boot-verified, and the authoritative source of squad constitutional data. Adding company identity to the seal payload extends — rather than competes with — the existing architectural decision in ARCH-013.

This ADR answers: where does company identity live, what shape does it take, how does it get into the system, and how do agents consume it?

---

## Decision

**Company identity is an optional extension of the Ethos Seal payload.** It is not stored in `squad.manifest.json`. It is not a separate table. It is a named block (`company`) inside the existing `ethos_seals.payload JSONB` field, written at seal provisioning time and read at runtime by a new MCP tool.

### Decision 1 — Data Location

Company identity lives exclusively in `ethos_seals.payload->>'company'`. No new database tables, columns, or migrations are required for S8-03. The `ethos_seals` table schema (established by `004_ethos_seal.sql`) is unchanged. The JSONB payload column already accepts the extended object.

`squad.manifest.json` is NOT extended with a company block. The manifest is an agent registry (slugs, names, roles). Company identity is constitutional data — it belongs in the Ethos Seal, not the registry.

**Vote:** Silas (technical), Elizabeth (PM). Approved.

### Decision 2 — Payload Shape

The `company` block is added to the Ethos Seal payload with the following structure:

```json
{
  "squad": "io-labs",
  "version": 1,
  "laws": [...],
  "seats": {...},
  "company": {
    "name": "Input Output Labs",
    "mission": "We build AI teams that outperform human ones.",
    "three_year_picture": "...",
    "values": ["Radical transparency", "Systems thinking", "Ship fast, fix fast"],
    "niche": "AI agent operating systems for small professional services firms"
  }
}
```

Field constraints:
- `name` — non-empty string. The legal or operating name of the company.
- `mission` — non-empty string. A single sentence. No length limit enforced at the schema level; operators own their articulation.
- `three_year_picture` — non-empty string. A descriptive paragraph of the 3-year target state.
- `values` — non-empty array of strings. Minimum 1 value. Each entry is a non-empty string.
- `niche` — non-empty string. The EOS niche articulation: `[service] for [target market]`.

All five fields are required when the `company` block is present. A partial `company` block (some fields absent) is rejected by `one-init.ts` validation before the seal is written.

**Canonicalisation:** The `canonicalise()` function in `src/scripts/one-init.ts` sorts top-level payload keys. Murphy must also sort `company` sub-keys alphabetically before HMAC computation. The canonical key order for `company` is: `mission`, `name`, `niche`, `three_year_picture`, `values`. This ensures the HMAC is deterministic regardless of insertion order.

**Vote:** Approved.

### Decision 3 — Provisioning Path

Company identity enters the system via `src/scripts/one-init.ts`. Two provisioning paths:

**Path A — New installation (install.sh):**
`install.sh` prompts the operator for `COMPANY_NAME`, `COMPANY_MISSION`, `COMPANY_3YEAR`, `COMPANY_VALUES` (comma-separated, parsed to array), and `COMPANY_NICHE`. These are written to `.env`. `one-init.ts` reads them from environment variables — no interactive readline prompts for company fields. This makes `one-init.ts` non-interactive for company fields, which is required for `install.sh` automation.

**Path B — Existing installation (manual re-seal):**
The operator sets `COMPANY_*` env vars in `.env`, then runs `docker compose --profile init run --rm one-init --revise`. The `--revise` path is unchanged (SERIALIZABLE isolation, atomic deactivate/insert). The new company block is included in the payload.

**Env var naming (locked):**

| Env var | Maps to | Format |
|---|---|---|
| `COMPANY_NAME` | `company.name` | String |
| `COMPANY_MISSION` | `company.mission` | String |
| `COMPANY_3YEAR` | `company.three_year_picture` | String (may contain newlines; single-quoted in .env) |
| `COMPANY_VALUES` | `company.values` | Comma-separated; `one-init.ts` splits on `,` and trims each entry |
| `COMPANY_NICHE` | `company.niche` | String |

**Vote:** Approved.

### Decision 4 — Optionality and Upgrade Path

The `company` block is **optional** in the Ethos Seal payload. A seal without a `company` block is valid and will pass `checkEthosSeal()` without modification. Existing installations that upgrade from Sprint 7 to Sprint 8 do not need to re-seal. The `get_company_ethos` tool returns a defined "not configured" response when the active seal payload contains no `company` block.

This is an additive extension, not a breaking change. The HMAC covers the full payload as written — a seal without `company` produces a valid HMAC over the payload-without-company. A seal with `company` produces a valid HMAC over the payload-with-company. Both pass the boot integrity check.

The only scenario where an existing install must re-seal is if the operator *wants* agents to have access to company context via `get_company_ethos`. That is a voluntary operation, not a mandatory one.

**Vote:** Approved.

### Decision 5 — `get_company_ethos` MCP Tool

A new MCP tool `get_company_ethos` is added to the OpenHiveOS MCP server. It is classified as a **Coordination Utility** (not an OS Primitive) — company context is useful operational framing, not load-bearing identity infrastructure. It can evolve without backwards compatibility guarantees.

**Tool contract:**

```typescript
// Input schema — no parameters
const getCompanyEthosSchema = z.object({})

// Response — company block from active ethos_seals row
// If company block is absent: { configured: false, message: '...' }
// If company block is present: { configured: true, ...companyFields }
```

**Implementation:**
1. Query `SELECT payload FROM ethos_seals WHERE is_active = TRUE LIMIT 1`
2. If no active seal: return `{ configured: false, message: 'Ethos Seal not provisioned. Run one-init.' }`
3. If seal has no `company` block: return `{ configured: false, message: 'Company identity not configured. Run one-init --revise with COMPANY_* env vars.' }`
4. If seal has `company` block: return `{ configured: true, name, mission, three_year_picture, values, niche }`

**Auth:** Standard bearer token auth (same as all MCP tools). The tool is read-only. No agent slug required in the response — company context is squad-wide.

**Data source:** `ethos_seals` table via `opensquad_app` role (the MCP server connection). The `openhiveos_reader` role (squad-api) already has SELECT on `ethos_seals` via `GET /api/ethos-seal`. No new DB permission grants required.

**Vote:** Approved.

### Decision 6 — ARCH-013 Cross-Repo Gate

The ARCH-013 simultaneous build requirement applies to the `ethos_seals` **table schema** (columns, indexes, constraints). S8-03 does not change the `ethos_seals` table schema — it extends the payload content (a JSONB field). The ARCH-013 gate is **not triggered** by S8-03.

`get_company_ethos` is an OpenHiveOS-only tool. It is not required in `opensquad-mcp-server`. The IO Labs factory squad operates with company context established through other means (ARCH-003, the Factory identity model). There is no parallel tool requirement for the parent repo.

**Vote:** Approved.

---

## Trade-offs Accepted

- **Optional company block creates a two-tier operator experience.** Operators who provision company context get richer agent behaviour via `get_company_ethos`. Operators who skip it get agents without company framing. This is accepted — company context is a sprint 8 capability, not a constitutional requirement. `install.sh` strongly guides new operators toward providing it.
- **COMPANY_VALUES is comma-delimited in env, array in payload.** This creates a parsing step (`split(',').map(s => s.trim())`). Values containing commas are not supported. Operators who need a value with a comma must use a semicolon separator or rephrase the value. This edge case is documented in the runbook.
- **No migration needed = no fingerprint coverage.** `checkFingerprint()` only validates table existence. It does not inspect payload structure. A deployed instance with no `company` block in the seal will pass `checkFingerprint()` and `checkEthosSeal()` regardless. This is correct behaviour — payload shape is the responsibility of the provisioning CLI, not the integrity check.
- **Company data is inside the HMAC but not encrypted.** The `payload` JSONB field is stored in plaintext. Anyone with database read access can read the company name, mission, and values. This is accepted — this data is intended for agent consumption and is not classified. DB access control (ARCH-007, `007_db_roles_sec7.sql`) is the boundary.

---

## Consequences

**S8-03 implementation scope:**

1. **`src/scripts/one-init.ts`**: Read `COMPANY_NAME`, `COMPANY_MISSION`, `COMPANY_3YEAR`, `COMPANY_VALUES`, `COMPANY_NICHE` from `process.env`. Skip readline prompts for company fields if all five are set. Validate that all five are present (or all five are absent — partial config is rejected). Construct `payload.company` object. Apply canonical key ordering (`mission`, `name`, `niche`, `three_year_picture`, `values`) before HMAC computation. Write updated `.env.example` entry for each var.

2. **`src/db/ethos-seal.ts` / `src/types/`**: Extend `EthosSealPayload` TypeScript type to include `company?: CompanyEthos`. Define `CompanyEthos` type. Zod schema extension mirrors the payload shape.

3. **`src/utilities/get-company-ethos.ts`** (new file): Handler + Zod schema for `get_company_ethos` tool. DB query pattern mirrors existing utilities.

4. **`src/index.ts`**: Register `get_company_ethos` in the Coordination Utilities block.

5. **`.env.example`**: Add the five `COMPANY_*` entries with inline comments.

6. **No migration required.** No schema changes.

**Boot sequence:** No change. `checkEthosSeal()` at Step 3.5 operates on the full payload hash — it does not inspect payload structure. A seal without `company` is valid. A seal with `company` is valid.

**install.sh (S8-05a):** Must prompt for all five company fields and write them to `.env`. After company prompts, one-init runs non-interactively (reads from env). Order in script: company fields collected in steps 1-5, written to .env, then one-init is invoked.

---

## Security Review

This ADR is scoped for Locksmith review (S8-08, Surface 2 — `get_company_ethos` tool). Locksmith conditions from Sprint 8 planning:

- The `get_company_ethos` tool is read-only. No write path via MCP. Satisfies SEC-B9 extended to cover company data.
- Company data in the JSONB payload is not classified as PII or regulated data. No encryption-at-rest requirement beyond existing DB access controls.
- **SEC-D7 (new, this ADR):** `COMPANY_VALUES` parsing: the `split(',')` operation must be applied before payload construction, not deferred. An operator-supplied value of `"foo","bar"` (quoted CSV) must be handled gracefully — strip surrounding quotes before storing. Validate that the resulting array contains no empty strings after trim.
- **SEC-D8 (new, this ADR):** `get_company_ethos` response must not appear in Morgan request logs if squad-api exposes a companion REST endpoint in a later sprint. This condition is prospective — no squad-api route exists for this tool in Sprint 8.

---

## Rejected Alternatives

- **Extend `squad.manifest.json` with a `company` block:** Rejected. The manifest is an agent registry. Company identity is constitutional data with integrity guarantees. Mixing them into a single file creates a parsing ambiguity: `squad.manifest.json` is read by both `one-init.ts` and `src/squad/manifest.ts` at different lifecycle points. The Ethos Seal is the authoritative identity source; the manifest is not. Separating the concerns is correct architecture.
- **New `company_identity` table:** Rejected. The `ethos_seals` JSONB payload is already the constitutional data store. A separate table would duplicate the integrity model (two things to sign, two things to check at boot) without benefit. The JSONB extension is an additive change with no new infrastructure.
- **`get_company_ethos` as OS Primitive:** Rejected. Company context is strategic framing — useful but not load-bearing identity infrastructure. Agents function correctly without it. Elevating it to OS Primitive would add backwards compatibility obligations to a first-sprint feature. Coordination Utility is the correct tier for Sprint 8.

---

## Open Conditions

None. This ADR is complete as filed.

---

*ARCH-018 authored and owned by Silas. Approved by Elizabeth 2026-05-22.*
*Sprint 8 implementation: S8-00 (this ADR), S8-03 (Murphy implementation).*
*Review date: 2026-08-22 or upon Sprint 9 scope finalisation, whichever is sooner.*
