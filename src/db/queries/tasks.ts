import { pool } from '../client.js'
import type { Task, Sprint, TaskStatus } from '../../types.js'

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
  metadata?: Record<string, unknown>
  estimated_hours: number
  billing_low: number
  billing_high: number
  estimate_confidence: 'low' | 'medium' | 'high'
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
    `INSERT INTO tasks (project_id, title, description, assignee_agent_slug, github_pr_url, notes, metadata,
                        estimated_hours, billing_low, billing_high, estimate_confidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, project_id, title, description, status, assignee_agent_slug,
               github_pr_url, notes, metadata, estimated_hours, billing_low,
               billing_high, estimate_confidence, created_at, updated_at`,
    [
      params.project_id,
      params.title,
      params.description ?? null,
      params.assignee_agent_slug ?? null,
      params.github_pr_url ?? null,
      params.notes ?? null,
      JSON.stringify(params.metadata ?? {}),
      params.estimated_hours,
      params.billing_low,
      params.billing_high,
      params.estimate_confidence,
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

// ---------------------------------------------------------------------------
// getTaskForActor
// S17-BE-01 (#2555): single-task fetch scoped to the actor's visibility
// (owner of the project OR assignee of the task). Used by the transition
// gate in handleUpdateTask to resolve the caller's role BEFORE mutating.
// Joins projects for the owner slug — the transition module needs it for
// fail-closed reviewer/approver resolution.
// ---------------------------------------------------------------------------

export async function getTaskForActor(
  task_id: number,
  agentSlug: string,
): Promise<
  | undefined
  | {
      id: number
      status: TaskStatus
      assignee_agent_slug: string | null
      reviewer_agent_slug: string | null
      project_id: number
      project_owner_agent_slug: string
      metadata: Record<string, unknown>
    }
> {
  const result = await pool.query<{
    id: number
    status: TaskStatus
    assignee_agent_slug: string | null
    reviewer_agent_slug: string | null
    project_id: number
    project_owner_agent_slug: string
    metadata: Record<string, unknown>
  }>(
    `SELECT t.id, t.status, t.assignee_agent_slug, t.reviewer_agent_slug,
            t.project_id, p.owner_agent_slug AS project_owner_agent_slug, t.metadata
     FROM tasks t
     JOIN projects p ON p.id = t.project_id
     WHERE t.id = $1
       AND (p.owner_agent_slug = $2 OR t.assignee_agent_slug = $2)`,
    [task_id, agentSlug],
  )
  return result.rows[0]
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
// S17-BE-01 (#2555): expectedFromStatus — ATOMIC from-state guard. The handler
// resolves the transition against the fetched status, but fetch-then-update
// alone has a TOCTOU race (two concurrent reviewers both read 'review'). This
// param is re-asserted in the UPDATE's WHERE so a concurrent status change
// makes the second writer match 0 rows. Set only for status transitions; a
// NULL leaves the guard inactive (non-status writes don't race the machine).
//
// assignee handling: pass unassign=true to clear the assignee to NULL.
// Pass a slug to set a new assignee. Pass neither to leave unchanged.
// ---------------------------------------------------------------------------

export async function updateTask(params: {
  task_id: number
  owner_agent_slug: string
  project_id?: number
  title?: string
  description?: string
  status?: string
  expectedFromStatus?: string
  unassign?: boolean
  assignee_agent_slug?: string
  github_pr_url?: string
  notes?: string
  metadata?: Record<string, unknown>
  estimated_hours?: number
  billing_low?: number
  billing_high?: number
  estimate_confidence?: 'low' | 'medium' | 'high'
  allowAssigneePath?: boolean
}): Promise<Task | undefined> {
  const result = await pool.query<Task>(
    `UPDATE tasks
     SET project_id          = CASE
           WHEN $3::INTEGER IS NOT NULL AND EXISTS(
             SELECT 1 FROM projects WHERE id = $3::INTEGER AND owner_agent_slug = $2
           ) THEN $3::INTEGER
           WHEN $3::INTEGER IS NOT NULL THEN project_id  -- target project not owned: no-op keeps row, caught by RETURNING check
           ELSE project_id
         END,
         title               = COALESCE($4, title),
         description         = COALESCE($5, description),
         status              = COALESCE($6, status),
         assignee_agent_slug = CASE
           WHEN $7 THEN NULL
           ELSE COALESCE($8, assignee_agent_slug)
         END,
         github_pr_url       = COALESCE($9, github_pr_url),
         notes               = COALESCE($10, notes),
         metadata            = COALESCE($12::jsonb, metadata),
         estimated_hours     = COALESCE($13, estimated_hours),
         billing_low         = COALESCE($14, billing_low),
         billing_high        = COALESCE($15, billing_high),
         estimate_confidence = COALESCE($16, estimate_confidence)
     WHERE id = $1
       AND ($17::TEXT IS NULL OR status = $17::TEXT)  -- #2555 atomic from-state guard
       AND (
         project_id IN (SELECT id FROM projects WHERE owner_agent_slug = $2)
         OR ($11 AND assignee_agent_slug = $2)
       )
     RETURNING id, project_id, title, description, status, assignee_agent_slug,
               github_pr_url, notes, metadata, estimated_hours, billing_low,
               billing_high, estimate_confidence, created_at, updated_at`,
    [
      params.task_id,
      params.owner_agent_slug,
      params.project_id ?? null,
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
      // handler enforces the transition matrix (S17-BE-01 #2555); this WHERE's
      // expectedFromStatus re-assertion is the ATOMIC backstop against TOCTOU.
      // Both layers are Tier 3 — Locksmith review at PR-open.
      params.allowAssigneePath ?? false,
      params.metadata !== undefined ? JSON.stringify(params.metadata) : null,
      params.estimated_hours ?? null,
      params.billing_low ?? null,
      params.billing_high ?? null,
      params.estimate_confidence ?? null,
      params.expectedFromStatus ?? null,
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
  metadata_filter?: Record<string, unknown>,
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

  // JSONB containment filter — each key/value pair is a separate @> condition.
  // Pattern mirrors src/db/queries/memory.ts searchMemory() (SEC-25 compliant:
  // no dynamic column names, only parameterised JSONB containment checks).
  if (metadata_filter) {
    for (const [key, value] of Object.entries(metadata_filter)) {
      conditions.push(`metadata @> $${String(idx++)}::jsonb`)
      values.push(JSON.stringify({ [key]: value }))
    }
  }

  const result = await pool.query<Task>(
    `SELECT id, project_id, title, description, status, assignee_agent_slug,
            github_pr_url, notes, metadata, created_at, updated_at
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
