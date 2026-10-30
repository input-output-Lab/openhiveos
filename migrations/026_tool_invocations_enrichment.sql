-- migrations/026_tool_invocations_enrichment.sql
-- S16-DB-03 (#2543): enrich tool_invocations for analytics
--
-- Founder directive: "log everything" — but tag it, don't lose it. Every new
-- column is nullable/additive so historical rows (6,260+) stay valid.
--
-- Columns added:
--   session_id      — MCP session correlation (gateway-level; NOT the LLM
--                     session_id format from llm_usage — different lifecycle)
--   request_id      — per-JSON-RPC request id from the transport
--   task_id         — soft ref: task the call relates to (from args when the
--                     tool takes one; #2547+ wiring can add current-WIP later)
--   project_id      — soft ref: resolved when task_id present (single join at
--                     write time saves the rollup query a join at read time)
--   client_surface  — which client fronted the call (vscode-copilot | claude-code |
--                     bridge | cli | cron | api) — 'unknown' for legacy rows
--   actor_type      — agent | automation | human : tags traffic rather than
--                     dropping it (Founder D8). gateway calls = agent;
--                     internal/scheduled callers = automation.
--   arg_keys        — TEXT[] of argument KEY NAMES (analytics: which tools take
--                     which args). Never values.
--   args_hash       — sha256 of canonical JSON of argument VALUES. Enables
--                     duplicate-call detection WITHOUT storing secrets.
--                     Locksmith condition: hash only — raw args never stored
--                     (they routinely contain file contents, notes, tokens).
--   error_message   — full error text when success=false (error_class alone
--                     loses the detail needed for #2567 audit runbooks)
--   response_bytes  — response size; cheap proxy for result weight
--
-- Indexes per AC: (session_id), (task_id).
--
-- Rollback: migrations/rollback_026_tool_invocations_enrichment.sql
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE tool_invocations
  ADD COLUMN session_id     TEXT,
  ADD COLUMN request_id     TEXT,
  ADD COLUMN task_id        BIGINT,
  ADD COLUMN project_id     BIGINT,
  ADD COLUMN client_surface TEXT,
  ADD COLUMN actor_type     TEXT,
  ADD COLUMN arg_keys       TEXT[],
  ADD COLUMN args_hash      TEXT,
  ADD COLUMN error_message  TEXT,
  ADD COLUMN response_bytes INTEGER;

ALTER TABLE tool_invocations
  ADD CONSTRAINT chk_tool_invocations_client_surface
    CHECK (client_surface IS NULL OR client_surface IN
      ('vscode-copilot', 'claude-code', 'bridge', 'cli', 'cron', 'api', 'unknown')),
  ADD CONSTRAINT chk_tool_invocations_actor_type
    CHECK (actor_type IS NULL OR actor_type IN ('agent', 'automation', 'human'));

CREATE INDEX idx_tool_invocations_session_id ON tool_invocations (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_tool_invocations_task_id    ON tool_invocations (task_id)    WHERE task_id IS NOT NULL;
CREATE INDEX idx_tool_invocations_actor      ON tool_invocations (actor_type, called_at) WHERE actor_type IS NOT NULL;

COMMIT;
