import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { config } from './config.js'
import { pool } from './db/client.js'
import { manifest } from './squad/manifest.js'

// Release version — read from package.json so /health always matches the
// deployed release (v0.2.0 drift proved a hardcoded literal rots).
const VERSION: string =
  (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string })
    .version ?? 'unknown'

// ---------------------------------------------------------------------------
// Health server
//
// A minimal HTTP server that runs alongside the MCP stdio transport.
// Exposes GET /health for Docker health checks and external monitoring.
//
// Port: HEALTH_PORT env var (default 3000)
//
// Version is read from package.json at build time — keep in sync with the
// root release version (do NOT hardcode; it drifted at v0.2.0 otherwise).
//
// S2-08 (ARCH-008 addendum): the {agents} field was stripped from this
// response. Squad composition is internal information -- exposing agent slugs
// on an unauthenticated endpoint is a reconnaissance vector if HEALTH_PORT
// is ever published externally. The health probe needs {status} and {db}
// only. Locksmith reviewed and accepted this resolution (S2-02).
//
// S4-04 (ARCH-011): health check extended to verify schema integrity beyond
// DB connectivity. A live DB with a missing crons table indicates migration
// 003 has not been applied -- the server will start (fingerprint guards boot)
// but the health endpoint reports 'degraded' to surface this to operators.
// ---------------------------------------------------------------------------

// All tables required for the crons registration layer (migration 003).
// If any of these are absent the response status degrades to 'degraded'.
const CRON_TIER_TABLES = ['crons'] as const

interface HealthPayload {
  status: 'ok' | 'degraded'
  version: string
  squad: string
  db: 'connected' | 'error'
  schema?: 'ok' | 'degraded'
  missing_tables?: string[]
  error?: string
}

async function checkSchema(): Promise<{ ok: boolean; missing: string[] }> {
  const result = await pool.query<{ tablename: string }>(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename = ANY($1::text[])`,
    [CRON_TIER_TABLES],
  )
  const found = new Set(result.rows.map((r) => r.tablename))
  const missing = CRON_TIER_TABLES.filter((t) => !found.has(t))
  return { ok: missing.length === 0, missing }
}

export function startHealthServer(): void {
  const server = createServer((_req, res) => {
    pool
      .query('SELECT 1')
      .then(async () => {
        const schema = await checkSchema()
        const payload: HealthPayload = {
          status: schema.ok ? 'ok' : 'degraded',
          version: VERSION,
          squad: manifest.squad,
          db: 'connected',
          schema: schema.ok ? 'ok' : 'degraded',
          ...(schema.missing.length > 0 ? { missing_tables: schema.missing } : {}),
        }
        const httpStatus = schema.ok ? 200 : 503
        res.writeHead(httpStatus, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
      })
      .catch((err: unknown) => {
        const payload: HealthPayload = {
          status: 'degraded',
          version: VERSION,
          squad: manifest.squad,
          db: 'error',
          error: err instanceof Error ? err.message : 'unknown error',
        }
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
      })
  })

  server.listen(config.HEALTH_PORT, () => {
    console.error(`[health] Listening on port ${String(config.HEALTH_PORT)}`)
  })
}
