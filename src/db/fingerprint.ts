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
    [REQUIRED_TABLES],
  )

  const found = new Set(tableResult.rows.map((r) => r.tablename))
  const missing = REQUIRED_TABLES.filter((t) => !found.has(t))

  if (missing.length > 0) {
    throw new Error(
      `[fingerprint] Missing tables: ${missing.join(', ')}. Run migrations/001_init.sql first.`,
    )
  }

  console.log('[fingerprint] Schema OK — all required tables and extensions present')
}
