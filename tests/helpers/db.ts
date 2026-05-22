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
