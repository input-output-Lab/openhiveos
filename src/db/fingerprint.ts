import { pool } from './client.js'

// ---------------------------------------------------------------------------
// Boot fingerprint guard
//
// Runs once at startup. Checks that the Postgres instance has:
//   1. The pgvector extension installed
//   2. All five OS-Primitive tables present
//
// A mismatch means migrations have not been applied and the server must not
// start — failing loudly here is safer than surfacing cryptic runtime errors.
// ---------------------------------------------------------------------------

const REQUIRED_TABLES = ['agents', 'sops', 'memories', 'thoughts', 'dispositions'] as const

// Coordination Utility tables — added by migration 002_coordination_utilities.sql
// 'crons' added in migration 003_crons.sql (ARCH-011, Sprint 4)
const COORDINATION_TABLES = ['projects', 'tasks', 'sprints', 'crons'] as const

const ALL_REQUIRED_TABLES = [...REQUIRED_TABLES, ...COORDINATION_TABLES]

export async function checkFingerprint(): Promise<void> {
  // 1. pgvector
  const extResult = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_extension WHERE extname = 'vector'
     ) AS exists`,
  )
  const row = extResult.rows[0]
  if (!row?.exists) {
    throw new Error(
      '[fingerprint] pgvector extension is not installed. Run: CREATE EXTENSION vector;',
    )
  }

  // 2. Required tables
  const tableResult = await pool.query<{ tablename: string }>(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename = ANY($1::text[])`,
    [ALL_REQUIRED_TABLES],
  )

  const found = new Set(tableResult.rows.map((r) => r.tablename))

  // Check OS Primitive tables (migration 001)
  const missingPrimitives = REQUIRED_TABLES.filter((t) => !found.has(t))
  if (missingPrimitives.length > 0) {
    throw new Error(
      `[fingerprint] Missing OS Primitive tables: ${missingPrimitives.join(', ')}. Run migrations/001_init.sql first.`,
    )
  }

  // Check Coordination Utility tables (migration 002)
  const missingCoordination = COORDINATION_TABLES.filter((t) => !found.has(t))
  if (missingCoordination.length > 0) {
    const migrationHint =
      missingCoordination.includes('crons')
        ? 'Run migrations/003_crons.sql (and 002_coordination_utilities.sql if also missing projects/tasks/sprints).'
        : 'Run migrations/002_coordination_utilities.sql.'
    throw new Error(
      `[fingerprint] Missing Coordination Utility tables: ${missingCoordination.join(', ')}. ${migrationHint}`,
    )
  }

  console.error('[fingerprint] Schema OK — all required tables and extensions present')
}
