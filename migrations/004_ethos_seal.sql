-- migrations/004_ethos_seal.sql
-- ARCH-013: Ethos Seal storage table
--
-- SCHEMA RULING — Silas, 2026-05-21 (#1356):
--
--   UNIQUE partial index (WHERE is_active = TRUE) over singleton pointer
--   (ethos_seal_config table with current_seal_id FK).
--
--   Rationale:
--   1. DB-level enforcement: the partial UNIQUE index prevents two active
--      rows regardless of application bugs or direct psql intervention.
--      A singleton pointer table does not prevent a manual INSERT with
--      is_active = TRUE on a separate ethos_seals column.
--   2. Audit history is inherent: all is_active = FALSE rows are the
--      historical record. No secondary history table. Version history
--      for GET /api/ethos-seal is a plain WHERE is_active = FALSE query.
--   3. Single-table query surface: SELECT WHERE is_active = TRUE is
--      simpler for checkEthosSeal() and squad-api than a JOIN against
--      ethos_seal_config. The openhiveos_reader role applies cleanly.
--   4. The SERIALIZABLE isolation requirement exists for BOTH approaches.
--      The singleton pointer's atomicity advantage is illusory — INSERT
--      new row + UPDATE pointer still requires SERIALIZABLE to prevent
--      concurrent revision races. No advantage over deactivate + INSERT.
--   5. Murphy's one-init.ts SERIALIZABLE retry wrapper is already wired
--      for the deactivate/insert pair. No rework required.
--
--   Singleton pointer: rejected.
--
-- --revise atomicity:
--   Within a SERIALIZABLE transaction:
--     UPDATE ethos_seals SET is_active = FALSE WHERE is_active = TRUE;
--     INSERT INTO ethos_seals (..., is_active = TRUE, ...);
--   The UNIQUE partial index prevents a second INSERT with is_active = TRUE
--   from succeeding in a concurrent transaction. If two sessions race, one
--   gets a serialization failure (error 40001) and retries. This is correct.
--
-- version column derivation:
--   scripts/one-init.ts derives version inside the SERIALIZABLE transaction:
--     COALESCE(MAX(version), 0) + 1
--   First init: version = 1. Each --revise: previous_version + 1.
--   This must be computed inside the transaction to be safe under SERIALIZABLE.
--
-- activated_by values:
--   'cli:init'     — first-time initialisation
--   'cli:revise'   — --revise flag
--   'cli:recovery' — key recovery ceremony (OQ-2, v0.3)
--
-- Dual-repo simultaneity (ARCH-013 OQ-6, Nova ruling):
--   This migration must be applied to opensquad-mcp-server simultaneously.
--   Same column names, same constraint names, same index names.
--   Silas owns the canonical definition — opensquad-mcp-server adopts it.
--
-- openhiveos_reader grants:
--   Covered automatically by ALTER DEFAULT PRIVILEGES in 003_squad_api_role.sql.
--   No explicit GRANT needed here.

BEGIN;

CREATE TABLE ethos_seals (
  id            BIGSERIAL   PRIMARY KEY,

  -- Monotonically incrementing revision counter.
  -- Derived in SERIALIZABLE transaction: COALESCE(MAX(version), 0) + 1.
  version       INT         NOT NULL,

  -- Full structured seal content: squad name, agents, Five Laws, seat definitions.
  payload       JSONB       NOT NULL,

  -- HMAC-SHA256(canonical_payload_json, ETHOS_SEAL_SECRET).
  -- Hex-encoded. Verified by checkEthosSeal() at boot via crypto.timingSafeEqual.
  -- v0.2 interim — Ed25519 required by v0.3 (SEC-B1, ARCH-013).
  signature     TEXT        NOT NULL,

  -- SHA-256(canonical_payload_json) — content fingerprint without the HMAC key.
  -- Useful for change detection and deduplication independent of ETHOS_SEAL_SECRET.
  -- Hex-encoded.
  payload_hash  TEXT        NOT NULL,

  -- Only one row may have is_active = TRUE at any time.
  -- Enforced by the UNIQUE partial index below.
  -- Default FALSE: new rows are inactive until the INSERT completes successfully.
  is_active     BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Wall-clock time the seal was activated (set by one-init.ts at INSERT time).
  activated_at  TIMESTAMPTZ NOT NULL,

  -- Provisioning context: 'cli:init' | 'cli:revise' | 'cli:recovery'
  activated_by  TEXT        NOT NULL,

  -- Row creation timestamp (INSERT time, set by DB).
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Singleton active seal constraint (core of the schema ruling)
--
-- A UNIQUE index on (is_active) WHERE is_active = TRUE means:
--   all rows in this index have is_active = TRUE (the same boolean value),
--   and uniqueness is enforced across those rows,
--   so at most one row can have is_active = TRUE.
--
-- This is a PostgreSQL idiom for singleton-active-row patterns.
-- The constraint is enforced at the storage engine level — no application
-- code can bypass it, including direct psql sessions.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX ethos_seals_one_active
  ON ethos_seals (is_active)
  WHERE is_active = TRUE;

-- Version index: used by one-init.ts to derive the next version number
-- (MAX(version)) and by GET /api/ethos-seal version history queries.
CREATE INDEX idx_ethos_seals_version ON ethos_seals (version);

-- Signature index: used by checkEthosSeal() — the boot-time integrity check
-- queries the active row's signature for timingSafeEqual comparison against
-- the ethos.seal.json file signature.
CREATE INDEX idx_ethos_seals_signature ON ethos_seals (signature);

COMMIT;
