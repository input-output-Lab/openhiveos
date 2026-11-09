-- 029_dashboard_sessions.sql
--
-- S18-SEC-03 (#2642): retire the bearer-in-bundle dashboard token.
-- Source: docs/minutes/2026-10-30-agent-browser-session-auth.md
--
-- Replaces the build-time-baked VITE_DASHBOARD_AGENT_TOKEN with
-- human login sessions:
--
--   POST /api/auth/login  — password (DASHBOARD_PASSWORD env) → session
--   GET  /api/auth/session— whoami for the current session
--   POST /api/auth/logout — invalidate current session
--
-- Sessions are opaque 256-bit random tokens. Only the SHA-256 hash is
-- persisted; the raw token exists solely in the HttpOnly session cookie.
-- Sessions expire after 24h (idletimeout handled by expires_at check on
-- every authMiddleware pass — sliding expiry is intentionally out of
-- scope for this task).
--
-- Principal: 'dashboard' — a non-agent principal for the human operator.
-- Attribution rows (task_status_history, audit_log) written on behalf of
-- dashboard actions use hive.actor = 'dashboard' via withActor().
--
-- Locksmith condition (2026-10-30): "bearer-in-bundle retired on any
-- production path." This migration is the storage half; the auth
-- middleware fallback and routes are the enforcement half.
--
-- Rollback: migrations/rollback_029_dashboard_sessions.sql
-- Run with: psql "$DATABASE_URL" -f migrations/029_dashboard_sessions.sql

BEGIN;

CREATE TABLE IF NOT EXISTS dashboard_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  TEXT NOT NULL UNIQUE,
  principal   TEXT NOT NULL DEFAULT 'dashboard'
              CHECK (principal IN ('dashboard')),
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- O(1) hash lookup on every authenticated dashboard request.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_sessions_token_hash
  ON dashboard_sessions (token_hash);

-- Login garbage collection (expired session cleanup).
CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_expires_at
  ON dashboard_sessions (expires_at);

COMMIT;
