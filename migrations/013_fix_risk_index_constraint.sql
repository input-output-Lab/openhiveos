-- migrations/013_fix_risk_index_constraint.sql
-- Corrective migration: align risk_index with confirmed 1/3/5 categorical domain.
--
-- Context: Migration 012 added risk_index with CHECK (BETWEEN 1 AND 5) and
-- DEFAULT 1 NOT NULL. This is inconsistent with the confirmed domain decision
-- (Richo, 2026-06-11, ARCH-021): all four portfolio matrix fields accept only
-- categorical values 1, 3, or 5. Values 2 and 4 are invalid.
--
-- This migration:
--   1. Drops the incorrect CHECK constraint
--   2. Adds the correct IN (1, 3, 5) constraint
--   3. Drops the DEFAULT 1 (null = not yet scored, consistent with other fields)
--   4. Makes the column nullable (consistent with business_value, strategic_fit, effort)
--
-- All existing risk_index = 1 rows remain valid (1 ∈ {1, 3, 5}).
-- No data is lost or corrupted by this migration.
--
-- See ARCH-021 for ruling authority.

BEGIN;

-- Step 1: Drop the incorrect check constraint
-- PostgreSQL names auto-generated constraints as <table>_<column>_check
ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_risk_index_check;

-- Step 2: Drop the default
ALTER TABLE projects
  ALTER COLUMN risk_index DROP DEFAULT;

-- Step 3: Make nullable (null = not yet scored)
ALTER TABLE projects
  ALTER COLUMN risk_index DROP NOT NULL;

-- Step 4: Add the correct constraint
ALTER TABLE projects
  ADD CONSTRAINT projects_risk_index_check
    CHECK (risk_index IN (1, 3, 5));

COMMIT;
