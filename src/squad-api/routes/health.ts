import { Router } from 'express'
import { squadApiPool } from '../db.js'

// ---------------------------------------------------------------------------
// GET /health — unauthenticated infrastructure health probe (ARCH-012, ARCH-019)
//
// Checks:
//   1. DB connectivity — can we acquire a connection from the pool?
//   2. Schema integrity — are all Sprint 9 required tables present?
//
// Response shape (Silas, ARCH-019 Sprint 9 planning 2026-05-23):
//   status:          'ok' | 'degraded'
//   service:         'squad-api'  (constant — identifies the process)
//   db:              'connected' | 'error'
//   schema:          'ok' | 'degraded'
//   missing_tables?: string[]    (present only when schema = 'degraded')
//   error?:          string      (present only when db = 'error')
//
// HTTP 200 when status = 'ok'.
// HTTP 503 when status = 'degraded' (db error or missing tables).
//
// No authentication. No rate limit. Safe to poll from external monitors.
// Uses squadApiPool directly (not withReaderRole) — this is a privileged
// infrastructure probe, not a user data query.
// ---------------------------------------------------------------------------

const router = Router()

// Tables that Sprint 9 routes depend on. Checked at every health probe.
const REQUIRED_TABLES = [
  'agents',
  'tasks',
  'projects',
  'thoughts',
  'sops',
  'ethos_seals',
] as const

const SCHEMA_CHECK_SQL = `
  SELECT table_name
    FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name = ANY($1)
`

router.get('/', async (_req, res) => {
  const client = await squadApiPool.connect().catch((err: unknown): Error => {
    return err instanceof Error ? err : new Error(String(err))
  })

  if (client instanceof Error) {
    const message = client.message
    console.error('[squad-api/health] Pool connect failed:', message)
    res.status(503).json({
      status: 'degraded',
      service: 'squad-api',
      db: 'error',
      schema: 'degraded',
      error: message,
    })
    return
  }

  try {
    const result = await client.query<{ table_name: string }>(
      SCHEMA_CHECK_SQL,
      [[...REQUIRED_TABLES]],
    )

    const found = result.rows.map((r) => r.table_name)
    const missing = REQUIRED_TABLES.filter((t) => !found.includes(t))
    const schema: 'ok' | 'degraded' = missing.length === 0 ? 'ok' : 'degraded'
    const status: 'ok' | 'degraded' = schema === 'ok' ? 'ok' : 'degraded'

    const body: Record<string, unknown> = {
      status,
      service: 'squad-api',
      db: 'connected',
      schema,
    }

    if (missing.length > 0) {
      body.missing_tables = missing
    }

    res.status(status === 'ok' ? 200 : 503).json(body)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[squad-api/health] Schema check failed:', message)
    res.status(503).json({
      status: 'degraded',
      service: 'squad-api',
      db: 'error',
      schema: 'degraded',
      error: message,
    })
  } finally {
    client.release()
  }
})

export { router as healthRouter }
