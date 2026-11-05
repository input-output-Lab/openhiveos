/**
 * tests/helpers/db.ts
 *
 * Shared testcontainers setup for integration tests that need a real
 * PostgreSQL instance with the full OpenHiveOS migration chain applied.
 *
 * Usage (in a test file):
 *
 *   import { createTestDb, type TestDb } from '../helpers/db.js'
 *
 *   let db: TestDb
 *   beforeAll(async () => { db = await createTestDb() }, 60_000)
 *   afterAll(async () => { await db.teardown() })
 *   beforeEach(async () => { await db.cleanCrons() })
 *
 * Image: pgvector/pgvector:pg17 — required for the vector extension used in
 * migration 001_init.sql. The standard postgres image does not include it.
 */

import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { Pool } from 'pg'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations')

// Migration files in application order. 003_dashboard_agent and
// 003_squad_api_role create DB roles that require superuser. In the
// testcontainer (which runs as superuser) they work, but they are
// not required for the cron worker tests — skip them.
// 005_llm_usage.sql contains GRANT statements that reference the
// openhiveos_reader role (created by 003_squad_api_role). We apply 005 but
// strip those GRANT lines so the migration doesn't fail in isolation.
const MIGRATIONS = [
  '001_init.sql',
  '002_coordination_utilities.sql',
  '003_crons.sql',
  '004_ethos_seal.sql',
  '005_llm_usage.sql',
  '006_cron_next_fire_at.sql',
  // 007_db_roles_sec7.sql creates opensquad_app / opensquad_migrate roles with
  // CREATE ROLE IF NOT EXISTS (PG16+ syntax). We connect as superuser in the
  // testcontainer anyway, so role isolation is not required for tests.
  '008_sops_ingest_columns.sql',
  // S16/S17 lifecycle chain: task-aging tests need 024's lifecycle columns,
  // history + audit triggers, and 025's estimate columns.
  '014_pending_close_status.sql',
  '015_external_task_links.sql',
  '019_triage_status.sql',
  '020_task_metadata.sql',
  '024_task_lifecycle.sql',
  '025_task_estimates.sql',
  // S16-DB-03 enrichment (session_id/task_id/actor_type on tool_invocations)
  // + S17-BE-04 worklogs (task_worklogs, session-called index, derivation view)
  // 017 creates tool_invocations itself (its reader GRANT is stripped above).
  '017_tool_invocations.sql',
  '026_tool_invocations_enrichment.sql',
  '027_task_worklogs.sql',
  '028_task_worklogs_human.sql',
  // S18-SEC-03 (#2642): dashboard human login sessions.
  '029_dashboard_sessions.sql',
]

/**
 * Pre-process a migration SQL string to remove statements that reference
 * roles not created in the test environment (openhiveos_reader).
 */
function stripRoleGrants(sql: string): string {
  // Remove GRANT … TO openhiveos_reader lines (single-statement form).
  return sql
    .split('\n')
    .filter(line => !/GRANT\s+.+\s+TO\s+openhiveos_reader\s*;?/i.test(line))
    .join('\n')
}

export interface TestDb {
  pool: Pool
  container: StartedPostgreSqlContainer
  /** Remove all cron rows. Leaves agents and projects intact. */
  cleanCrons: () => Promise<void>
  /** Remove all tasks (status history + audit rows cascade). */
  cleanTasks: () => Promise<void>
  teardown: () => Promise<void>
}

export async function createTestDb(): Promise<TestDb> {
  // pgvector/pgvector:pg17 includes the vector extension required by 001_init.sql.
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg17').start()

  const pool = new Pool({ connectionString: container.getConnectionUri() })

  // Apply migrations in order
  for (const file of MIGRATIONS) {
    let sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
    sql = stripRoleGrants(sql)
    await pool.query(sql)
  }

  // Seed: one test agent + one test project required by crons FK constraints.
  // token_hash/token_salt are synthetic — auth is not under test here.
  await pool.query(`
    INSERT INTO agents (slug, display_name, token_hash, token_salt)
    VALUES ('test-agent', 'Test Agent', 'test-hash-unique-abc123', 'test-salt')
    ON CONFLICT (slug) DO NOTHING
  `)

  await pool.query(`
    INSERT INTO projects (slug, name, owner_agent_slug)
    VALUES ('test-project', 'Test Project', 'test-agent')
    ON CONFLICT (slug) DO NOTHING
  `)

  return {
    pool,
    container,

    cleanCrons: async () => {
      // Hard delete all cron rows between tests (truncate respects FK cascade).
      // The agents + projects seed rows are preserved.
      await pool.query(`DELETE FROM crons`)
    },

    cleanTasks: async () => {
      // tasks cascade to task_status_history / audit_log / external_task_links.
      await pool.query(`DELETE FROM tasks`)
    },

    teardown: async () => {
      await pool.end()
      await container.stop()
    },
  }
}

/** Insert a cron row for tests. Returns the inserted row's id. */
export async function insertCron(
  pool: Pool,
  overrides: {
    schedule?: string
    tool_name?: string
    payload?: Record<string, unknown> | null
    status?: 'active' | 'paused' | 'deleted'
    next_fire_at?: string // SQL expression, e.g. 'NOW() - interval \'1 minute\''
  } = {},
): Promise<number> {
  const {
    schedule = '*/5 * * * *',
    tool_name = 'store_memory',
    payload = null,
    status = 'active',
    next_fire_at = "NOW() - interval '1 minute'", // due by default
  } = overrides

  // Retrieve project_id from the seeded project
  const proj = await pool.query<{ id: number }>(`SELECT id FROM projects WHERE slug = 'test-project'`)
  const projectId = proj.rows[0]!.id

  const result = await pool.query<{ id: number }>(
    `INSERT INTO crons (project_id, owner_agent_slug, name, schedule, tool_name, payload, status, next_fire_at)
     VALUES ($1, 'test-agent', 'Test Cron', $2, $3, $4, $5, ${next_fire_at})
     RETURNING id`,
    [projectId, schedule, tool_name, payload ? JSON.stringify(payload) : null, status],
  )
  return result.rows[0]!.id
}

/**
 * Seed an additional agent (slug + display name). Synthetic token material —
 * auth is not under test here. Idempotent.
 */
export async function insertAgent(pool: Pool, slug: string, displayName: string): Promise<void> {
  await pool.query(
    `INSERT INTO agents (slug, display_name, token_hash, token_salt)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) DO NOTHING`,
    [slug, displayName, `hash-${slug}-test`, `salt-${slug}-test`],
  )
}

/**
 * Seed a task with full lifecycle control for aging tests.
 *
 * `statusSince` backdates updated_at AND the task_status_history row so the
 * days-in-status clock is deterministic without fake timers (the fixture
 * writes history directly at the backdated time instead of relying on the
 * NOW()-based trigger).
 */
export async function insertTask(
  pool: Pool,
  overrides: {
    project_id?: number
    title?: string
    status?: 'todo' | 'wip' | 'review' | 'pending-close' | 'rework' | 'done'
    assignee_agent_slug?: string | null
    reviewer_agent_slug?: string | null
    metadata?: Record<string, unknown>
    /** SQL interval expression backdating updated_at + history, e.g. "NOW() - interval '20 days'". */
    statusSince?: string
  } = {},
): Promise<number> {
  const {
    project_id,
    title = 'Test Task',
    status = 'review',
    assignee_agent_slug = null,
    reviewer_agent_slug = null,
    metadata = {},
    statusSince = 'NOW()',
  } = overrides

  let projectId = project_id
  if (projectId === undefined) {
    const proj = await pool.query<{ id: number }>(`SELECT id FROM projects WHERE slug = 'test-project'`)
    projectId = proj.rows[0]!.id
  }

  const result = await pool.query<{ id: number }>(
    `INSERT INTO tasks (project_id, title, status, assignee_agent_slug, reviewer_agent_slug, metadata,
                        estimated_hours, billing_low, billing_high, estimate_confidence)
     VALUES ($1, $2, $3, $4, $5, $6, 1.0, 1.0, 2.0, 'low')
     RETURNING id`,
    [projectId, title, status, assignee_agent_slug, reviewer_agent_slug, JSON.stringify(metadata)],
  )
  const taskId = result.rows[0]!.id

  // Creation history entry at the backdated time (the INSERT itself is not
  // trigger-tracked; this mirrors the API path's history semantics).
  // NOTE: the tasks_set_updated_at trigger (migration 002) force-bumps
  // updated_at on every UPDATE, so the age clock the scan actually reads is
  // task_status_history — backdating history is what matters; we also set
  // updated_at for row-level realism (it will read back as the UPDATE time).
  await pool.query(
    `INSERT INTO task_status_history (task_id, from_status, to_status, changed_by, changed_at)
     VALUES ($1, NULL, $2, 'test-fixture', ${statusSince})`,
    [taskId, status],
  )

  return taskId
}

/**
 * Insert a tool_invocations row (the derivation source). Timestamps are
 * passed as ISO strings so fixtures control the session clock exactly.
 */
export async function insertInvocation(
  pool: Pool,
  overrides: {
    agent_slug?: string
    tool_name?: string
    called_at?: string // ISO timestamp
    duration_ms?: number | null
    success?: boolean
    session_id?: string | null
    task_id?: number | null
    project_id?: number | null
    client_surface?: string | null
    actor_type?: string | null
  } = {},
): Promise<number> {
  const {
    agent_slug = 'test-agent',
    tool_name = 'query_tasks',
    called_at = new Date().toISOString(),
    duration_ms = 1_000,
    success = true,
    session_id = null,
    task_id = null,
    project_id = null,
    client_surface = 'vscode-copilot',
    actor_type = 'agent',
  } = overrides

  const result = await pool.query<{ id: number }>(
    `INSERT INTO tool_invocations
       (agent_slug, tool_name, transport, source, called_at, duration_ms, success,
        session_id, task_id, project_id, client_surface, actor_type)
     VALUES ($1, $2, 'stdio', 'gateway', $3::timestamptz, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [agent_slug, tool_name, called_at, duration_ms, success, session_id, task_id, project_id, client_surface, actor_type],
  )
  return result.rows[0]!.id
}

/** Delete all tool invocations + worklogs between tests. */
export async function cleanInvocations(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM task_worklogs`)
  await pool.query(`DELETE FROM tool_invocations`)
}
