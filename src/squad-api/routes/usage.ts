import { Router } from 'express'
import { withReaderRole } from '../db.js'

// ---------------------------------------------------------------------------
// Usage analytics router — ARCH-015
//
// Three GET endpoints reading LLM cost data from analytical views.
// All queries run under openhiveos_reader via withReaderRole() (SEC-A5).
// Agent bearer auth is enforced upstream by app.use('/api', authMiddleware).
//
// Routes:
//   GET /api/usage/agents              — all agents, monthly cost aggregates
//   GET /api/usage/agents/:name        — single agent, monthly detail
//   GET /api/usage/tasks/:id           — task-level cost breakdown
//
// Data source: v_cost_by_agent_month, v_cost_by_task (005_llm_usage.sql).
// Returns empty arrays when llm_usage has no rows (feature dark until Bridge deploys).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Row types — mirror the view column definitions in 005_llm_usage.sql
// ---------------------------------------------------------------------------

interface AgentMonthRow {
  agent_slug:        string
  month:             Date
  session_count:     string // PostgreSQL COUNT returns string via node-postgres
  prompt_tokens:     string
  completion_tokens: string
  cost_usd:          string
}

interface TaskRow {
  task_id:       string
  task_title:    string
  project_name:  string
  assigned_agent: string | null
  request_count:  string
  total_tokens:   string
  cost_usd:       string
  first_activity: Date | null
  last_activity:  Date | null
}

// ---------------------------------------------------------------------------
// Fixed SQL strings — no user input is ever interpolated into these strings.
// User-supplied values are passed as parameterized arguments ($1, $2, etc.)
// via the pg driver. OWASP A03 clean.
// ---------------------------------------------------------------------------

// All months for all agents, ordered by month desc then cost desc
const AGENTS_ALL_SQL = `
  SELECT
    agent_slug,
    month,
    session_count,
    prompt_tokens,
    completion_tokens,
    cost_usd
  FROM v_cost_by_agent_month
  WHERE month >= date_trunc('month', NOW()) - ($1 - 1) * INTERVAL '1 month'
  ORDER BY month DESC, cost_usd DESC
`

// Months for a single agent (agent_slug = $1, month window = $2)
const AGENT_DETAIL_SQL = `
  SELECT
    agent_slug,
    month,
    session_count,
    prompt_tokens,
    completion_tokens,
    cost_usd
  FROM v_cost_by_agent_month
  WHERE agent_slug = $1
    AND month >= date_trunc('month', NOW()) - ($2 - 1) * INTERVAL '1 month'
  ORDER BY month DESC
`

// Task detail (task_id = $1)
const TASK_DETAIL_SQL = `
  SELECT
    task_id,
    task_title,
    project_name,
    assigned_agent,
    request_count,
    total_tokens,
    cost_usd,
    first_activity,
    last_activity
  FROM v_cost_by_task
  WHERE task_id = $1
`

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const usageRouter = Router()

/**
 * GET /api/usage/agents?months=N
 *
 * All agents — monthly cost aggregates for the last N months (default 6, max 24).
 */
usageRouter.get('/agents', async (req, res) => {
  const rawMonths = req.query['months']
  const months = Math.min(
    Math.max(1, parseInt(typeof rawMonths === 'string' ? rawMonths : '6', 10) || 6),
    24,
  )

  const rows = await withReaderRole<AgentMonthRow[]>(async (client) => {
    const result = await client.query<AgentMonthRow>(AGENTS_ALL_SQL, [months])
    return result.rows
  })

  res.json({ months, data: rows })
})

/**
 * GET /api/usage/agents/:name
 *
 * Single agent — monthly cost detail for the last 12 months.
 * Returns 404 if no usage data exists for that agent slug.
 */
usageRouter.get('/agents/:name', async (req, res) => {
  const agentSlug = req.params['name']

  // Validate: slug must be non-empty and not start with '--'
  if (!agentSlug || agentSlug.startsWith('-')) {
    res.status(400).json({ error: 'Invalid agent name' })
    return
  }

  const rows = await withReaderRole<AgentMonthRow[]>(async (client) => {
    const result = await client.query<AgentMonthRow>(AGENT_DETAIL_SQL, [agentSlug, 12])
    return result.rows
  })

  if (rows.length === 0) {
    res.status(404).json({ error: `No usage data found for agent "${agentSlug}"` })
    return
  }

  res.json({ agent_slug: agentSlug, data: rows })
})

/**
 * GET /api/usage/tasks/:id
 *
 * Cost breakdown for a single task. Returns 404 if the task has no usage records.
 */
usageRouter.get('/tasks/:id', async (req, res) => {
  const rawId = req.params['id']
  const taskId = parseInt(rawId ?? '', 10)

  if (!Number.isInteger(taskId) || taskId <= 0) {
    res.status(400).json({ error: 'Task ID must be a positive integer' })
    return
  }

  const rows = await withReaderRole<TaskRow[]>(async (client) => {
    const result = await client.query<TaskRow>(TASK_DETAIL_SQL, [taskId])
    return result.rows
  })

  if (rows.length === 0) {
    res.status(404).json({ error: `No usage data found for task ${taskId}` })
    return
  }

  res.json(rows[0])
})
