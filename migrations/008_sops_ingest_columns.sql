-- migrations/008_sops_ingest_columns.sql
-- OpenHiveOS — SOP seeding: content_hash + source_namespace columns
--
-- Implements: ARCH-009 Decision 4, Sprint 8 S8-01
--
-- Adds two columns to the sops table required before the SOP ingest runner
-- (S8-02) can be built:
--
--   content_hash TEXT
--     SHA-256 hash of the raw .md file content (including frontmatter).
--     NULL on existing rows — backfilled automatically at first ingest.
--     Enables idempotent re-runs: if the hash is unchanged, the ingest
--     runner skips the file without an embedding API call.
--
--   source_namespace TEXT NOT NULL DEFAULT 'core'
--     Provenance of the SOP: 'core' (IO Labs shipped) or 'operator' (added
--     by the Operator). Assigned exclusively by the ingest runner based on
--     directory path — no API input or frontmatter field can override it.
--     Constraint enforced at the DB level (CHECK) as the authoritative
--     boundary (ARCH-009 Decision 2).
--
-- Index: secondary index on content_hash for upgrade diffing queries
-- (detecting which SOPs have changed without a full table scan).
--
-- The existing unique partial index on source_path (idx_sops_source_path,
-- migration 001_init.sql) is unchanged. The ingest runner uses a SELECT-
-- first pattern keyed on source_path — no ON CONFLICT required.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

BEGIN;

ALTER TABLE sops
  ADD COLUMN IF NOT EXISTS content_hash     TEXT,
  ADD COLUMN IF NOT EXISTS source_namespace TEXT NOT NULL DEFAULT 'core'
    CONSTRAINT sops_source_namespace_check
    CHECK (source_namespace IN ('core', 'operator'));

-- Secondary index for upgrade diffing
CREATE INDEX IF NOT EXISTS idx_sops_content_hash
  ON sops(content_hash)
  WHERE content_hash IS NOT NULL;

COMMIT;
