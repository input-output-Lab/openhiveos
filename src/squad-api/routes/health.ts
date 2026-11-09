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

// ---------------------------------------------------------------------------
// GET /health/deep — audit-depth health probe (S18-OPS-01 #2569).
//
// Returns the LATEST audit_runs row (score + failure counts) — read-only,
// never executes the audit (a GET must not side-effect; execution belongs
// to the run_audit cron and the audit_hive MCP tool).
//
// Shape:
//   status:         'ok' | 'degraded' | 'no_data'
//   service:        'squad-api'
//   audit:          { run_id, score, critical_failures, warnings, ran_at }
//   error?:         string
//
// HTTP 200 when a run exists (even with failing findings — the probe reports
// audit state, it does not gate on it; monitors gate on the score field).
// HTTP 503 'no_data' when no audit run exists yet (cron hasn't fired).
// HTTP 503 'degraded' on DB error.
// ---------------------------------------------------------------------------

const LATEST_AUDIT_SQL = `
  SELECT id::text            AS run_id,
         score::text         AS score,
         (SELECT COUNT(*) FROM jsonb_array_elements(findings) f
           WHERE f->>'severity' = 'critical' AND (f->>'pass')::boolean = false) AS critical_failures,
         (SELECT COUNT(*) FROM jsonb_array_elements(findings) f
           WHERE f->>'severity' = 'warn' AND (f->>'pass')::boolean = false) AS warnings,
         started_at          AS ran_at
    FROM audit_runs
   ORDER BY started_at DESC
   LIMIT 1
`

router.get('/deep', async (_req, res) => {
  const client = await squadApiPool.connect().catch((err: unknown): Error => {
    return err instanceof Error ? err : new Error(String(err))
  })

  if (client instanceof Error) {
    console.error('[squad-api/health/deep] Pool connect failed:', client.message)
    res.status(503).json({ status: 'degraded', service: 'squad-api', error: client.message })
    return
  }

  try {
    const result = await client.query<{
      run_id: string
      score: string
      critical_failures: string
      warnings: string
      ran_at: Date
    }>(LATEST_AUDIT_SQL)

    const row = result.rows[0]
    if (!row) {
      res.status(503).json({ status: 'no_data', service: 'squad-api' })
      return
    }

    res.status(200).json({
      status: 'ok',
      service: 'squad-api',
      audit: {
        run_id: parseInt(row.run_id, 10),
        score: parseFloat(row.score),
        critical_failures: parseInt(row.critical_failures, 10),
        warnings: parseInt(row.warnings, 10),
        ran_at: row.ran_at,
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[squad-api/health/deep] audit_runs query failed:', message)
    res.status(503).json({ status: 'degraded', service: 'squad-api', error: message })
  } finally {
    client.release()
  }
})

export { router as healthRouter }
