-- migrations/009_opensquad_cutover.sql
-- OpenSquad -> OpenHiveOS Cutover Migration
--
-- Run via: ./scripts/run_cutover.sh
-- Requires psql var: source_db_url
--
-- Security invariant:
--   - Do NOT migrate agent token material (token_hash, token_salt, previous_*).
--   - Re-provision tokens in OpenHiveOS after import.

\if :{?source_db_url}
\else
\echo 'FATAL: source_db_url is required. Run via ./scripts/run_cutover.sh'
\quit 1
\endif

BEGIN;

-- Keep a stable named connection for all source reads.
SELECT dblink_connect('opensquad_src', :'source_db_url');

-- ---------------------------------------------------------------------------
-- Agents (identity only; token fields intentionally excluded)
-- ---------------------------------------------------------------------------
INSERT INTO agents (
  id,
  slug,
  display_name,
  token_hash,
  token_salt,
  previous_token_hash,
  previous_token_salt,
  previous_token_expires_at,
  active,
  created_at,
  updated_at
)
SELECT
  s.id,
  s.slug,
  s.display_name,
  md5('openhiveos:migrated:token-hash:' || s.slug) || md5('openhiveos:migrated:token-hash:2:' || s.slug) AS token_hash,
  md5('openhiveos:migrated:token-salt:' || s.slug) AS token_salt,
  NULL::TEXT AS previous_token_hash,
  NULL::TEXT AS previous_token_salt,
  NULL::TIMESTAMPTZ AS previous_token_expires_at,
  s.active,
  s.created_at,
  s.updated_at
FROM dblink(
  'opensquad_src',
  'SELECT id, slug, display_name, active, created_at, updated_at FROM agents'
) AS s(
  id INTEGER,
  slug TEXT,
  display_name TEXT,
  active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  display_name = EXCLUDED.display_name,
  token_hash = EXCLUDED.token_hash,
  token_salt = EXCLUDED.token_salt,
  previous_token_hash = EXCLUDED.previous_token_hash,
  previous_token_salt = EXCLUDED.previous_token_salt,
  previous_token_expires_at = EXCLUDED.previous_token_expires_at,
  active = EXCLUDED.active,
  updated_at = EXCLUDED.updated_at;

-- ---------------------------------------------------------------------------
-- Projects (factory_projects -> projects)
-- ---------------------------------------------------------------------------
INSERT INTO projects (id, slug, name, description, status, owner_agent_slug, created_at, updated_at)
SELECT
  p.id,
  'project-' || p.id::TEXT AS slug,
  p.name,
  p.description,
  CASE
    WHEN lower(p.status) IN ('active', 'archived') THEN lower(p.status)
    ELSE 'active'
  END AS status,
  COALESCE(a.slug, 'elizabeth') AS owner_agent_slug,
  p.created_at,
  p.updated_at
FROM dblink(
  'opensquad_src',
  'SELECT id, slug, name, description, status, lead_agent, created_at, updated_at FROM factory_projects'
) AS p(
  id INTEGER,
  slug TEXT,
  name TEXT,
  description TEXT,
  status TEXT,
  lead_agent TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LEFT JOIN agents a ON a.slug = p.lead_agent
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  owner_agent_slug = EXCLUDED.owner_agent_slug,
  updated_at = EXCLUDED.updated_at;

-- ---------------------------------------------------------------------------
-- Tasks (factory_tasks -> tasks)
-- ---------------------------------------------------------------------------
INSERT INTO tasks (
  id,
  project_id,
  title,
  description,
  status,
  assignee_agent_slug,
  github_pr_url,
  notes,
  created_at,
  updated_at
)
SELECT
  t.id,
  t.project_fk,
  t.title,
  t.validation_criteria,
  CASE
    WHEN lower(t.status) IN ('todo', 'wip', 'review', 'done', 'rework') THEN lower(t.status)
    ELSE 'todo'
  END AS status,
  CASE WHEN a.slug IS NOT NULL THEN t.assigned_agent ELSE NULL END AS assignee_agent_slug,
  t.github_pr_url,
  NULL::TEXT AS notes,
  t.created_at,
  t.updated_at
FROM dblink(
  'opensquad_src',
  'SELECT id, project_fk, title, assigned_agent, status, validation_criteria, github_pr_url, created_at, updated_at FROM factory_tasks'
) AS t(
  id INTEGER,
  project_fk INTEGER,
  title TEXT,
  assigned_agent TEXT,
  status TEXT,
  validation_criteria TEXT,
  github_pr_url TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
JOIN projects p ON p.id = t.project_fk
LEFT JOIN agents a ON a.slug = t.assigned_agent
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  assignee_agent_slug = EXCLUDED.assignee_agent_slug,
  github_pr_url = EXCLUDED.github_pr_url,
  updated_at = EXCLUDED.updated_at;

-- ---------------------------------------------------------------------------
-- Crons (factory_crons -> crons)
-- ---------------------------------------------------------------------------
INSERT INTO crons (
  id,
  project_id,
  owner_agent_slug,
  name,
  description,
  schedule,
  tool_name,
  payload,
  status,
  last_run_at,
  created_at,
  updated_at
)
SELECT
  c.id,
  c.project_fk,
  owner.slug,
  c.title,
  c.validation_criteria,
  COALESCE(
    NULLIF(trim(c.cron_expression), ''),
    to_char(c.scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ) AS schedule,
  'create_task'::TEXT AS tool_name,
  jsonb_build_object(
    'legacy_assigned_agent', c.assigned_agent,
    'legacy_timezone', c.timezone,
    'legacy_enabled', c.enabled,
    'legacy_last_fired_at', c.last_fired_at,
    'legacy_next_fire_at', c.next_fire_at,
    'legacy_last_task_id', c.last_task_id
  ) AS payload,
  CASE
    WHEN c.enabled = TRUE THEN 'active'
    ELSE 'paused'
  END AS status,
  c.last_fired_at,
  c.created_at,
  c.updated_at
FROM dblink(
  'opensquad_src',
  'SELECT id, project_fk, title, assigned_agent, validation_criteria, cron_expression, scheduled_at, timezone, enabled, last_fired_at, next_fire_at, last_task_id, created_by, created_at, updated_at FROM factory_crons'
) AS c(
  id INTEGER,
  project_fk INTEGER,
  title TEXT,
  assigned_agent TEXT,
  validation_criteria TEXT,
  cron_expression TEXT,
  scheduled_at TIMESTAMPTZ,
  timezone TEXT,
  enabled BOOLEAN,
  last_fired_at TIMESTAMPTZ,
  next_fire_at TIMESTAMPTZ,
  last_task_id INTEGER,
  created_by TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
JOIN projects p ON p.id = c.project_fk
JOIN LATERAL (
  SELECT a.slug
  FROM agents a
  WHERE a.slug = COALESCE(NULLIF(c.created_by, ''), NULLIF(c.assigned_agent, ''), 'cooper')
  LIMIT 1
) AS owner ON TRUE
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  owner_agent_slug = EXCLUDED.owner_agent_slug,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  schedule = EXCLUDED.schedule,
  tool_name = EXCLUDED.tool_name,
  payload = EXCLUDED.payload,
  status = EXCLUDED.status,
  last_run_at = EXCLUDED.last_run_at,
  updated_at = EXCLUDED.updated_at;

-- ---------------------------------------------------------------------------
-- Memories (factory_memory -> memories)
-- Notes:
--   - OpenHiveOS requires agent_slug + embedding NOT NULL.
--   - Agent attribution is resolved via metadata, then task assignee, then fallback.
-- ---------------------------------------------------------------------------
WITH src_memory AS (
  SELECT *
  FROM dblink(
    'opensquad_src',
    'SELECT id, task_id, content, embedding, metadata, created_at FROM factory_memory'
  ) AS m(
    id INTEGER,
    task_id INTEGER,
    content TEXT,
    embedding vector(768),
    metadata JSONB,
    created_at TIMESTAMPTZ
  )
), resolved_memory AS (
  SELECT
    m.id,
    m.task_id,
    m.content,
    m.embedding,
    m.metadata,
    m.created_at,
    COALESCE(
      NULLIF(m.metadata->>'agent_slug', ''),
      NULLIF(m.metadata->>'agent', ''),
      t.assignee_agent_slug,
      'murphy'
    ) AS resolved_agent_slug
  FROM src_memory m
  LEFT JOIN tasks t ON t.id = m.task_id
)
INSERT INTO memories (id, agent_slug, content, embedding, task_id, metadata, created_at)
SELECT
  rm.id,
  a.slug,
  rm.content,
  rm.embedding,
  CASE WHEN t.id IS NOT NULL THEN rm.task_id::BIGINT ELSE NULL END,
  COALESCE(rm.metadata, '{}'::JSONB),
  rm.created_at
FROM resolved_memory rm
JOIN agents a ON a.slug = rm.resolved_agent_slug
LEFT JOIN tasks t ON t.id = rm.task_id
WHERE rm.embedding IS NOT NULL
ON CONFLICT (id) DO UPDATE SET
  agent_slug = EXCLUDED.agent_slug,
  content = EXCLUDED.content,
  embedding = EXCLUDED.embedding,
  task_id = EXCLUDED.task_id,
  metadata = EXCLUDED.metadata,
  created_at = EXCLUDED.created_at;

-- ---------------------------------------------------------------------------
-- Thoughts (agent_thoughts -> thoughts)
-- ---------------------------------------------------------------------------
WITH src_thoughts AS (
  SELECT *
  FROM dblink(
    'opensquad_src',
    'SELECT id, agent_slug, agent_name, session_id, task_id, thought, thought_type, confidence, raw_behavior, expressed_behavior, disposition_snapshot, must_surface, auto_persist_candidate, ratified_by, ratified_at, auto_persisted, counter_thought, embedding, metadata, created_at FROM agent_thoughts'
  ) AS th(
    id INTEGER,
    agent_slug TEXT,
    agent_name TEXT,
    session_id TEXT,
    task_id INTEGER,
    thought TEXT,
    thought_type TEXT,
    confidence DOUBLE PRECISION,
    raw_behavior TEXT,
    expressed_behavior TEXT,
    disposition_snapshot JSONB,
    must_surface BOOLEAN,
    auto_persist_candidate BOOLEAN,
    ratified_by TEXT,
    ratified_at TIMESTAMPTZ,
    auto_persisted BOOLEAN,
    counter_thought JSONB,
    embedding vector(768),
    metadata JSONB,
    created_at TIMESTAMPTZ
  )
)
INSERT INTO thoughts (
  id,
  agent_slug,
  session_id,
  task_id,
  thought,
  thought_type,
  confidence,
  raw_behavior,
  expressed_behavior,
  disposition_snapshot,
  must_surface,
  auto_persist_candidate,
  ratified_by,
  ratified_at,
  auto_persisted,
  counter_thought,
  embedding,
  metadata,
  created_at
)
SELECT
  th.id,
  a.slug,
  th.session_id,
  CASE WHEN t.id IS NOT NULL THEN th.task_id::BIGINT ELSE NULL END,
  th.thought,
  CASE
    WHEN th.thought_type IN ('analysis', 'concern', 'decision', 'hypothesis', 'realization', 'pushback')
      THEN th.thought_type
    ELSE 'analysis'
  END,
  th.confidence,
  th.raw_behavior,
  th.expressed_behavior,
  th.disposition_snapshot,
  COALESCE(th.must_surface, FALSE),
  COALESCE(th.auto_persist_candidate, FALSE),
  th.ratified_by,
  th.ratified_at,
  COALESCE(th.auto_persisted, FALSE),
  th.counter_thought,
  th.embedding,
  COALESCE(th.metadata, '{}'::JSONB),
  th.created_at
FROM src_thoughts th
JOIN agents a ON a.slug = COALESCE(NULLIF(th.agent_slug, ''), NULLIF(th.agent_name, ''))
LEFT JOIN tasks t ON t.id = th.task_id
ON CONFLICT (id) DO UPDATE SET
  agent_slug = EXCLUDED.agent_slug,
  session_id = EXCLUDED.session_id,
  task_id = EXCLUDED.task_id,
  thought = EXCLUDED.thought,
  thought_type = EXCLUDED.thought_type,
  confidence = EXCLUDED.confidence,
  raw_behavior = EXCLUDED.raw_behavior,
  expressed_behavior = EXCLUDED.expressed_behavior,
  disposition_snapshot = EXCLUDED.disposition_snapshot,
  must_surface = EXCLUDED.must_surface,
  auto_persist_candidate = EXCLUDED.auto_persist_candidate,
  ratified_by = EXCLUDED.ratified_by,
  ratified_at = EXCLUDED.ratified_at,
  auto_persisted = EXCLUDED.auto_persisted,
  counter_thought = EXCLUDED.counter_thought,
  embedding = EXCLUDED.embedding,
  metadata = EXCLUDED.metadata,
  created_at = EXCLUDED.created_at;

-- ---------------------------------------------------------------------------
-- Dispositions (agent_disposition_profiles -> dispositions)
-- ---------------------------------------------------------------------------
INSERT INTO dispositions (
  agent_slug,
  assertiveness,
  energy,
  patience,
  formality,
  candor_floor,
  updated_at,
  updated_by
)
SELECT
  a.slug,
  d.assertiveness,
  d.energy,
  d.patience,
  d.formality,
  d.candor_floor,
  d.updated_at,
  d.updated_by
FROM dblink(
  'opensquad_src',
  'SELECT agent_slug, agent_name, assertiveness, energy, patience, formality, candor_floor, updated_at, updated_by FROM agent_disposition_profiles'
) AS d(
  agent_slug TEXT,
  agent_name TEXT,
  assertiveness DOUBLE PRECISION,
  energy DOUBLE PRECISION,
  patience DOUBLE PRECISION,
  formality DOUBLE PRECISION,
  candor_floor DOUBLE PRECISION,
  updated_at TIMESTAMPTZ,
  updated_by TEXT
)
JOIN agents a ON a.slug = COALESCE(NULLIF(d.agent_slug, ''), NULLIF(d.agent_name, ''))
ON CONFLICT (agent_slug) DO UPDATE SET
  assertiveness = EXCLUDED.assertiveness,
  energy = EXCLUDED.energy,
  patience = EXCLUDED.patience,
  formality = EXCLUDED.formality,
  candor_floor = EXCLUDED.candor_floor,
  updated_at = EXCLUDED.updated_at,
  updated_by = EXCLUDED.updated_by;

-- ---------------------------------------------------------------------------
-- SOPs
-- ---------------------------------------------------------------------------
INSERT INTO sops (id, category, agent, instruction, embedding, source_path, created_at, updated_at)
SELECT
  s.id,
  s.category,
  s.agent,
  s.instruction,
  s.embedding,
  s.source_path,
  s.created_at,
  s.updated_at
FROM dblink(
  'opensquad_src',
  'SELECT id, category, agent, instruction, embedding, source_path, created_at, updated_at FROM sops'
) AS s(
  id INTEGER,
  category TEXT,
  agent TEXT,
  instruction TEXT,
  embedding vector(768),
  source_path TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  agent = EXCLUDED.agent,
  instruction = EXCLUDED.instruction,
  embedding = EXCLUDED.embedding,
  source_path = EXCLUDED.source_path,
  updated_at = EXCLUDED.updated_at;

-- ---------------------------------------------------------------------------
-- LLM usage (optional: only if target table exists)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.llm_usage') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO llm_usage (
        id,
        session_id,
        loop_index,
        agent_slug,
        model,
        provider,
        prompt_tokens,
        completion_tokens,
        cost_usd,
        cache_read_tokens,
        cache_creation_tokens,
        task_id,
        recorded_at
      )
      SELECT
        u.id,
        u.session_id,
        u.loop_index,
        u.agent_slug,
        u.model,
        u.provider,
        u.prompt_tokens,
        u.completion_tokens,
        u.cost_usd,
        u.cache_read_tokens,
        u.cache_creation_tokens,
        u.task_fk::BIGINT,
        COALESCE(u.reported_at, NOW())
      FROM dblink(
        'opensquad_src',
        'SELECT id, session_id, loop_index, agent_slug, model, provider, prompt_tokens, completion_tokens, cost_usd, cache_read_tokens, cache_creation_tokens, task_fk, reported_at FROM llm_usage'
      ) AS u(
        id INTEGER,
        session_id TEXT,
        loop_index INTEGER,
        agent_slug TEXT,
        model TEXT,
        provider TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        cost_usd NUMERIC,
        cache_read_tokens INTEGER,
        cache_creation_tokens INTEGER,
        task_fk INTEGER,
        reported_at TIMESTAMPTZ
      )
      ON CONFLICT (id) DO UPDATE SET
        session_id = EXCLUDED.session_id,
        loop_index = EXCLUDED.loop_index,
        agent_slug = EXCLUDED.agent_slug,
        model = EXCLUDED.model,
        provider = EXCLUDED.provider,
        prompt_tokens = EXCLUDED.prompt_tokens,
        completion_tokens = EXCLUDED.completion_tokens,
        cost_usd = EXCLUDED.cost_usd,
        cache_read_tokens = EXCLUDED.cache_read_tokens,
        cache_creation_tokens = EXCLUDED.cache_creation_tokens,
        task_id = EXCLUDED.task_id,
        recorded_at = EXCLUDED.recorded_at;
    $sql$;
  END IF;
END $$;

-- Keep sequences aligned after explicit id inserts.
SELECT setval('agents_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM agents), 1), 1));
SELECT setval('projects_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM projects), 1), 1));
SELECT setval('tasks_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM tasks), 1), 1));
SELECT setval('crons_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM crons), 1), 1));
SELECT setval('memories_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM memories), 1), 1));
SELECT setval('thoughts_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM thoughts), 1), 1));
SELECT setval('sops_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM sops), 1), 1));

DO $$
BEGIN
  IF to_regclass('public.llm_usage') IS NOT NULL THEN
    PERFORM setval('llm_usage_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM llm_usage), 1), 1));
  END IF;
END $$;

SELECT dblink_disconnect('opensquad_src');

COMMIT;
