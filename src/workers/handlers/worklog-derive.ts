/**
 * src/workers/handlers/worklog-derive.ts
 *
 * Cron handler for 'worklog_derive' — S17-BE-04 (#2552).
 *
 * Nightly job: derive agent active time from tool_invocations sessions and
 * write source='auto' worklogs.
 *
 * Derivation (documented in migration 027's view + src/utilities/worklog-derive.ts):
 *   - Order tool_invocations per (session_id, task_id, agent_slug) by called_at.
 *   - Sum consecutive gaps ≤ 15 min as active time, plus the final call's own
 *     duration_ms. Gaps > 15 min are "away" — contribute nothing.
 *   - actor_type='automation' rows are EXCLUDED from effort minutes but kept
 *     in the row's metadata ledger (L10 policy: tag, don't lose).
 *   - One auto worklog per (task_id, agent_slug, worked_on) — idempotent via
 *     the partial unique constraint; re-runs correct, never duplicate.
 *
 * Security: server-side system path (withActor 'system:worklog'); never
 * reachable via update_task input (same P3 posture as #2551).
 *
 * Payload: { day?: string } — defaults to yesterday (UTC). Payload is
 * operator override only; the production schedule runs without it.
 */
import type { Pool } from 'pg'
import type { RegisteredToolName } from '../../utilities/tool-registry.js'
import { withActor } from '../../db/client.js'
import { findSessionActivity, upsertAutoWorklog } from '../../db/queries/worklog-derive.js'
import { ACTIVE_GAP_THRESHOLD_MINUTES } from '../../utilities/worklog-derive.js'

/** Safety cap: max worklog upserts per run (a backlog day can be large). */
const MAX_UPSERTS_PER_RUN = 500

function parseDayParam(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function yesterdayUtc(now: Date): Date {
  const d = new Date(now)
  d.setUTCDate(d.getUTCDate() - 1)
  return d
}

export async function worklogDeriveHandler(
  _toolName: RegisteredToolName,
  payload: Record<string, unknown> | null,
  pool: Pool,
): Promise<void> {
  const now = new Date()
  const day = parseDayParam(payload?.['day']) ?? yesterdayUtc(now)

  const rows = await findSessionActivity(day, pool)

  if (rows.length === 0) {
    console.log(`[worklog-derive] no session activity for ${day.toISOString().slice(0, 10)} — nothing to derive`)
    return
  }

  let written = 0
  let skipped = 0
  const taskIds = new Set<number>()

  // One transaction per run: a partially-derived day is worse than a failed
  // day (the cron retries the whole run on the next tick).
  await withActor('system:worklog', async (tx) => {
    for (const row of rows) {
      if (written >= MAX_UPSERTS_PER_RUN) {
        skipped++
        continue
      }
      const ok = await upsertAutoWorklog(row, tx)
      if (ok) {
        written++
        taskIds.add(row.task_id)
      } else {
        skipped++
      }
    }
  })

  console.log(
    `[worklog-derive] day=${day.toISOString().slice(0, 10)} scanned=${String(rows.length)} ` +
      `written=${String(written)} skipped=${String(skipped)} tasks=${String(taskIds.size)} ` +
      `gap_threshold=${String(ACTIVE_GAP_THRESHOLD_MINUTES)}min`,
  )
}

// Re-exported for tests and operator tooling.
export { ACTIVE_GAP_THRESHOLD_MINUTES, MAX_UPSERTS_PER_RUN }
