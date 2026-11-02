import { z } from 'zod'
import { withActor } from '../db/client.js'
import { getTaskForActor } from '../db/queries/tasks.js'
import {
  insertHumanWorklog,
  WORKLOG_CATEGORIES,
  type WorklogRow,
} from '../db/queries/worklogs.js'

// ---------------------------------------------------------------------------
// log_time — S17-BE-03 (#2557) manual time entry.
//
// Who may log time: the task's assignee or the owner of the task's project.
// Reviewers and approvers may fetch a task (getTaskForActor) but may not log
// time on it. Not-found and not-authorized both return the same opaque error
// so a caller cannot probe for task existence.
//
// Input rules (C3):
//   - minutes: positive, fractional allowed, max 1440 per entry
//   - worked_on: YYYY-MM-DD, default today (UTC), not in the future, at most
//     90 days back
//   - no session_id (manual entries are not tied to tool sessions)
//   - note: max 500 chars
//
// Entries are append-only from this tool. Auto rows (source='auto') are never
// written here. Correction flow is not implemented in this change.
// ---------------------------------------------------------------------------

const MAX_MINUTES_PER_ENTRY = 1440
const MAX_BACKDATE_DAYS = 90
const MS_PER_DAY = 86_400_000

/** MCP-facing shape. Kept a plain ZodObject so `.shape` is available. */
export const logTimeSchema = z
  .object({
    task_id: z.number().int().positive(),
    minutes: z.number().positive().max(MAX_MINUTES_PER_ENTRY),
    category: z.enum(WORKLOG_CATEGORIES),
    billable: z.boolean().optional(),
    worked_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'worked_on must be YYYY-MM-DD')
      .optional(),
    note: z.string().max(500).optional(),
  })
  .strict()

export type LogTimeInput = z.infer<typeof logTimeSchema>

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * validateWorkedOn — calendar-valid, not future, within the backdate window.
 * Throws on violation. `now` is injectable for tests.
 */
export function validateWorkedOn(workedOn: string, now: Date): void {
  const parsed = new Date(`${workedOn}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || utcDay(parsed) !== workedOn) {
    throw new Error('worked_on is not a valid calendar date')
  }
  const todayMs = new Date(`${utcDay(now)}T00:00:00Z`).getTime()
  const dayMs = parsed.getTime()
  if (dayMs > todayMs) {
    throw new Error('worked_on cannot be in the future')
  }
  if (todayMs - dayMs > MAX_BACKDATE_DAYS * MS_PER_DAY) {
    throw new Error(`worked_on cannot be more than ${String(MAX_BACKDATE_DAYS)} days in the past`)
  }
}

export type LogTimeResult =
  | { worklog: WorklogRow }
  | { error: 'not_found_or_unauthorized'; message: string }

/**
 * handleLogTime — validate, authorize (assignee or project owner), append.
 * Write runs inside withActor(agentSlug) so the audit trail names the caller.
 */
export async function handleLogTime(
  input: unknown,
  agentSlug: string,
  now: Date = new Date(),
): Promise<LogTimeResult> {
  const parsed = logTimeSchema.parse(input)
  const workedOn = parsed.worked_on ?? utcDay(now)
  validateWorkedOn(workedOn, now)

  const task = await getTaskForActor(parsed.task_id, agentSlug)
  const canLog =
    task !== undefined &&
    (task.assignee_agent_slug === agentSlug || task.project_owner_agent_slug === agentSlug)

  if (!canLog) {
    return {
      error: 'not_found_or_unauthorized',
      message: 'Task not found or you are not authorized to log time on it.',
    }
  }

  const worklog = await withActor(agentSlug, (tx) =>
    insertHumanWorklog(tx, {
      task_id: parsed.task_id,
      agent_slug: agentSlug,
      actor_type: 'agent',
      minutes: parsed.minutes,
      worked_on: workedOn,
      category: parsed.category,
      billable: parsed.billable ?? true,
      note: parsed.note ?? null,
    }),
  )

  return { worklog }
}
