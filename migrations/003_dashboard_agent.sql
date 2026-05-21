-- migrations/003_dashboard_agent.sql
-- ARCH-012 SEC-A1: Dashboard named principal
--
-- Inserts the dashboard system agent into the agents table.
-- The dashboard agent is the principal used by squad-api to authenticate
-- operator requests to the embedded dashboard.
--
-- Token provisioning:
--   This migration creates the row with active = false and a non-functional
--   placeholder token. The real token is provisioned by running:
--     npx tsx scripts/provision-agent-token.ts dashboard
--   which upserts token_hash/token_salt and sets active = true.
--
--   Until provisioning runs, the dashboard row exists but cannot authenticate
--   any request (active = false, token unknown to any operator).
--
-- Why active = false?
--   Defence-in-depth (ARCH-012 SEC-A1). Even if the placeholder token hash
--   somehow collided with a supplied token, the inactive flag blocks auth.
--   The row becomes usable only after an operator explicitly provisions it.
--
-- ON CONFLICT DO NOTHING: idempotent — safe on existing deployments and
-- safe after the new schema_migrations gate (will not re-run, but guarded
-- here regardless for belt-and-suspenders correctness).
--
-- Applies as: migration 003 (second of two 003-prefixed files, alphabetical)
-- 003_dashboard_agent.sql (d) runs before 003_squad_api_role.sql (s).
-- No dependency between the two files — INSERT into agents does not require
-- the openhiveos_reader role to exist.

BEGIN;

INSERT INTO agents (
  slug,
  display_name,
  token_hash,
  token_salt,
  active,
  created_at,
  updated_at
) VALUES (
  'dashboard',
  'Dashboard',
  -- Placeholder: sha256 of a known constant. Never used for auth.
  -- Rotated to a real token by scripts/provision-agent-token.ts dashboard.
  encode(sha256('__dashboard_migration_placeholder__'::bytea), 'hex'),
  -- Placeholder salt: 32 zero hex chars (satisfies NOT NULL, visually distinct)
  '00000000000000000000000000000000',
  false,   -- NOT active until provision-agent-token.ts sets active = true
  NOW(),
  NOW()
)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
