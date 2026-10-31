// ---------------------------------------------------------------------------
// worklog-derive.ts — S17-BE-04 (#2552) pure active-time derivation.
//
// Decisions live here as pure functions so the 15-minute gap threshold,
// automation exclusion, and day bucketing are unit-testable without a DB.
// The same semantics exist in SQL (v_session_active_time, migration 027) —
// the view is the production source of truth for scanning; these functions
// are the test oracle and the fallback path. If one changes, the other must
// change in the same PR (asserted by integration tests).
// ---------------------------------------------------------------------------

/**
 * ACTIVE_GAP_THRESHOLD_MINUTES — L10 2026-10-29 item 15, documented per AC.
 * Two consecutive tool invocations in the same session belong to one
 * continuous work burst iff the gap between them is ≤ 15 minutes. Longer
 * gaps are "away" time and contribute nothing.
 *
 * Mirrored in migrations/027_task_worklogs.sql (v_session_active_time).
 */
export const ACTIVE_GAP_THRESHOLD_MINUTES = 15

/** One tool invocation, reduced to what the derivation needs. */
export interface Invocation {
  agent_slug: string
  actor_type: string | null
  called_at: Date
  duration_ms: number | null
}

/** A derived per-session/task/agent/day worklog candidate. */
export interface WorklogCandidate {
  agent_slug: string
  worked_on: string // ISO date (UTC), the day the session STARTED
  active_minutes: number // effort-relevant: automation excluded
  automation_minutes: number // ledger only: kept out of effort
  automation_calls: number
  total_calls: number
}

/**
 * msToMinutes — floor to 2 decimal places for stable comparisons in tests.
 */
function msToMinutes(ms: number): number {
  return Math.round((ms / 60_000) * 100) / 100
}

/**
 * deriveWorklog — active time for ONE ordered burst of invocations
 * (same session_id + task_id + agent_slug + start-day).
 *
 * Semantics (identical to v_session_active_time):
 *   - The first call contributes its own duration_ms (the call itself was
 *     the work; there is no prior gap to credit).
 *   - A subsequent call contributes the gap since the previous call when the
 *     gap ≤ threshold; when the gap is longer, only its own duration counts
 *     (the agent was away between the two).
 *   - actor_type='automation' rows contribute to automation_minutes ONLY —
 *     never to active_minutes (L10 policy: tag, don't lose).
 */
export function deriveWorklog(invocations: Invocation[], workedOn: string): WorklogCandidate {
  if (invocations.length === 0) {
    throw new Error('[worklog-derive] deriveWorklog requires at least one invocation')
  }

  const ordered = [...invocations].sort((a, b) => a.called_at.getTime() - b.called_at.getTime())
  const first = ordered[0]
  if (!first) {
    throw new Error('[worklog-derive] deriveWorklog requires at least one invocation')
  }

  let activeMinutes = 0
  let automationMinutes = 0
  let automationCalls = 0

  ordered.forEach((inv, i) => {
    const isAutomation = inv.actor_type === 'automation'
    if (isAutomation) automationCalls++

    const ownDuration = msToMinutes(inv.duration_ms ?? 0)

    if (i === 0) {
      // First call: no gap — only own duration.
      if (isAutomation) automationMinutes += ownDuration
      else activeMinutes += ownDuration
      return
    }

    const prev = ordered[i - 1]
    if (!prev) return // unreachable for i > 0 — satisfies the lint gate
    const gapMs = inv.called_at.getTime() - prev.called_at.getTime()
    const gapMinutes = msToMinutes(gapMs)

    if (gapMinutes <= ACTIVE_GAP_THRESHOLD_MINUTES) {
      // Continuous work: credit the GAP (not double-counting durations).
      if (isAutomation) automationMinutes += gapMinutes
      else activeMinutes += gapMinutes
    } else {
      // Away between calls: only the call's own duration counts.
      if (isAutomation) automationMinutes += ownDuration
      else activeMinutes += ownDuration
    }
  })

  return {
    agent_slug: first.agent_slug,
    worked_on: workedOn,
    active_minutes: Math.round(activeMinutes * 100) / 100,
    automation_minutes: Math.round(automationMinutes * 100) / 100,
    automation_calls: automationCalls,
    total_calls: ordered.length,
  }
}

/**
 * dayKeyOf — UTC day bucket for a timestamp: the day the session STARTED
 * (bucket key is computed from the FIRST invocation; callers bucket by
 * first-call day, matching DATE_TRUNC in the SQL view).
 */
export function dayKeyOf(instant: Date): string {
  return instant.toISOString().slice(0, 10)
}

/**
 * bucketInvocations — group an ordered invocation set into derivation
 * buckets: (session_id, task_id, agent_slug, first-call UTC day).
 * Mirrors the view's PARTITION BY.
 */
export function bucketInvocations(
  rows: Array<Invocation & { session_id: string; task_id: number }>,
): Array<{ session_id: string; task_id: number; worked_on: string; invocations: Invocation[] }> {
  const buckets = new Map<
    string,
    { session_id: string; task_id: number; worked_on: string; invocations: Invocation[] }
  >()

  // First pass: find each bucket's earliest call (its worked_on day).
  for (const row of rows) {
    const key = `${row.session_id}|${String(row.task_id)}|${row.agent_slug}`
    const existing = buckets.get(key)
    if (!existing) {
      buckets.set(key, {
        session_id: row.session_id,
        task_id: row.task_id,
        worked_on: dayKeyOf(row.called_at),
        invocations: [row],
      })
    } else {
      existing.invocations.push(row)
      const rowDay = dayKeyOf(row.called_at)
      if (rowDay < existing.worked_on) existing.worked_on = rowDay
    }
  }

  return [...buckets.values()]
}
