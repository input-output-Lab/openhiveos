import { Pool } from 'pg'
import { squadApiConfig } from './config.js'

// ---------------------------------------------------------------------------
// Squad API database pool — separate from the MCP server pool.
//
// Pool ceiling: MCP server max:10 + squad-api max:5 = 15 total connections
// (documented per ARCH-012 connection pool ceiling note).
//
// All queries from this pool run under openhiveos_reader (SEC-A5):
//   - Use withReaderRole() for any query that should be enforced SELECT-only.
//   - Never use this pool directly for write operations.
// ---------------------------------------------------------------------------

export const squadApiPool = new Pool({
  connectionString: squadApiConfig.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

squadApiPool.on('error', (err) => {
  const message = err instanceof Error ? err.message : 'unknown pool error'
  console.error('[squad-api/db] Unexpected pool error:', message)
})

/**
 * Executes a callback with a client that has been switched to the
 * openhiveos_reader role for the duration of the transaction (SEC-A5).
 *
 * Uses SET LOCAL ROLE — the role reverts automatically on COMMIT/ROLLBACK,
 * and when the connection is returned to the pool it re-authenticates as
 * the original openhiveos user.
 *
 * openhiveos_reader is granted SELECT on all current and future tables via
 * ALTER DEFAULT PRIVILEGES in 003_squad_api_role.sql.
 */
export async function withReaderRole<T>(
  fn: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const client = await squadApiPool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE openhiveos_reader')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
