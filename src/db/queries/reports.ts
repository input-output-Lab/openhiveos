import { pool } from '../client.js'

// ---------------------------------------------------------------------------
// reports.ts — S18-BE-03 (#2562) report section aggregations.
//
// One query per report section. Fixed SQL, parameterized args only ($n) —
// the only user-supplied values are project_id (int) and period_days (int),
// both validated upstream by the generate-report utility schema.
//
// Coverage honesty (task AC): every function returns a coverage block so the
// rendered report can label exactly what data window/row count backs each
// section. Sections with zero backing rows degrade to "no data" in the
// renderer rather than showing misleading zeros.
// ---------------------------------------------------------------------------

export interface ReportCoverage {
  source: string
  window_days: number
  rows: number
}

function coverage(source: string, windowDays: number, rows: number): ReportCoverage {
  return { source, window_days: windowDays, rows }
}

// ─── Status mix ──────────────────────────────────────────────────────────────

export interface StatusMixRow {
  status: string
  count: number
}

export async function statusMix(projectId: number | null): Promise<{ rows: StatusMixRow[]; cov: ReportCoverage }> {
  const result = await pool.query<StatusMixRow>(
    `SELECT status, COUNT(*)::int AS count
       FROM tasks
      WHERE ($1::int IS NULL OR project_id = $1::int)
   GROUP BY status
   ORDER BY count DESC`,
    [projectId],
  )
  return { rows: result.rows, cov: coverage('tasks.status', 0, result.rows.length) }
}

// ─── Aging (open tasks by age bucket) ───────────────────────────────────────

export interface AgingRow {
  bucket: string
  count: number
}

export async function agingBuckets(projectId: number | null): Promise<{ rows: AgingRow[]; cov: ReportCoverage }> {
  const result = await pool.query<AgingRow>(
    `SELECT CASE
              WHEN age < INTERVAL '7 days'   THEN '<7d'
              WHEN age < INTERVAL '14 days'  THEN '7-14d'
              WHEN age < INTERVAL '30 days'  THEN '14-30d'
              ELSE '30d+'
            END AS bucket,
            COUNT(*)::int AS count
       FROM (
         SELECT now() - updated_at AS age
           FROM tasks
          WHERE status NOT IN ('done', 'pending-close')
            AND ($1::int IS NULL OR project_id = $1::int)
       ) open
   GROUP BY bucket
   ORDER BY MIN(age)`,
    [projectId],
  )
  return { rows: result.rows, cov: coverage('tasks.updated_at (open tasks)', 0, result.rows.length) }
}

// ─── Rework rate + throughput + cycle time (from status history) ────────────

export interface HistoryMetrics {
  done_count: number
  rework_events: number
  reviews_entered: number
  avg_cycle_hours: number | null
  cov: ReportCoverage
}

/**
 * Cycle time: wip → done span per task finished in the window, averaged.
 * Rework events: transitions into 'rework'.
 * Throughput: tasks whose to_status='done' transition falls in the window.
 */
export async function historyMetrics(
  projectId: number | null,
  periodDays: number,
): Promise<HistoryMetrics> {
  const result = await pool.query<{
    done_count: number
    rework_events: number
    reviews_entered: number
    avg_cycle_hours: string | null
  }>(
    `WITH win AS (
        SELECT h.*
          FROM task_status_history h
          JOIN tasks t ON t.id = h.task_id
         WHERE h.changed_at >= now() - ($2::int * INTERVAL '1 day')
           AND ($1::int IS NULL OR t.project_id = $1::int)
     ),
     dones AS (
       SELECT task_id, MIN(changed_at) AS done_at
         FROM win WHERE to_status = 'done'
      GROUP BY task_id
     ),
     wips AS (
       SELECT task_id, MIN(changed_at) AS wip_at
         FROM win WHERE to_status = 'wip'
      GROUP BY task_id
     )
     SELECT
       (SELECT COUNT(*)::int FROM dones) AS done_count,
       (SELECT COUNT(*)::int FROM win WHERE to_status = 'rework') AS rework_events,
       (SELECT COUNT(*)::int FROM win WHERE to_status = 'review') AS reviews_entered,
       (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (d.done_at - w.wip_at)) / 3600)::numeric, 1)::text
          FROM dones d JOIN wips w ON w.task_id = d.task_id
         WHERE d.done_at >= w.wip_at) AS avg_cycle_hours`,
    [projectId, periodDays],
  )
  const r = result.rows[0] ?? { done_count: 0, rework_events: 0, reviews_entered: 0, avg_cycle_hours: null }
  return {
    done_count: r.done_count,
    rework_events: r.rework_events,
    reviews_entered: r.reviews_entered,
    avg_cycle_hours: r.avg_cycle_hours === null ? null : Number(r.avg_cycle_hours),
    cov: coverage('task_status_history', periodDays, r.done_count + r.rework_events + r.reviews_entered),
  }
}

// ─── Estimate vs actual (per task, window = current sprint tasks) ───────────

export interface EstimateActualRow {
  task_id: number
  title: string
  assignee: string | null
  estimated_hours: number | null
  actual_hours: number
  variance_pct: number | null
}

export async function estimateActual(
  projectId: number | null,
): Promise<{ rows: EstimateActualRow[]; cov: ReportCoverage }> {
  const result = await pool.query<{
    task_id: number
    title: string
    assignee: string | null
    estimated_hours: string | null
    actual_minutes: string | null
  }>(
    `SELECT t.id AS task_id, t.title, t.assignee_agent_slug AS assignee,
            t.estimated_hours::text AS estimated_hours,
            COALESCE(SUM(w.minutes), 0)::text AS actual_minutes
       FROM tasks t
       LEFT JOIN task_worklogs w ON w.task_id = t.id AND w.billable = true
      WHERE t.status NOT IN ('todo', 'triage')
        AND ($1::int IS NULL OR t.project_id = $1::int)
   GROUP BY t.id, t.title, t.assignee_agent_slug, t.estimated_hours
   ORDER BY t.id`,
    [projectId],
  )
  const rows = result.rows.map((r) => {
    const est = r.estimated_hours === null ? null : Number(r.estimated_hours)
    const actualH = Number(r.actual_minutes ?? 0) / 60
    const variancePct =
      est === null || est === 0
        ? null
        : Math.round(((actualH - est) / est) * 10000) / 100
    return {
      task_id: r.task_id,
      title: r.title,
      assignee: r.assignee,
      estimated_hours: est,
      actual_hours: Math.round(actualH * 100) / 100,
      variance_pct: variancePct,
    }
  })
  return { rows, cov: coverage('tasks + task_worklogs (billable)', 0, rows.length) }
}

// ─── LLM cost (per project or hive-wide) ────────────────────────────────────

export interface CostRow {
  label: string
  cost_usd: number
  request_count: number
}

export async function llmCost(
  projectId: number | null,
  periodDays: number,
): Promise<{ rows: CostRow[]; cov: ReportCoverage }> {
  // projectId === null → hive scope → aggregate by agent.
  // projectId set → project scope → aggregate that project's cost.
  // NOTE: the SQL branches were previously INVERTED (null selected the
  // by-project query), which also broke pg's param typing ($2 referenced
  // before $1 in the by-project text). Fixed: explicit branches, $1 before
  // $2, both typed.
  const byProject = projectId !== null
  const sql = byProject
    ? `SELECT p.name AS label,
              COALESCE(SUM(u.cost_usd), 0)::text AS cost_usd,
              COUNT(u.id)::text AS request_count
         FROM llm_usage u
         JOIN tasks t ON t.id = u.task_id
         JOIN projects p ON p.id = t.project_id
        WHERE t.project_id = $1::int
          AND u.recorded_at >= now() - ($2::int * INTERVAL '1 day')
     GROUP BY p.name`
    : `SELECT COALESCE(u.agent_slug, 'unknown') AS label,
              COALESCE(SUM(u.cost_usd), 0)::text AS cost_usd,
              COUNT(u.id)::text AS request_count
         FROM llm_usage u
        WHERE u.recorded_at >= now() - ($1::int * INTERVAL '1 day')
     GROUP BY u.agent_slug
     ORDER BY SUM(u.cost_usd) DESC`
  const result = await pool.query<{ label: string; cost_usd: string; request_count: string }>(
    sql,
    byProject ? [projectId, periodDays] : [periodDays],
  )
  const rows = result.rows.map((r) => ({
    label: r.label,
    cost_usd: Number(r.cost_usd),
    request_count: Number(r.request_count),
  }))
  return {
    rows,
    cov: coverage(byProject ? 'llm_usage ⋈ tasks ⋈ projects' : 'llm_usage (by agent)', periodDays, rows.length),
  }
}

// ─── Per-agent workload (open tasks + throughput) ───────────────────────────

export interface AgentWorkloadRow {
  agent_slug: string
  open_tasks: number
  done_in_window: number
  logged_hours: number
}

export async function agentWorkload(
  projectId: number | null,
  periodDays: number,
): Promise<{ rows: AgentWorkloadRow[]; cov: ReportCoverage }> {
  const result = await pool.query<{
    agent_slug: string
    open_tasks: string
    done_in_window: string
    logged_minutes: string | null
  }>(
    `WITH open AS (
       SELECT assignee_agent_slug AS slug, COUNT(*)::int AS n
         FROM tasks
        WHERE assignee_agent_slug IS NOT NULL
          AND status NOT IN ('done', 'pending-close')
          AND ($1::int IS NULL OR project_id = $1::int)
     GROUP BY assignee_agent_slug
     ),
     done AS (
       SELECT t.assignee_agent_slug AS slug, COUNT(DISTINCT h.task_id)::int AS n
         FROM task_status_history h
         JOIN tasks t ON t.id = h.task_id
        WHERE h.to_status = 'done'
          AND h.changed_at >= now() - ($2::int * INTERVAL '1 day')
          AND t.assignee_agent_slug IS NOT NULL
          AND ($1::int IS NULL OR t.project_id = $1::int)
     GROUP BY t.assignee_agent_slug
     ),
     logged AS (
       SELECT w.agent_slug AS slug, SUM(w.minutes)::text AS mins
         FROM task_worklogs w
         JOIN tasks t ON t.id = w.task_id
        WHERE w.worked_on >= (now() - ($2::int * INTERVAL '1 day'))::date
          AND ($1::int IS NULL OR t.project_id = $1::int)
     GROUP BY w.agent_slug
     )
     SELECT COALESCE(o.slug, d.slug, l.slug) AS agent_slug,
            COALESCE(o.n, 0)::text AS open_tasks,
            COALESCE(d.n, 0)::text AS done_in_window,
            l.mins AS logged_minutes
       FROM open o
  FULL OUTER JOIN done d ON d.slug = o.slug
  FULL OUTER JOIN logged l ON l.slug = COALESCE(o.slug, d.slug)
   ORDER BY COALESCE(o.n, 0) DESC`,
    [projectId, periodDays],
  )
  const rows = result.rows.map((r) => ({
    agent_slug: r.agent_slug,
    open_tasks: Number(r.open_tasks),
    done_in_window: Number(r.done_in_window),
    logged_hours: Math.round((Number(r.logged_minutes ?? 0) / 60) * 100) / 100,
  }))
  return {
    rows,
    cov: coverage('tasks + task_status_history + task_worklogs', periodDays, rows.length),
  }
}

// ─── Portfolio summary (hive scope) ─────────────────────────────────────────

export interface PortfolioRow {
  project_id: number
  name: string
  status: string
  roi_score: number | null
  task_count: number
  done_count: number
}

export async function portfolioSummary(): Promise<{ rows: PortfolioRow[]; cov: ReportCoverage }> {
  const result = await pool.query<{
    project_id: number
    name: string
    status: string
    roi_score: string | null
    task_count: string
    done_count: string
  }>(
    `SELECT p.id AS project_id, p.name, p.status::text AS status,
            (p.business_value * p.strategic_fit)::FLOAT
              / CASE WHEN p.effort = 0 THEN NULL ELSE p.effort END AS roi_score,
            COUNT(t.id)::text AS task_count,
            COUNT(t.id) FILTER (WHERE t.status = 'done')::text AS done_count
       FROM projects p
       LEFT JOIN tasks t ON t.project_id = p.id
   GROUP BY p.id, p.name, p.status, p.business_value, p.strategic_fit, p.effort
   ORDER BY roi_score DESC NULLS LAST, p.name`,
    [],
  )
  const rows = result.rows.map((r) => ({
    project_id: r.project_id,
    name: r.name,
    status: r.status,
    roi_score: r.roi_score === null ? null : Number(r.roi_score),
    task_count: Number(r.task_count),
    done_count: Number(r.done_count),
  }))
  return { rows, cov: coverage('projects + tasks', 0, rows.length) }
}

// ─── Cross-project blockers (hive scope) ────────────────────────────────────

export interface BlockerRow {
  task_id: number
  title: string
  project_name: string
  status: string
  days_in_status: number
  assignee: string | null
}

export async function crossProjectBlockers(): Promise<{ rows: BlockerRow[]; cov: ReportCoverage }> {
  const result = await pool.query<{
    task_id: number
    title: string
    project_name: string
    status: string
    days_in_status: string
    assignee: string | null
  }>(
    `SELECT t.id AS task_id, t.title, p.name AS project_name, t.status::text AS status,
            ROUND(EXTRACT(EPOCH FROM (now() - t.updated_at)) / 86400)::int::text AS days_in_status,
            t.assignee_agent_slug AS assignee
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
      WHERE t.status IN ('review', 'rework')
        AND t.updated_at < now() - INTERVAL '2 days'
   ORDER BY t.updated_at ASC
      LIMIT 15`,
    [],
  )
  const rows = result.rows.map((r) => ({
    task_id: r.task_id,
    title: r.title,
    project_name: r.project_name,
    status: r.status,
    days_in_status: Number(r.days_in_status),
    assignee: r.assignee,
  }))
  return { rows, cov: coverage('tasks (review/rework > 2d)', 0, rows.length) }
}

// ─── Flow metrics detail (S18-BE-06 #2565) ──────────────────────────────────
//
// Deeper task_status_history aggregations than historyMetrics():
//   cycleTimePerStatus — avg hours spent per destination status (wip, review,
//                        done) across transitions completed in the window
//   leadTime           — avg hours from first 'todo' entry to 'done'
//   timeInReview       — avg cumulative review hours per task that entered
//                        review in the window
// Velocity (done per sprint) and burndown are separate functions below.
//
// All windows: transitions with changed_at >= now() - periodDays.

export interface StatusCycleRow {
  to_status: string
  avg_hours: number
  samples: number
}

export async function cycleTimePerStatus(
  projectId: number | null,
  periodDays: number,
): Promise<{ rows: StatusCycleRow[]; cov: ReportCoverage }> {
  const result = await pool.query<{ to_status: string; avg_hours: string; samples: string }>(
    `WITH exits AS (
       SELECT h.task_id, h.to_status, h.changed_at,
              LEAD(h.changed_at) OVER (PARTITION BY h.task_id ORDER BY h.changed_at) AS next_at
         FROM task_status_history h
         JOIN tasks t ON t.id = h.task_id
        WHERE h.changed_at >= now() - ($2::int * INTERVAL '1 day')
          AND ($1::int IS NULL OR t.project_id = $1::int)
     )
     SELECT to_status,
            ROUND(AVG(EXTRACT(EPOCH FROM (next_at - changed_at)) / 3600)::numeric, 1)::text AS avg_hours,
            COUNT(*)::text AS samples
       FROM exits
      WHERE next_at IS NOT NULL
   GROUP BY to_status`,
    [projectId, periodDays],
  )
  const rows = result.rows.map((r) => ({
    to_status: r.to_status,
    avg_hours: Number(r.avg_hours),
    samples: Number(r.samples),
  }))
  return { rows, cov: coverage('task_status_history (transition spans)', periodDays, rows.length) }
}

export interface LeadTimeResult {
  avg_lead_hours: number | null
  samples: number
  cov: ReportCoverage
}

/** Lead time: first 'todo' entry → first 'done' per task finished in window. */
export async function leadTime(
  projectId: number | null,
  periodDays: number,
): Promise<LeadTimeResult> {
  const result = await pool.query<{ avg_lead_hours: string | null; samples: string }>(
    `WITH starts AS (
       SELECT task_id, MIN(changed_at) AS started_at
         FROM task_status_history h
         JOIN tasks t ON t.id = h.task_id
        WHERE to_status = 'todo'
          AND ($1::int IS NULL OR t.project_id = $1::int)
     GROUP BY task_id
     ),
     finishes AS (
       SELECT h.task_id, MIN(h.changed_at) AS done_at
         FROM task_status_history h
         JOIN tasks t ON t.id = h.task_id
        WHERE h.to_status = 'done'
          AND h.changed_at >= now() - ($2::int * INTERVAL '1 day')
          AND ($1::int IS NULL OR t.project_id = $1::int)
     GROUP BY h.task_id
     )
     SELECT ROUND(AVG(EXTRACT(EPOCH FROM (f.done_at - s.started_at)) / 3600)::numeric, 1)::text AS avg_lead_hours,
            COUNT(*)::text AS samples
       FROM finishes f JOIN starts s ON s.task_id = f.task_id
      WHERE f.done_at >= s.started_at`,
    [projectId, periodDays],
  )
  const r = result.rows[0] ?? { avg_lead_hours: null, samples: '0' }
  return {
    avg_lead_hours: r.avg_lead_hours === null ? null : Number(r.avg_lead_hours),
    samples: Number(r.samples),
    cov: coverage('task_status_history (todo→done)', periodDays, Number(r.samples)),
  }
}

export interface VelocityRow {
  label: string
  done_count: number
  window_days: number
}

/**
 * Velocity: done transitions bucketed into sprint-length windows.
 * Buckets are calendar-ordered [oldest … current].
 */
export async function velocity(
  projectId: number | null,
  periodDays: number,
  sprintLengthDays = 14,
): Promise<{ rows: VelocityRow[]; cov: ReportCoverage }> {
  const result = await pool.query<{ label: string; done_count: string; window_days: string }>(
    `SELECT to_char(date_trunc('day', d.bucket_end) - ($3::int * INTERVAL '1 day'), 'YYYY-MM-DD') || ' → ' || to_char(d.bucket_end, 'MM-DD') AS label,
            d.done_count::text,
            $3::int::text AS window_days
       FROM (
         SELECT gs.bucket_end,
                COUNT(h.id) AS done_count
           FROM generate_series(
                  date_trunc('day', now()) - ($2::int * INTERVAL '1 day'),
                  date_trunc('day', now()),
                  ($3::int * INTERVAL '1 day')
                ) AS gs(bucket_end)
           LEFT JOIN task_status_history h
             ON h.to_status = 'done'
            AND h.changed_at > gs.bucket_end - ($3::int * INTERVAL '1 day')
            AND h.changed_at <= gs.bucket_end
           LEFT JOIN tasks t ON t.id = h.task_id
          WHERE ($1::int IS NULL OR t.project_id = $1::int OR h.id IS NULL)
       GROUP BY gs.bucket_end
       ) d
   ORDER BY d.bucket_end`,
    [projectId, periodDays, sprintLengthDays],
  )
  const rows = result.rows.map((r) => ({
    label: r.label,
    done_count: Number(r.done_count),
    window_days: Number(r.window_days),
  }))
  return { rows, cov: coverage('task_status_history (done/sprint bucket)', periodDays, rows.length) }
}

export interface BurndownPoint {
  date: string
  remaining: number
}

/**
 * Burndown: count of currently-open tasks' remaining work over time is not
 * reconstructable without snapshots, so we plot open-task count by day for
 * the window: tasks created (or first seen) before day D and not yet done
 * at day D. Approximation uses task_status_history: a task is "open" on day
 * D if its first todo-entry ≤ D and its first done-entry is > D (or absent).
 */
export async function burndown(
  projectId: number | null,
  periodDays: number,
): Promise<{ rows: BurndownPoint[]; cov: ReportCoverage }> {
  const result = await pool.query<{ date: string; remaining: string }>(
    `WITH days AS (
       SELECT generate_series(
                date_trunc('day', now()) - ($2::int * INTERVAL '1 day'),
                date_trunc('day', now()),
                INTERVAL '1 day'
              )::date AS d
     ),
     first_todo AS (
       SELECT h.task_id, MIN(h.changed_at)::date AS started
         FROM task_status_history h
         JOIN tasks t ON t.id = h.task_id
        WHERE h.to_status = 'todo'
          AND ($1::int IS NULL OR t.project_id = $1::int)
     GROUP BY h.task_id
     ),
     first_done AS (
       SELECT h.task_id, MIN(h.changed_at)::date AS finished
         FROM task_status_history h
         JOIN tasks t ON t.id = h.task_id
        WHERE h.to_status = 'done'
          AND ($1::int IS NULL OR t.project_id = $1::int)
     GROUP BY h.task_id
     )
     SELECT to_char(days.d, 'YYYY-MM-DD') AS date,
            COUNT(ft.task_id)::text AS remaining
       FROM days
       LEFT JOIN first_todo ft ON ft.started <= days.d
       LEFT JOIN first_done fd ON fd.task_id = ft.task_id AND fd.finished <= days.d
      WHERE ft.task_id IS NOT NULL AND fd.task_id IS NULL
   GROUP BY days.d
   ORDER BY days.d`,
    [projectId, periodDays],
  )
  const rows = result.rows.map((r) => ({
    date: r.date,
    remaining: Number(r.remaining),
  }))
  return { rows, cov: coverage('task_status_history (open tasks/day)', periodDays, rows.length) }
}

