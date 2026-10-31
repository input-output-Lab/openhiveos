import type { AgedTaskRow } from '../db/queries/task-aging.js'

// ---------------------------------------------------------------------------
// task-aging.ts — S17-BE-02 (#2551) pure aging/escalation decisions.
//
// Decisions live here as pure functions (injectable clock) so every threshold
// and dedupe rule is unit-testable without a DB. Side effects (transitions,
// follow-up task creation, metadata stamps) live in the handler — this module
// never touches the pool.
//
// Policy (L10 2026-10-29, item 13; enforcement per Locksmith ruling
// thought 1144 / memory 3338):
//   review        7d → ping reviewer        (follow-up task assigned to reviewer)
//   review       14d → escalate             (follow-up task assigned to project owner)
//   review ≥14d + unassigned → rework       (system transition, review→rework row)
//   pending-close 30d → done, resolution='auto_closed'  (system transition)
// ---------------------------------------------------------------------------

export const PING_REVIEWER_DAYS = 7
export const ESCALATE_DAYS = 14
export const AUTOCLOSE_PENDING_CLOSE_DAYS = 30
/** Keep in sync with REWORK_REROUTE_DAYS in task-transitions.ts (asserted in tests). */
export const REWORK_REROUTE_DAYS = 14

// ---------------------------------------------------------------------------
// Dedupe keys (Locksmith mandatory): one metadata stamp per action per task.
// The stamp value is an ISO timestamp of when the action fired; the presence
// of the key is the dedupe signal. A task can receive each action AT MOST
// ONCE per status episode — if it leaves review and comes back, a fresh
// episode is legitimate (the stamp is cleared by statusEpisodeKey below).
// ---------------------------------------------------------------------------
export const DEDUPE_KEYS = {
  pingReviewer: 'aging_ping_7d',
  escalate: 'aging_escalate_14d',
  autoClose: 'aging_autoclose_30d',
  reworkReroute: 'aging_rework_14d',
} as const

export type DedupeKey = (typeof DEDUPE_KEYS)[keyof typeof DEDUPE_KEYS]

/**
 * Recursion guard (Locksmith mandatory): a task carrying the aging_followup
 * marker was created BY this cron. The cron must never age, ping, escalate,
 * auto-close, or reroute its own output — that would cascade: an unreviewed
 * ping follow-up would spawn its own ping follow-up.
 *
 * EXACT-KEY matching — deliberately NOT a prefix match: the dedupe stamps
 * (aging_ping_7d etc.) also start with 'aging_' but mark actions on SOURCE
 * tasks. Prefix matching would exclude every pinged task from future scans,
 * making escalation unreachable (integration-test-caught bug).
 */
export const AGING_FOLLOWUP_KEY = 'aging_followup'

export function isAgingFollowUp(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata) return false
  return metadata[AGING_FOLLOWUP_KEY] !== undefined
}

// ---------------------------------------------------------------------------
// Classification — one decision per candidate task.
// ---------------------------------------------------------------------------

export type AgingAction =
  | 'none' // too young, or already acted on (dedupe)
  | 'ping_reviewer'
  | 'escalate_owner'
  | 'reroute_rework'
  | 'auto_close'

export interface AgingDecision {
  action: AgingAction
  /** metadata key to stamp when the action executes (null for 'none'). */
  dedupeKey: DedupeKey | null
}

/**
 * daysInStatus — whole days (floor) the task has been in its current status,
 * computed from the injection point so tests control the clock. The DB layer
 * independently computes the same floor in SQL; both must use floor semantics
 * (a task at 6.9 days is NOT at 7).
 */
export function daysInStatus(statusChangedAt: Date, now: Date): number {
  const msPerDay = 86_400_000
  return Math.max(0, Math.floor((now.getTime() - statusChangedAt.getTime()) / msPerDay))
}

/**
 * classifyAgedTask — the single decision point for one candidate row.
 *
 * Preconditions the caller (handler/DB scan) guarantees:
 *   - task.status is 'review' or 'pending-close'
 *   - task has sat in that status ≥ the relevant minimum (the scan query
 *     filters), so thresholds here are re-checks, not the only gate
 *   - task is not an aging follow-up (recursion guard ran in the scan)
 *
 * Dedupe: each action fires once per status episode. The metadata stamp
 * records WHICH episode it belongs to; a task that cycles statuses gets a
 * fresh episode (and fresh pings) — stamps never suppress a different episode.
 */
export function classifyAgedTask(
  task: Pick<AgedTaskRow, 'status' | 'assignee_agent_slug' | 'metadata' | 'days_in_status'>,
): AgingDecision {
  // Dedupe read: stamp present for the CURRENT episode → already acted.
  // (Handler stamps carry {episode, at}; a bare string/number stamp from an
  // older format counts as "acted" — fail closed toward not re-acting.)
  const actedThisEpisode = (key: DedupeKey): boolean => {
    const stamp: unknown = task.metadata[key]
    if (stamp === undefined || stamp === null) return false
    if (typeof stamp === 'object') {
      const episode = (stamp as { episode?: unknown }).episode
      return typeof episode === 'string' && episode === statusEpisode(task.status)
    }
    return true
  }

  if (task.status === 'pending-close') {
    if (task.days_in_status < AUTOCLOSE_PENDING_CLOSE_DAYS) return { action: 'none', dedupeKey: null }
    if (actedThisEpisode(DEDUPE_KEYS.autoClose)) return { action: 'none', dedupeKey: null }
    return { action: 'auto_close', dedupeKey: DEDUPE_KEYS.autoClose }
  }

  // status === 'review'
  if (task.assignee_agent_slug === null && task.days_in_status >= REWORK_REROUTE_DAYS) {
    if (actedThisEpisode(DEDUPE_KEYS.reworkReroute)) return { action: 'none', dedupeKey: null }
    return { action: 'reroute_rework', dedupeKey: DEDUPE_KEYS.reworkReroute }
  }

  if (task.days_in_status >= ESCALATE_DAYS && !actedThisEpisode(DEDUPE_KEYS.escalate)) {
    return { action: 'escalate_owner', dedupeKey: DEDUPE_KEYS.escalate }
  }

  // Escalation already acted this episode: the ping stage is superseded —
  // pinging again at 20d would nag the reviewer on top of an open escalation.
  if (actedThisEpisode(DEDUPE_KEYS.escalate)) {
    return { action: 'none', dedupeKey: null }
  }

  if (task.days_in_status >= PING_REVIEWER_DAYS && !actedThisEpisode(DEDUPE_KEYS.pingReviewer)) {
    return { action: 'ping_reviewer', dedupeKey: DEDUPE_KEYS.pingReviewer }
  }

  return { action: 'none', dedupeKey: null }
}

/**
 * statusEpisode — a stable episode identifier for dedupe stamps.
 * Review/pending-close episodes are identified by status name alone: a task
 * that re-enters review gets a NEW stamp value ({episode:'review', at: now})
 * which does NOT match the old one only if the old stamp is episode-tagged.
 * To keep re-entry distinct we include the entry date: the handler stamps
 * {episode, at} where episode = `${status}:${entryDate}`. Here we expose the
 * status-half used in that composition; the DB history provides entry dates
 * (handler composes the full key from task_status_history).
 */
export function statusEpisode(status: string): string {
  return status
}

/**
 * filterAgingFollowUps — the recursion guard applied to a scan result set.
 * Exported for direct unit testing of the filter semantics.
 */
export function filterAgingFollowUps(tasks: AgedTaskRow[]): AgedTaskRow[] {
  return tasks.filter((task) => !isAgingFollowUp(task.metadata))
}

// ---------------------------------------------------------------------------
// Follow-up task factory — pure: no DB, no pool. The handler persists these
// through the normal audited createTask path.
// ---------------------------------------------------------------------------

export interface FollowUpTaskSpec {
  project_id: number
  title: string
  description: string
  assignee_agent_slug: string
  estimated_hours: number
  billing_low: number
  billing_high: number
  estimate_confidence: 'low' | 'medium' | 'high'
  metadata: Record<string, unknown>
}

/**
 * buildFollowUpSpec — the ping/escalate side channel (Locksmith-approved:
 * follow-up tasks instead of a Slack dependency).
 *
 * 7d ping  → assigned to the RESOLVED reviewer (task.reviewer_agent_slug if
 *            set, else the project owner — fail-closed default).
 * 14d escalation → assigned to the project owner; the owner (Elizabeth on
 *            project 70) sees it on their board and triages upstream.
 *
 * Recursion guard marker: metadata.aging_followup = {kind, source_task_id} —
 * the scan filter (isAgingFollowUp) excludes these from all future aging.
 *
 * Follow-ups are real tasks: hour-estimation discipline applies even for
 * coordination nags — small, honest estimates (0.1h floor for a ping).
 */
export function buildFollowUpSpec(params: {
  sourceTask: Pick<AgedTaskRow, 'id' | 'project_id' | 'title' | 'days_in_status'>
  kind: 'ping_reviewer' | 'escalate_owner'
  assigneeAgentSlug: string
  now: Date
}): FollowUpTaskSpec {
  const { sourceTask, kind, assigneeAgentSlug, now } = params
  const sourceId = String(sourceTask.id)
  const agedDays = String(sourceTask.days_in_status)

  const kindLabel =
    kind === 'ping_reviewer'
      ? `Review pending ${agedDays}d — ping`
      : `Review pending ${agedDays}d — ESCALATION`

  return {
    project_id: sourceTask.project_id,
    title: `[aging] #${sourceId} ${kindLabel}: ${sourceTask.title}`.slice(0, 500),
    description:
      `Automated aging follow-up (task #2551 policy). Source task #${sourceId} has sat in ` +
      `review for ${agedDays} days. ` +
      (kind === 'ping_reviewer'
        ? 'Please review it or move it to rework.'
        : 'Escalation: review is stalled — reassign a reviewer, rework the task, or close the queue behind it.'),
    assignee_agent_slug: assigneeAgentSlug,
    estimated_hours: 0.1,
    billing_low: 0.1,
    billing_high: 0.5,
    estimate_confidence: 'low',
    metadata: {
      aging_followup: { kind, source_task_id: sourceTask.id, created_at: now.toISOString() },
    },
  }
}
