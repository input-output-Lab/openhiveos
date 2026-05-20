-- migrations/001_init.sql
-- OpenHiveOS — founding schema
--
-- Five tables: agents, sops, memories, thoughts, dispositions.
--
-- Scope decisions (locked, do not reverse without a new ADR):
--
--   IN scope:  agents · sops · memories · thoughts · dispositions
--   OUT scope: tasks · projects · crons (Coordination Utility tier — separate migration set)
--
--   task_id appears in memories and thoughts as a soft reference (INT NULL, no FK).
--   Adding a FK to a table that does not yet exist would couple the OS Primitive
--   tier to the Coordination Utility tier at the schema level, violating ARCH-003.
--   The FK is deferred to the migration that introduces the tasks table.
--
-- Index parameters:
--   All HNSW indexes: m=16, ef_construction=128.
--   Source migrations used ef_construction=64; 128 was the correct value per
--   Argus schema sign-off and is applied here from day one.
--
-- Run with:
--   psql "$DATABASE_URL" -f migrations/001_init.sql
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- Shared trigger function
-- Used by: sops, dispositions (auto-update updated_at on every row change)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- agents
--
-- Identity layer. FK anchor for thoughts and dispositions.
-- Replaces the hardcoded CHECK constraints on agent_name that existed in the
-- source schema — membership is now enforced at the DB level via FK, and at
-- the application level via squad.manifest.json + isValidAgentSlug().
--
-- Token auth columns (token_hash, token_salt, etc.) are included in the
-- founding schema. Agents are provisioned via a separate seeding script —
-- this migration creates structure only, no seed rows.
-- ---------------------------------------------------------------------------

CREATE TABLE agents (
  id                        SERIAL      PRIMARY KEY,
  slug                      TEXT        NOT NULL UNIQUE,
  display_name              TEXT        NOT NULL,
  token_hash                TEXT        NOT NULL UNIQUE,
  token_salt                TEXT        NOT NULL,
  previous_token_hash       TEXT,
  previous_token_salt       TEXT,
  previous_token_expires_at TIMESTAMPTZ,
  last_used_at              TIMESTAMPTZ,
  expires_at                TIMESTAMPTZ,
  active                    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every authenticated request hits this path
CREATE INDEX idx_agents_token_hash ON agents(token_hash);

-- Grace-period rotation: previous token checked while new token settles
CREATE INDEX idx_agents_previous_token_hash ON agents(previous_token_hash)
  WHERE previous_token_hash IS NOT NULL;

-- Active agent queries (squad management, health checks)
CREATE INDEX idx_agents_active ON agents(active)
  WHERE active = TRUE;

CREATE TRIGGER agents_set_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- sops
--
-- Standard Operating Procedures. Source table name is already clean.
-- agent TEXT NULL: SOPs may be squad-wide (agent IS NULL) or agent-specific.
-- Not FKed to agents — a SOP can pre-exist an agent row, and squad-wide
-- SOPs have no agent attribution by design.
-- embedding nullable: SOPs are imported from markdown files; embedding is
-- computed async at load time. Partial HNSW index excludes un-embedded rows.
-- ---------------------------------------------------------------------------

CREATE TABLE sops (
  id          SERIAL      PRIMARY KEY,
  category    TEXT        NOT NULL,
  agent       TEXT,
  instruction TEXT        NOT NULL,
  embedding   vector(768),
  source_path TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sops_embedding ON sops
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 128)
  WHERE embedding IS NOT NULL;

CREATE INDEX idx_sops_category ON sops(category);

-- Prevents duplicate SOP rows for the same source file on re-import
CREATE UNIQUE INDEX idx_sops_source_path ON sops(source_path)
  WHERE source_path IS NOT NULL;

CREATE TRIGGER sops_set_updated_at
  BEFORE UPDATE ON sops
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- memories
--
-- Long-term agent memory store. Renamed from factory_memory — "factory" was
-- an internal namespace artifact from the source system with no meaning here.
--
-- Key change from source: agent_slug is a first-class column with a FK to
-- agents(slug). The source had no agent attribution on the row, making
-- per-agent memory queries a full scan on metadata.
--
-- embedding NOT NULL: a memory without an embedding cannot be retrieved by
-- semantic search and has no value. If the embedding API fails at write time,
-- fail the insert — do not store a ghost row.
--
-- task_id: soft reference only. FK deferred until tasks table exists.
-- ---------------------------------------------------------------------------

CREATE TABLE memories (
  id         SERIAL      PRIMARY KEY,
  agent_slug TEXT        NOT NULL REFERENCES agents(slug),
  content    TEXT        NOT NULL,
  embedding  vector(768) NOT NULL,
  task_id    INT,                            -- soft ref: tasks are Coordination Utility tier
  metadata   JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Required HNSW — embedding is NOT NULL so no partial filter needed
CREATE INDEX idx_memories_embedding ON memories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);

-- Primary query pattern: per-agent memory retrieval
CREATE INDEX idx_memories_agent_slug ON memories(agent_slug);

-- Time-ordered listing and recency filtering
CREATE INDEX idx_memories_created_at ON memories(created_at DESC);

-- JSONB metadata key lookups (source attribution, tags, etc.)
CREATE INDEX idx_memories_metadata ON memories USING gin(metadata);

-- ---------------------------------------------------------------------------
-- thoughts
--
-- Agent thought stream. Renamed from agent_thoughts — the agent_ prefix is
-- redundant in a product where every row is agent-owned.
--
-- Key changes from source:
--   - agent_name dropped entirely. agent_slug FKed to agents(slug) is the
--     sole agent identifier. Display name lives in agents.display_name.
--   - Hardcoded CHECK constraint on agent names replaced by FK enforcement.
--   - auto_persist_candidate, ratified_by, ratified_at, auto_persisted added
--     (these were added across migrations 006–011 in the source; consolidated
--     here into the founding schema).
--   - confidence: FLOAT (source used FLOAT correctly; confirmed).
--   - embedding nullable: thoughts are captured immediately; embeddings are
--     written async post-ratification. Partial HNSW index excludes nulls.
--
-- task_id: soft reference only. FK deferred until tasks table exists.
-- ---------------------------------------------------------------------------

CREATE TABLE thoughts (
  id                     SERIAL      PRIMARY KEY,
  agent_slug             TEXT        NOT NULL REFERENCES agents(slug),
  session_id             TEXT,
  task_id                INT,                           -- soft ref: Coordination Utility tier
  thought                TEXT        NOT NULL,
  thought_type           TEXT        NOT NULL DEFAULT 'analysis',
  confidence             FLOAT       CHECK (confidence BETWEEN 0.0 AND 1.0),
  raw_behavior           TEXT,
  expressed_behavior     TEXT,
  disposition_snapshot   JSONB,
  must_surface           BOOLEAN     NOT NULL DEFAULT FALSE,
  auto_persist_candidate BOOLEAN     NOT NULL DEFAULT FALSE,
  ratified_by            TEXT,
  ratified_at            TIMESTAMPTZ,
  auto_persisted         BOOLEAN     NOT NULL DEFAULT FALSE,
  counter_thought        JSONB,
  embedding              vector(768),
  metadata               JSONB       NOT NULL DEFAULT '{}',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_thought_type CHECK (
    thought_type IN ('analysis', 'concern', 'decision', 'hypothesis', 'realization', 'pushback')
  )
);

-- Required HNSW — partial because embedding is written async post-ratification
CREATE INDEX idx_thoughts_embedding ON thoughts
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 128)
  WHERE embedding IS NOT NULL;

-- Primary query pattern: per-agent session replay
CREATE INDEX idx_thoughts_agent_session ON thoughts(agent_slug, session_id);

-- Filter by type within agent scope
CREATE INDEX idx_thoughts_agent_type ON thoughts(agent_slug, thought_type);

-- The Zero surfacing queue — partial, small working set
CREATE INDEX idx_thoughts_must_surface ON thoughts(must_surface)
  WHERE must_surface = TRUE;

-- Ratification queue: auto-persist candidates awaiting sign-off
CREATE INDEX idx_thoughts_ratification_queue ON thoughts(auto_persist_candidate, ratified_at)
  WHERE auto_persist_candidate = TRUE AND ratified_at IS NULL;

-- Time-ordered listing
CREATE INDEX idx_thoughts_created_at ON thoughts(created_at DESC);

-- ---------------------------------------------------------------------------
-- dispositions
--
-- Per-agent disposition profiles. Renamed from agent_disposition_profiles —
-- the prefix and _profiles suffix were verbose noise.
--
-- Key changes from source:
--   - agent_slug TEXT PRIMARY KEY REFERENCES agents(slug). Natural PK for a
--     one-row-per-agent table — no surrogate id needed.
--   - agent_name dropped (same FK-first identity reasoning as thoughts).
--   - Hardcoded CHECK constraint on agent names replaced by FK enforcement.
--   - All disposition scores: FLOAT with CHECK bounds (same as source).
--
-- No non-PK indexes: maximum ~10 rows (one per registered agent). The planner
-- will use the PK for every lookup; no additional indexes add value.
-- ---------------------------------------------------------------------------

CREATE TABLE dispositions (
  agent_slug    TEXT  PRIMARY KEY REFERENCES agents(slug),
  assertiveness FLOAT NOT NULL DEFAULT 0.0,
  energy        FLOAT NOT NULL DEFAULT 0.0,
  patience      FLOAT NOT NULL DEFAULT 0.0,
  formality     FLOAT NOT NULL DEFAULT 0.0,
  candor_floor  FLOAT NOT NULL DEFAULT 0.3,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    TEXT,

  CONSTRAINT chk_assertiveness CHECK (assertiveness BETWEEN -1.0 AND 1.0),
  CONSTRAINT chk_energy        CHECK (energy        BETWEEN -1.0 AND 1.0),
  CONSTRAINT chk_patience      CHECK (patience      BETWEEN -1.0 AND 1.0),
  CONSTRAINT chk_formality     CHECK (formality     BETWEEN -1.0 AND 1.0),
  CONSTRAINT chk_candor_floor  CHECK (candor_floor  BETWEEN  0.2 AND 1.0)
);

CREATE TRIGGER dispositions_set_updated_at
  BEFORE UPDATE ON dispositions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
