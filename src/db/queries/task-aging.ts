import { pool } from '../client.js'
import type { PoolClient } from 'pg'
import { withActor } from '../client.js'

// ---------------------------------------------------------------------------
// task-aging.ts — S17-BE-02 (#2551) DB layer for the aging/escalation cron.
//
// Security posture (Locksmith Tier-3 rulings: #2555 memory 3302, #2551
// thought 1144 / memory 3338):
//   - These functions are the SERVER-SIDE system path. They are never exposed
//     through handleUpdateTask / REST / MCP — the 'system' identity cannot be
//     derived from caller input (P3).
//   - Every status write runs inside withActor('system:<name>') so the
//     trg_tasks_lifecycle trigger attributes the transition correctly in
//     task_status_history and audit_log. Direct pool.query() here would log
//     'system:sql' and defeat the audit trail.
//   - Every transition re-asserts its from-state atomically in the WHERE
//     clause (same TOCTOU backstop as updateTask's expectedFromStatus).
//   - Auto-close skips tasks with an active external sync link — external
//     providers must observe closure through their own channel, not have a
//     done task drift silently against a live ClickUp counterpart.
// ---------------------------------------------------------------------------

/** A task with the fields the aging scan needs, including its project owner. */
export interface AgedTaskRow {
  id: number
  project_id: number
  title: string
  status: 'review' | 'pending-close'
  assignee_agent_slug: string | null
  reviewer_agent_slug: string | null
  project_owner_agent_slug: string
  metadata: Record<string, unknown>
  /** Whole days the task has sat in its current status (floor). */
  days_in_status: number
}

// ---------------------------------------------------------------------------
// findAgedTasks
//
// AGE CLOCK: task_status_history, NOT updated_at. The tasks_set_updated_at
// trigger (migration 002) bumps updated_at on EVERY touch — a notes edit
// would make a 30-day-stale task look fresh. The lifecycle trigger (024)
// appends a history row exactly when the status changes, so
// MAX(changed_at) IS "when the task entered its current status". Tasks with
// no history rows (direct inserts that were never transitioned) fall back
// to created_at as the honest floor.
//
// Uses idx_tasks_status_age (partial index on (status, updated_at) WHERE
// status IN ('review','pending-close') — migration 024) for candidate
// narrowing, then the history clock for precision.
//
// Externally-synced tasks are excluded here (not per-write) so a drift-y
// sync link can't make the cron oscillate: exclusion is a property of the
// SCAN.
// ---------------------------------------------------------------------------

const AGED_TASKS_SQL = `
  SELECT t.id,
         t.project_id,
         t.title,
         t.status::text AS status,
         t.assignee_agent_slug,
         t.reviewer_agent_slug,
         p.owner_agent_slug AS project_owner_agent_slug,
         t.metadata,
         FLOOR(EXTRACT(EPOCH FROM (NOW() - h.entered_status_at)) / 86400)::int AS days_in_status
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  JOIN LATERAL (
    SELECT COALESCE(MAX(h2.changed_at), t.created_at) AS entered_status_at
    FROM task_status_history h2
    WHERE h2.task_id = t.id
  ) h ON true
  LEFT JOIN external_task_links x ON x.task_id = t.id
  WHERE t.status IN ('review', 'pending-close')
    AND h.entered_status_at <= NOW() - ($1::int || ' days')::interval
    AND x.task_id IS NULL  -- external-sync guard: skip linked tasks
  ORDER BY h.entered_status_at ASC
  LIMIT $2::int
`

export async function findAgedTasks(
  minDaysInStatus: number,
  limit = 200,
  client: PoolClient | typeof pool = pool,
): Promise<AgedTaskRow[]> {
  const result = await client.query<AgedTaskRow>(AGED_TASKS_SQL, [minDaysInStatus, limit])
  return result.rows
}

// ---------------------------------------------------------------------------
// autoCloseTask — pending-close → done, resolution = 'auto_closed'.
//
// Dedicated server-side function (Locksmith ruling condition: NOT an
// updateTask param — resolution has no agent-writable path by design).
// Actor: 'system:auto_close' (distinct from 'system:aging' so audit readers
// can tell closures from rework reroutes at a glance).
// ---------------------------------------------------------------------------

export interface AutoCloseResult {
  closed: boolean
  /** undefined when closed=false — the WHERE guard rejected (race or already closed). */
  task?: {
    id: number
    project_id: number
    title: string
    status: string
    resolution: string | null
  }
}

export async function autoCloseTask(taskId: number): Promise<AutoCloseResult> {
  return withActor('system:auto_close', async (tx) => {
    const result = await tx.query<{
      id: number
      project_id: number
      title: string
      status: string
      resolution: string | null
    }>(
      `UPDATE tasks
       SET status = 'done',
           resolution = 'auto_closed',
           completed_at = NOW()
       WHERE id = $1
         AND status = 'pending-close'   -- atomic from-state guard (TOCTOU backstop)
       RETURNING id, project_id, title, status::text AS status, resolution`,
      [taskId],
    )
    const row = result.rows[0]
    if (!row) return { closed: false }
    return { closed: true, task: row }
  })
}

// ---------------------------------------------------------------------------
// rerouteUnassignedReviewToRework — review → rework, system role.
//
// Only reachable for unassigned tasks (assertSystemTransition precondition is
// mirrored in the WHERE clause: assignee IS NULL). Actor: 'system:aging'.
// The rework→wip hop afterwards is an owner path — the task re-enters the
// normal machine instead of disappearing into an intake queue (the reason the
// L10 review→triage proposal was denied).
// ---------------------------------------------------------------------------

export interface RerouteResult {
  rerouted: boolean
  task?: {
    id: number
    project_id: number
    title: string
    status: string
  }
}

export async function rerouteUnassignedReviewToRework(taskId: number): Promise<RerouteResult> {
  return withActor('system:aging', async (tx) => {
    const result = await tx.query<{
      id: number
      project_id: number
      title: string
      status: string
    }>(
      `UPDATE tasks
       SET status = 'rework'
       WHERE id = $1
         AND status = 'review'
         AND assignee_agent_slug IS NULL   -- structural precondition (ruling)
       RETURNING id, project_id, title, status::text AS status`,
      [taskId],
    )
    const row = result.rows[0]
    if (!row) return { rerouted: false }
    return { rerouted: true, task: row }
  })
}

// ---------------------------------------------------------------------------
// stampTaskMetadata — write one dedupe/audit key into tasks.metadata.
//
// The metadata param on updateTask REPLACES the whole object, and update_task
// input must never carry system stamps — so this is a dedicated jsonb merge
// (|| preserves all existing keys). Used for: aging_dedupe (per-action dedupe
// keys, Locksmith mandatory) and the recursion guard marker on follow-up
// tasks the cron itself creates.
// ---------------------------------------------------------------------------

export async function stampTaskMetadata(
  taskId: number,
  key: string,
  value: unknown,
  actor: 'system:aging' | 'system:auto_close',
  client: PoolClient | typeof pool = pool,
): Promise<void> {
  await client.query(
    `UPDATE tasks
     SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb)
     WHERE id = $1`,
    [taskId, key, JSON.stringify(value ?? null)],
  )
  void actor // actor is implicit: callers wrap in withActor where attribution matters
}
