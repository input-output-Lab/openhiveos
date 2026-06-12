import { pool } from '../client.js'
import type { Task, Sprint } from '../../types.js'

// ---------------------------------------------------------------------------
// ARCH-010 query contracts — Tasks and Sprints
// SEC-21: ownership always verified before writes; owner_agent_slug server-injected
// SEC-25: dynamic filter columns validated against ALLOWED_TASK_FILTERS
// ---------------------------------------------------------------------------

// Named constant — Locksmith auditability requirement (SEC-25)
export const ALLOWED_TASK_FILTERS = ['project_id', 'status', 'assignee_agent_slug'] as const
type TaskFilterKey = (typeof ALLOWED_TASK_FILTERS)[number]

// ---------------------------------------------------------------------------
// createTask
//
// SEC-21 — pre-flight ownership SELECT is explicit and separate from the INSERT.
// This is intentional and required: a subquery inside the INSERT is not auditable
// by Locksmith. The explicit SELECT makes the ownership check visible and testable.
// ---------------------------------------------------------------------------

export async function createTask(params: {
  project_id: number
  owner_agent_slug: string
  title: string
  description?: string
  assignee_agent_slug?: string
  github_pr_url?: string
  notes?: string
}): Promise<{ authorized: false } | { authorized: true; task: Task }> {
  // Pre-flight: verify the requesting agent owns this project
  const ownership = await pool.query<{ id: number }>(
    `SELECT id FROM projects WHERE id = $1 AND owner_agent_slug = $2`,
    [params.project_id, params.owner_agent_slug],
  )
  if (ownership.rowCount === 0) {
    return { authorized: false }
  }

  const result = await pool.query<Task>(
    `INSERT INTO tasks (project_id, title, description, assignee_agent_slug, github_pr_url, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, project_id, title, description, status, assignee_agent_slug,
               github_pr_url, notes, created_at, updated_at`,
    [
      params.project_id,
      params.title,
      params.description ?? null,
      params.assignee_agent_slug ?? null,
      params.github_pr_url ?? null,
      params.notes ?? null,
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error('[db] INSERT INTO tasks returned no row')
  return { authorized: true, task: row }
}

// ---------------------------------------------------------------------------
// updateTask
// SEC-21: ownership check embedded in WHERE — project must be owned by the
// requesting agent. Returns undefined if task does not exist or agent is
// not authorized.
//
// Model C (decided 2026-05-21): hybrid permission.
//   - Project owner: may update ALL fields on any task in their project.
//   - Assignee: may update the `status` field ONLY on tasks assigned to them,
//     regardless of project ownership.
//
// The allowAssigneePath flag is set by the handler when the request contains
// only status — no owner-only fields. The DB enforces the row gate; the
// handler enforces the field gate. Both must hold.
//
// assignee handling: pass unassign=true to clear the assignee to NULL.
// Pass a slug to set a new assignee. Pass neither to leave unchanged.
// ---------------------------------------------------------------------------

export async function updateTask(params: {
  task_id: number
  owner_agent_slug: string
  title?: string
  description?: string
  status?: string
  unassign?: boolean
  assignee_agent_slug?: string
  github_pr_url?: string
  notes?: string
  allowAssigneePath?: boolean
}): Promise<Task | undefined> {
  const result = await pool.query<Task>(
    `UPDATE tasks
     SET title               = COALESCE($3, title),
         description         = COALESCE($4, description),
         status              = COALESCE($5, status),
         assignee_agent_slug = CASE
           WHEN $6 THEN NULL
           ELSE COALESCE($7, assignee_agent_slug)
         END,
         github_pr_url       = COALESCE($8, github_pr_url),
         notes               = COALESCE($9, notes)
     WHERE id = $1
       AND (
         project_id IN (SELECT id FROM projects WHERE owner_agent_slug = $2)
         OR ($10 AND assignee_agent_slug = $2)
       )
     RETURNING id, project_id, title, description, status, assignee_agent_slug,
               github_pr_url, notes, created_at, updated_at`,
    [
      params.task_id,
      params.owner_agent_slug,
      params.title ?? null,
      params.description ?? null,
      params.status ?? null,
      params.unassign ?? false,
      params.assignee_agent_slug ?? null,
      params.github_pr_url ?? null,
      params.notes ?? null,
      // M1 (ARCH-023 / SEC-21): The DB WHERE clause does NOT gate status values
      // on the assignee path — it only gates which rows the assignee may touch.
      // An assignee who reaches this point can write any valid status. The
      // handler is the sole enforcement layer for status-value scope on the
      // assignee path. Any change to allowAssigneePath computation in the handler
      // is a Tier 3 security change and requires Locksmith review at PR-open.
      params.allowAssigneePath ?? false,
    ],
  )
  return result.rows[0]
}

// ---------------------------------------------------------------------------
// queryTasks
// SEC-25: only ALLOWED_TASK_FILTERS keys are accepted.
// Scoped to the agent's own projects for data isolation — callers cannot
// query tasks from projects they do not own by guessing a project_id.
// ---------------------------------------------------------------------------

export async function queryTasks(
  filters: Partial<Record<TaskFilterKey, string | number>>,
  ownerAgentSlug: string,
): Promise<Task[]> {
  const conditions: string[] = [
    // Implicit scope guard — always restricts to projects owned by the calling agent
    `project_id IN (SELECT id FROM projects WHERE owner_agent_slug = $1)`,
  ]
  const values: unknown[] = [ownerAgentSlug]
  let idx = 2

  for (const key of ALLOWED_TASK_FILTERS) {
    if (filters[key] !== undefined) {
      conditions.push(`${key} = $${String(idx++)}`)
      values.push(filters[key])
    }
  }

  const result = await pool.query<Task>(
    `SELECT id, project_id, title, description, status, assignee_agent_slug,
            github_pr_url, notes, created_at, updated_at
     FROM tasks
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC`,
    values,
  )
  return result.rows
}

// ---------------------------------------------------------------------------
// advanceSprint
//
// Inserts a new sprint row with sprint_number = MAX(sprint_number) + 1.
// The UNIQUE(project_id, sprint_number) constraint is the race guard.
// PG error 23505 (unique_violation) means a concurrent advance_sprint call
// won the race — the caller should retry. This is returned as a structured
// error, not a thrown exception.
//
// SEC-21: ownership verified in the pre-flight SELECT before INSERT.
// SEC-23: idempotency guard is the UNIQUE constraint — not application logic.
// ---------------------------------------------------------------------------

export type AdvanceSprintResult =
  | { kind: 'unauthorized' }
  | { kind: 'conflict' }
  | { kind: 'success'; sprint: Sprint }

export async function advanceSprint(params: {
  project_id: number
  owner_agent_slug: string
  sprint_goal?: string
}): Promise<AdvanceSprintResult> {
  // Pre-flight: verify the requesting agent owns this project
  const ownership = await pool.query<{ id: number }>(
    `SELECT id FROM projects WHERE id = $1 AND owner_agent_slug = $2`,
    [params.project_id, params.owner_agent_slug],
  )
  if (ownership.rowCount === 0) {
    return { kind: 'unauthorized' }
  }

  try {
    const result = await pool.query<Sprint>(
      `INSERT INTO sprints (project_id, sprint_number, sprint_goal)
       VALUES (
         $1,
         (SELECT COALESCE(MAX(sprint_number), 0) + 1 FROM sprints WHERE project_id = $1),
         $2
       )
       RETURNING id, project_id, sprint_number, sprint_goal, started_at, created_at`,
      [params.project_id, params.sprint_goal ?? null],
    )
    const row = result.rows[0]
    if (!row) throw new Error('[db] INSERT INTO sprints returned no row')
    return { kind: 'success', sprint: row }
  } catch (err: unknown) {
    // PG error 23505: unique_violation — concurrent advance_sprint won the race
    if (
      err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    ) {
      return { kind: 'conflict' }
    }
    throw err
  }
}
