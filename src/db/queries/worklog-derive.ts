import type { PoolClient } from 'pg'

// ---------------------------------------------------------------------------
// worklog-derive.ts — S17-BE-04 (#2552) DB layer for the nightly worklog job.
//
// The derivation itself lives in v_session_active_time (migration 027) —
// stated once in SQL. This module reads the view, upserts worklogs with
// withActor attribution, and enforces idempotency via the partial unique
// constraint (one auto row per task/agent/day).
//
// Security posture (matches #2551 pattern):
//   - Server-side system path only; never exposed via update_task/REST/MCP.
//   - Writes run inside withActor('system:worklog') so audit trails name the
//     automation that wrote them.
//   - ON CONFLICT DO UPDATE keeps the row fresh if the view's numbers change
//     on re-derivation (late-arriving rows in the same session) — the row is
//     still one-per-day (idempotent), just corrected.
// ---------------------------------------------------------------------------

/** One row of v_session_active_time. */
export interface SessionActiveRow {
  session_id: string
  task_id: number
  agent_slug: string
  worked_on: string // DATE as YYYY-MM-DD
  active_minutes: string // NUMERIC comes back as string from pg
  automation_minutes: string
  automation_calls: number
  total_calls: number
}

/**
 * findSessionActivity — read the derivation view for one UTC day.
 *
 * `day` IS the target day: the window is [day 00:00, day+1 00:00) UTC.
 * The nightly handler passes yesterday; sessions are attributed to their
 * START day (worked_on = first-call day), so a session started 23:40 that
 * ran past midnight derives on the earlier day and won't be seen again.
 */
export async function findSessionActivity(
  day: Date,
  client: PoolClient | { query: PoolClient['query'] },
): Promise<SessionActiveRow[]> {
  const result = await client.query<SessionActiveRow>(
    `SELECT session_id, task_id::text::bigint AS task_id, agent_slug,
            TO_CHAR(worked_on, 'YYYY-MM-DD') AS worked_on,
            active_minutes::text AS active_minutes,
            automation_minutes::text AS automation_minutes,
            automation_calls, total_calls
     FROM v_session_active_time
     WHERE worked_on >= $1::date
       AND worked_on < $1::date + INTERVAL '1 day'
       AND active_minutes > 0`,
    [day.toISOString().slice(0, 10)],
  )
  return result.rows
}

export interface UpsertResult {
  written: number
  /** Task ids touched this run (for the run summary log). */
  taskIds: number[]
}

/**
 * upsertAutoWorklog — write one derived row. Idempotent per the partial
 * unique constraint uq_task_worklogs_auto (task_id, agent_slug, worked_on).
 * Caller wraps in withActor('system:worklog').
 */
export async function upsertAutoWorklog(
  row: SessionActiveRow,
  tx: PoolClient,
): Promise<boolean> {
  const result = await tx.query<{ id: number }>(
    `INSERT INTO task_worklogs (task_id, agent_slug, source, minutes, worked_on, session_id, metadata)
     VALUES ($1, $2, 'auto', $3, $4::date, $5, $6::jsonb)
     ON CONFLICT (task_id, agent_slug, worked_on) WHERE source = 'auto'
     DO UPDATE SET
       minutes = EXCLUDED.minutes,
       session_id = EXCLUDED.session_id,
       metadata = EXCLUDED.metadata
     RETURNING id`,
    [
      row.task_id,
      row.agent_slug,
      row.active_minutes,
      row.worked_on,
      row.session_id,
      JSON.stringify({
        derived_by: 'worklog_derive',
        automation_minutes: Number(row.automation_minutes),
        automation_calls: row.automation_calls,
        total_calls: row.total_calls,
        gap_threshold_minutes: 15,
      }),
    ],
  )
  return result.rowCount === 1
}
