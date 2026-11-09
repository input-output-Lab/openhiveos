import { Router } from 'express'
import { squadApiPool as pool } from '../db.js'

// ---------------------------------------------------------------------------
// GET /api/audit/latest — latest audit_runs row (S18-FE-01 #2561 backend glue)
//
// The audit library itself is MCP-only (audit_hive, #2567); the dashboard's
// Audit panel needs a read-only REST peek at the most recent run. Thin:
// SELECT on audit_runs, no execution (running an audit from a GET would be
// a side effect — the MCP tool owns execution).
//
// Auth: behind /api authMiddleware (internal metrics). 404 with
// { error: 'no_audit_runs' } until the first audit_hive run happens.
// ---------------------------------------------------------------------------

export const auditRouter = Router()

interface AuditRunRow {
  id: number
  started_at: Date
  duration_ms: number | null
  score: string
  invariants_run: number
  findings: Array<{ id: string; severity: 'info' | 'warn' | 'critical'; pass: boolean; evidence: string; count: number }>
}

auditRouter.get('/latest', async (_req, res) => {
  try {
    const result = await pool.query<AuditRunRow>(
      `SELECT id, started_at, duration_ms, score::text AS score, invariants_run, findings
         FROM audit_runs
     ORDER BY started_at DESC
        LIMIT 1`,
    )
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'no_audit_runs', message: 'No audit has run yet — invoke the audit_hive MCP tool.' })
      return
    }
    const row = result.rows[0]
    if (row === undefined) {
      res.status(404).json({ error: 'no_audit_runs', message: 'No audit has run yet — invoke the audit_hive MCP tool.' })
      return
    }
    res.json({
      run_id: row.id,
      started_at: row.started_at,
      duration_ms: row.duration_ms,
      score: Number(row.score),
      invariants_run: row.invariants_run,
      findings: row.findings,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Migration 030 not applied yet → 404-style degradation, not a 500.
    if (message.includes('audit_runs') && message.includes('does not exist')) {
      res.status(404).json({ error: 'no_audit_runs', message: 'audit_runs table not present (migration 030 pending).' })
      return
    }
    console.error('[squad-api/audit] latest error:', message)
    res.status(500).json({ error: 'Internal server error' })
  }
})
