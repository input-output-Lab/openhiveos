import { Pool, type PoolClient } from 'pg'

const DATABASE_URL = process.env['DATABASE_URL']

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required')
}

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

export async function connectDb(): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('SELECT 1')
    console.error('[db] Connected to Postgres')
  } finally {
    client.release()
  }
}

pool.on('error', (err) => {
  // Log message only — never the full error object. pg PoolClient error events
  // can include connection string details in some error paths (M-001, S2-03 STRIDE).
  const message = err instanceof Error ? err.message : 'unknown pool error'
  console.error('[db] Unexpected pool error:', message)
})

// ---------------------------------------------------------------------------
// withActor — S17-BE-01 (#2555): session-variable actor attribution.
//
// migration 024's audit triggers read `hive.actor` (via hive_current_actor())
// to attribute task_status_history + audit_log rows. Before this helper,
// NOTHING in src/ set the variable — every history row logged 'system:sql',
// making P5 (transition audit) worthless. Locksmith ruling: every transition
// must name its actor.
//
// Usage: wrap the write — withActor('murphy', () => updateTask(...)).
// Implementation: dedicated pooled client, BEGIN, SET LOCAL (transaction-
// scoped — the variable CANNOT leak to other pooled connections), commit.
// SET LOCAL only applies inside a transaction; without BEGIN it silently
// does nothing, which is why the naive `pool.query('SET LOCAL ...')` never
// worked. Failures roll back and rethrow — a transition is never recorded
// with a wrong-or-missing actor.
// ---------------------------------------------------------------------------

export async function withActor<T>(actorSlug: string, fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  // Defense-in-depth: parameterised SET LOCAL is not supported by Postgres for
  // config names, so the slug is interpolated. Assert the format HERE — never
  // trust upstream alone. Agent slugs are [a-z][a-z0-9_-]*; system actors are
  // 'system:<name>' which also satisfies the pattern. Anything else throws
  // before touching SQL (injection-proof standalone, not by call-site discipline).
  if (!/^(system:[a-z0-9_-]+|[a-z][a-z0-9_-]*)$/.test(actorSlug)) {
    throw new Error(`[db] withActor: invalid actor slug format`)
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL hive.actor = '${actorSlug}'`)
    // CRITICAL: fn receives THIS client and must execute its queries on it.
    // SET LOCAL is connection-scoped — running fn's queries via pool.query()
    // would take a different pooled connection where hive.actor is unset
    // (E2E-caused bug: history rows logged 'system:sql' despite the wrapper).
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
