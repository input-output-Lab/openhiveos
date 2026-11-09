import { Router } from 'express'
import { generateReport } from '../../services/reports/index.js'

// ---------------------------------------------------------------------------
// GET /api/reports/* — REST wrappers over the report service (S18-BE-04 #2566)
//
//   GET /api/reports/projects/:id?period=14 → ProjectReport JSON
//   GET /api/reports/hive?period=14         → HiveReport JSON
//
// Thin by design: the handlers call the SAME generateReport service the MCP
// generate_report tool uses, and return the identical JSON payload — the AC
// "same output as MCP JSON" is structural (one code path), verified by a
// deep-equality test against handleGenerateReport's output.
//
// Auth: behind /api authMiddleware like every other /api route — internal
// metrics, never client-facing (same posture as /api/budget, 2560).
//
// Period: ?period= days, 1–90 (same clamp as the MCP tool's Zod schema),
// default 14.
// ---------------------------------------------------------------------------

export const reportsRouter = Router()

function parsePeriod(raw: unknown): number | 'invalid' {
  if (raw === undefined) return 14
  if (typeof raw !== 'string') return 'invalid'
  const n = parseInt(raw, 10)
  if (!Number.isInteger(n) || n < 1 || n > 90) return 'invalid'
  return n
}

reportsRouter.get('/projects/:id', async (req, res) => {
  const projectId = parseInt(req.params['id'], 10)
  if (!Number.isInteger(projectId) || projectId <= 0) {
    res.status(400).json({ error: 'Project ID must be a positive integer' })
    return
  }

  const period = parsePeriod(req.query['period'])
  if (period === 'invalid') {
    res.status(400).json({ error: 'period must be an integer between 1 and 90' })
    return
  }

  try {
    const { report } = await generateReport({ scope: 'project', projectId, periodDays: period })
    res.json(report)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // generateReport throws only for scope/arg issues; project lookups are
    // tolerant (name may be null), so an empty project still yields a report.
    console.error('[squad-api/reports] project report error:', message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

reportsRouter.get('/hive', async (req, res) => {
  const period = parsePeriod(req.query['period'])
  if (period === 'invalid') {
    res.status(400).json({ error: 'period must be an integer between 1 and 90' })
    return
  }

  try {
    const { report } = await generateReport({ scope: 'hive', periodDays: period })
    res.json(report)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[squad-api/reports] hive report error:', message)
    res.status(500).json({ error: 'Internal server error' })
  }
})
