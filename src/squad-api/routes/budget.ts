import { Router } from 'express'
import { withReaderRole } from '../db.js'

// ---------------------------------------------------------------------------
// GET /api/budget — internal budget view (S18-BE-05, #2560)
//
// Founder budgeting data: estimate vs actual hours vs LLM cost, per task,
// with project rollups. INTERNAL ONLY — this endpoint is the raw feed for
// the internal budget report section (S18-BE-03/04) and the /budget
// dashboard view (S18-FE-01). It must never be surfaced in client-facing
// reports; enforcement is structural: it lives behind /api authMiddleware
// and no client-facing report generator consumes it.
//
// Data sources (dependencies satisfied by S16-DB-02, S17-BE-03, S17-DB-01):
//   estimates   → tasks.estimated_hours, tasks.billing_low, tasks.billing_high
//   actual hrs  → task_worklogs.minutes (source auto + human), billable filter
//   LLM cost    → v_cost_by_task (llm_usage aggregated per task)
//
// Variance semantics:
//   hours_variance_pct = (actual_h - estimated) / estimated, NULL when
//   estimated = 0/NULL. Same shape for cost: estimated cost is not modeled,
//   so cost variance is reported against billing_mid = (low+high)/2 when the
//   caller opts in — kept out of v1 to avoid implying a cost model we don't
//   have. We report cost_abs and hours_variance_pct only.
//
// All queries run under openhiveos_reader via withReaderRole() (SEC-A5).
// Fixed SQL + parameterized args only (OWASP A03).
// ---------------------------------------------------------------------------

export const budgetRouter = Router()

interface BudgetTaskRow {
  task_id: number
  title: string
  project_id: number
  project_name: string
  assignee_agent_slug: string | null
  status: string
  estimated_hours: string | null
  billing_low: string | null
  billing_high: string | null
  actual_minutes: string | null
  auto_minutes: string | null
  human_minutes: string | null
  llm_cost_usd: string | null
  request_count: string | null
}

interface ProjectRollupRow {
  project_id: number
  project_name: string
  task_count: string
  estimated_hours: string | null
  actual_minutes: string | null
  llm_cost_usd: string | null
}

// Task-level budget rows. Estimates from tasks; actuals from task_worklogs
// (auto + human, billable only); LLM cost from v_cost_by_task. LEFT JOINs —
// a task with no worklogs or no usage still appears with NULLs.
const BUDGET_TASKS_SQL = `
  SELECT
    t.id                          AS task_id,
    t.title                       AS title,
    t.project_id                  AS project_id,
    p.name                        AS project_name,
    t.assignee_agent_slug         AS assignee_agent_slug,
    t.status                      AS status,
    t.estimated_hours::text       AS estimated_hours,
    t.billing_low::text           AS billing_low,
    t.billing_high::text          AS billing_high,
    COALESCE(w.total_minutes, 0)::text  AS actual_minutes,
    COALESCE(w.auto_minutes, 0)::text   AS auto_minutes,
    COALESCE(w.human_minutes, 0)::text  AS human_minutes,
    c.cost_usd::text              AS llm_cost_usd,
    c.request_count::text         AS request_count
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  LEFT JOIN (
    SELECT
      task_id,
      SUM(minutes)                              AS total_minutes,
      SUM(minutes) FILTER (WHERE source = 'auto')  AS auto_minutes,
      SUM(minutes) FILTER (WHERE source = 'human') AS human_minutes
    FROM task_worklogs
    WHERE billable = true
    GROUP BY task_id
  ) w ON w.task_id = t.id
  LEFT JOIN v_cost_by_task c ON c.task_id = t.id
  WHERE ($1::int IS NULL OR t.project_id = $1::int)
    AND ($2::text IS NULL OR t.status = $2::text)
  ORDER BY t.project_id, t.id
`

// Project rollup over the same facts.
const BUDGET_PROJECTS_SQL = `
  SELECT
    t.project_id                  AS project_id,
    p.name                        AS project_name,
    COUNT(*)::text                AS task_count,
    SUM(t.estimated_hours)::text  AS estimated_hours,
    COALESCE(SUM(w.total_minutes), 0)::text AS actual_minutes,
    COALESCE(SUM(c.cost_usd), 0)::text      AS llm_cost_usd
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  LEFT JOIN (
    SELECT task_id, SUM(minutes) AS total_minutes
    FROM task_worklogs
    WHERE billable = true
    GROUP BY task_id
  ) w ON w.task_id = t.id
  LEFT JOIN v_cost_by_task c ON c.task_id = t.id
  WHERE ($1::int IS NULL OR t.project_id = $1::int)
  GROUP BY t.project_id, p.name
  ORDER BY t.project_id
`

/** hours variance pct — null-safe: NULL when no estimate or estimate = 0. */
export function hoursVariancePct(
  actualMinutes: string | null,
  estimatedHours: string | null,
): number | null {
  const est = Number(estimatedHours)
  if (!Number.isFinite(est) || est === 0) return null
  const actualH = Number(actualMinutes ?? 0) / 60
  return Math.round(((actualH - est) / est) * 10000) / 100 // 2dp
}

budgetRouter.get('/', async (req, res) => {
  // Optional filters: ?project_id=70&status=done — both optional, both validated.
  const rawProject = req.query['project_id']
  const rawStatus = req.query['status']

  let projectId: number | null = null
  if (typeof rawProject === 'string' && rawProject !== '') {
    projectId = parseInt(rawProject, 10)
    if (!Number.isInteger(projectId) || projectId <= 0) {
      res.status(400).json({ error: 'project_id must be a positive integer' })
      return
    }
  }

  if (rawStatus !== undefined && (typeof rawStatus !== 'string' || rawStatus === '')) {
    res.status(400).json({ error: 'status must be a non-empty string' })
    return
  }
  const status = typeof rawStatus === 'string' ? rawStatus : null

  try {
    const [taskRows, projectRows] = await withReaderRole<[BudgetTaskRow[], ProjectRollupRow[]]>(
      async (client) => {
        const t = await client.query<BudgetTaskRow>(BUDGET_TASKS_SQL, [projectId, status])
        const p = await client.query<ProjectRollupRow>(BUDGET_PROJECTS_SQL, [projectId])
        return [t.rows, p.rows]
      },
    )

    const tasks = taskRows.map((r) => ({
      task_id: r.task_id,
      title: r.title,
      project_id: r.project_id,
      project_name: r.project_name,
      assignee_agent_slug: r.assignee_agent_slug,
      status: r.status,
      estimated_hours: r.estimated_hours === null ? null : Number(r.estimated_hours),
      billing_low: r.billing_low === null ? null : Number(r.billing_low),
      billing_high: r.billing_high === null ? null : Number(r.billing_high),
      actual_hours: Math.round((Number(r.actual_minutes) / 60) * 100) / 100,
      actual_hours_split: {
        auto: Math.round((Number(r.auto_minutes) / 60) * 100) / 100,
        human: Math.round((Number(r.human_minutes) / 60) * 100) / 100,
      },
      hours_variance_pct: hoursVariancePct(r.actual_minutes, r.estimated_hours),
      llm_cost_usd: r.llm_cost_usd === null ? 0 : Number(r.llm_cost_usd),
      llm_request_count: r.request_count === null ? 0 : Number(r.request_count),
    }))

    const projects = projectRows.map((r) => ({
      project_id: r.project_id,
      project_name: r.project_name,
      task_count: Number(r.task_count),
      estimated_hours: r.estimated_hours === null ? 0 : Number(r.estimated_hours),
      actual_hours: Math.round((Number(r.actual_minutes) / 60) * 100) / 100,
      llm_cost_usd: Number(r.llm_cost_usd),
    }))

    res.json({ internal_only: true, filters: { project_id: projectId, status }, data: { tasks, projects } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[squad-api/budget] query error:', message)
    res.status(500).json({ error: 'Internal server error' })
  }
})
