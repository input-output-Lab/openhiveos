-- migrations/021_one_seal.sql
-- ARCH-025: One Seal storage table
--
-- Protects The One's operational protocols (spawn-protocol and agent-outline
-- SOPs) from being tampered with in the database. The One Seal is initialised
-- by scripts/one-init.ts after the Ethos Seal and checked at boot Step 3.6,
-- immediately after the Ethos Seal check (Step 3.5).
--
-- SCHEMA RULING — mirrors 004_ethos_seal.sql conventions exactly (Silas):
--
--   UNIQUE partial index (WHERE is_active = TRUE) enforces at most one active
--   seal at any time. Deactivate existing row + insert new row within the same
--   SERIALIZABLE transaction (same retry pattern as ethos_seals).
--
-- HMAC input:
--   stableStringify({ agentOutline: <file-content>, spawnProtocol: <file-content> })
--   Keys sorted alphabetically — identical serialisation discipline to Ethos Seal.
--   The HMAC key is ONE_SEAL_SECRET (env var). NOT re-derived at runtime —
--   checkOneSeal() compares stored-vs-stored only (Locksmith SEC-B ruling).
--
-- sealed_by values:
--   'cli:init'   — first-time initialisation via one-init.ts
--   'cli:revise' — --revise flag via one-init.ts
--
-- openhiveos_reader grants:
--   Covered automatically by ALTER DEFAULT PRIVILEGES in 003_squad_api_role.sql.
--   No explicit GRANT needed here.

BEGIN;

CREATE TABLE one_seals (
  id          SERIAL      PRIMARY KEY,

  -- HMAC-SHA256(stableStringify({ agentOutline, spawnProtocol }), ONE_SEAL_SECRET).
  -- Hex-encoded. Verified by checkOneSeal() at boot via crypto.timingSafeEqual.
  -- ARCH-025 note: Ed25519 migration path applies here (same as ethos_seals).
  signature   TEXT        NOT NULL,

  -- Wall-clock time the seal was activated (set by one-init.ts at INSERT time).
  sealed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Provisioning context: 'cli:init' | 'cli:revise'
  sealed_by   TEXT        NOT NULL DEFAULT 'cli:init',

  -- Only one row may have is_active = TRUE at any time.
  -- Enforced by the UNIQUE partial index below.
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------------
-- Singleton active seal constraint — mirrors ethos_seals convention exactly.
--
-- A UNIQUE index on (is_active) WHERE is_active = TRUE means at most one
-- row can have is_active = TRUE. Concurrent INSERT attempts serialise correctly
-- under SERIALIZABLE isolation (Postgres error 40001 on conflict → retry).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX one_seals_active_idx
  ON one_seals (is_active)
  WHERE is_active = TRUE;

COMMIT;
