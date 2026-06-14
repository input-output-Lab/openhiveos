-- migrations/017_tool_invocations.sql
-- Track 1 — MCP Gateway Activity Logging
--
-- Context: ARCH-022 / Sprint 12 telemetry foundation.
-- Creates the `tool_invocations` table, which records every MCP tool call
-- as it passes through the OpenHiveOS MCP gateway. This is gateway-level
-- instrumentation — the gateway's vantage point on every tool call regardless
-- of which MCP server handles the downstream request.
--
-- Architectural layer distinction (do not confuse these):
--   factory_tool_usage  — tool-handler-level middleware INSIDE opensquad-mcp-server.
--                         Lives in the opensquad DB. Captures tool-specific context
--                         from the server's own perspective. Sprint 2026-05-16.
--   tool_invocations    — gateway-level instrumentation in the OpenHiveOS DB.
--                         Captures transport, wall-clock duration, and success/error
--                         for ALL calls through the gateway. Complementary layers.
--                         This table is the gateway's view; factory_tool_usage is
--                         the server's view. Dual-layer is intentional (Silas ruling
--                         2026-06-14).
--
-- Index strategy decisions (Silas OQ-1 and OQ-2):
--
--   OQ-1: BRIN index on called_at.
--         tool_invocations is an append-only time-series table. Rows are inserted
--         in called_at order and never updated. BRIN is the correct index type:
--         it stores min/max called_at per 128-page block, costs ~100x less storage
--         than a B-tree, and is equally effective for range scans on monotonically
--         increasing time columns. A B-tree on called_at would be wasteful here.
--
--   OQ-2: Composite index (agent_slug, tool_name, called_at DESC).
--         The dominant analytics query pattern is: "for agent X, what tools were
--         called most recently?" This composite covers that pattern with an
--         index-only scan. Single-column indexes on agent_slug and tool_name are
--         also present for independent filter queries.
--
-- source column purpose:
--   'gateway'           — call logged by the MCP gateway (T1-2, T1-3). Default.
--   'vscode_self_report' — agent reported its own session end via report_usage
--                          (T3-2 protocol). Different code path; no transport or
--                          duration_ms available. Allows analytics to separate
--                          gateway-observed calls from self-reported sessions.
--
-- agent_slug: soft reference to agents(slug). No FK constraint — consistent with
--   005_llm_usage.sql. An agent slug may appear in tool_invocations before the
--   agents row is provisioned (e.g., during onboarding). A FK would silently block
--   the fire-and-forget INSERT in the gateway, which must never crash on a DB error.
--   Operational correctness relies on agents being provisioned before their calls
--   are logged. This decision is documented here, not enforced at the schema level.
--
-- Writer role: openhiveos (superuser — INSERT access, no extra GRANT needed).
--   Consistent with ALTER DEFAULT PRIVILEGES in 003_squad_api_role.sql.
-- Reader role: openhiveos_reader — explicit GRANT SELECT below.
--
-- Depends on: no prior migration dependency (schema-standalone).
-- This migration must be applied before T1-2 (#1775) and T1-3 (#1776) are deployed.
--
-- Run with:
--   psql "$DATABASE_URL" -f migrations/017_tool_invocations.sql
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- tool_invocations
--
-- One row per MCP tool call observed by the gateway.
-- Inserted fire-and-forget in the gateway handler's finally block.
-- DB write failures must not surface to the caller — structured .catch() required.
-- ---------------------------------------------------------------------------

CREATE TABLE tool_invocations (
  id          BIGSERIAL    PRIMARY KEY,

  -- Agent that made the call. Soft reference — no FK (see header note).
  agent_slug  TEXT         NOT NULL,

  -- Fully-qualified tool name as received by the gateway (e.g. 'store_thought').
  tool_name   TEXT         NOT NULL,

  -- Transport channel through which the call arrived.
  transport   TEXT         NOT NULL
    CONSTRAINT chk_tool_invocations_transport
    CHECK (transport IN ('streamable_http', 'sse', 'stdio')),

  -- Who logged this row. Default 'gateway' for T1-2/T1-3 logging.
  -- 'vscode_self_report' for agent self-reporting via report_usage (T3-2).
  source      TEXT         NOT NULL DEFAULT 'gateway'
    CONSTRAINT chk_tool_invocations_source
    CHECK (source IN ('gateway', 'vscode_self_report')),

  -- Wall-clock timestamp of the call (gateway receives the request).
  called_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Wall-clock duration in milliseconds (gateway perspective).
  -- NULL is valid for self-reported rows where no timing is available.
  duration_ms INTEGER,

  -- Whether the tool call completed without error from the gateway's perspective.
  success     BOOLEAN      NOT NULL DEFAULT true,

  -- Error class name when success = false (e.g. 'TimeoutError', 'UnknownError').
  -- NULL when success = true.
  error_class TEXT
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Per-agent activity queries: "show all calls by agent X in the last 7 days"
CREATE INDEX idx_tool_invocations_agent_called_at
  ON tool_invocations (agent_slug, called_at);

-- Per-tool frequency queries: "how often is store_thought called?"
CREATE INDEX idx_tool_invocations_tool_called_at
  ON tool_invocations (tool_name, called_at);

-- Composite index for dominant analytics pattern (OQ-2 ruling):
-- "for agent X, which tools were called most recently?"
-- Covers: WHERE agent_slug = $1 AND tool_name = $2 ORDER BY called_at DESC
CREATE INDEX idx_tool_invocations_agent_tool_time
  ON tool_invocations (agent_slug, tool_name, called_at DESC);

-- BRIN index on called_at for time-range scans (OQ-1 ruling).
-- Append-only insert order matches physical storage order — BRIN is correct here.
-- ~100x smaller than a B-tree for equivalent time-range query performance.
CREATE INDEX idx_tool_invocations_called_at_brin
  ON tool_invocations USING BRIN (called_at);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Reader role: SELECT only (analytics, dashboard queries)
GRANT SELECT ON tool_invocations TO openhiveos_reader;

-- Sequence: reader does not need USAGE (read-only consumers don't INSERT)
-- openhiveos (superuser) has INSERT via ALTER DEFAULT PRIVILEGES (003_squad_api_role)

COMMIT;
