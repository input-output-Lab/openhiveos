/**
 * tests/utilities/task-aging.test.ts
 *
 * Unit tests for the pure aging/escalation decisions (S17-BE-02 #2551).
 * No DB — the clock is injected; every threshold and dedupe rule is covered.
 *
 * Matrix amendments here are Tier 3: these tests encode the Locksmith ruling
 * (thought 1144 / memory 3338) alongside tests/utilities/task-transitions.test.ts.
 */
import { describe, it, expect } from 'vitest'
import {
  classifyAgedTask,
  daysInStatus,
  isAgingFollowUp,
  filterAgingFollowUps,
  buildFollowUpSpec,
  DEDUPE_KEYS,
  PING_REVIEWER_DAYS,
  ESCALATE_DAYS,
  AUTOCLOSE_PENDING_CLOSE_DAYS,
  REWORK_REROUTE_DAYS,
} from '../../src/utilities/task-aging.js'
import {
  assertSystemTransition,
  AUTOCLOSE_DAYS,
  REWORK_REROUTE_DAYS as T_REWORK_REROUTE_DAYS,
  TRANSITIONS,
} from '../../src/utilities/task-transitions.js'

const NOW = new Date('2026-10-31T12:00:00.000Z')

function reviewTask(overrides: Partial<Parameters<typeof classifyAgedTask>[0]> = {}) {
  return {
    status: 'review' as const,
    assignee_agent_slug: 'murphy' as string | null,
    metadata: {} as Record<string, unknown>,
    days_in_status: 1,
    ...overrides,
  }
}

function classify(task: ReturnType<typeof reviewTask>) {
  return classifyAgedTask(task)
}

// ---------------------------------------------------------------------------
// Threshold constants — internal/external sync + policy values
// ---------------------------------------------------------------------------

describe('threshold constants', () => {
  it('policy values match the approved L10 policy', () => {
    expect(PING_REVIEWER_DAYS).toBe(7)
    expect(ESCALATE_DAYS).toBe(14)
    expect(AUTOCLOSE_PENDING_CLOSE_DAYS).toBe(30)
    expect(REWORK_REROUTE_DAYS).toBe(14)
  })

  it('utility thresholds match transition-module thresholds (single source)', () => {
    expect(REWORK_REROUTE_DAYS).toBe(T_REWORK_REROUTE_DAYS)
    expect(AUTOCLOSE_PENDING_CLOSE_DAYS).toBe(AUTOCLOSE_DAYS)
  })

  it('the matrix contains exactly the two system rows', () => {
    const systemRows = TRANSITIONS.filter((t) => t.role === 'system')
    expect(systemRows).toHaveLength(2)
    expect(systemRows).toContainEqual({ from: 'pending-close', to: 'done', role: 'system' })
    expect(systemRows).toContainEqual({ from: 'review', to: 'rework', role: 'system' })
  })
})

// ---------------------------------------------------------------------------
// daysInStatus — floor semantics (clock fixture)
// ---------------------------------------------------------------------------

describe('daysInStatus', () => {
  it('floors partial days — 6.9 days is NOT 7', () => {
    const changedAt = new Date(NOW.getTime() - 6.9 * 86_400_000)
    expect(daysInStatus(changedAt, NOW)).toBe(6)
  })

  it('exactly 30 days counts as 30', () => {
    const changedAt = new Date(NOW.getTime() - 30 * 86_400_000)
    expect(daysInStatus(changedAt, NOW)).toBe(30)
  })

  it('future timestamps clamp to 0 (no negative ages)', () => {
    const changedAt = new Date(NOW.getTime() + 3_600_000)
    expect(daysInStatus(changedAt, NOW)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// classifyAgedTask — pending-close → auto_close
// ---------------------------------------------------------------------------

describe('classifyAgedTask: pending-close', () => {
  it('30d pending-close → auto_close', () => {
    const decision = classifyAgedTask(reviewTask({ status: 'pending-close', days_in_status: 30 }))
    expect(decision.action).toBe('auto_close')
    expect(decision.dedupeKey).toBe(DEDUPE_KEYS.autoClose)
  })

  it('29d pending-close → none (threshold is exact)', () => {
    const decision = classifyAgedTask(reviewTask({ status: 'pending-close', days_in_status: 29 }))
    expect(decision.action).toBe('none')
  })

  it('already auto-closed this episode (dedupe stamp) → none', () => {
    const decision = classifyAgedTask(
      reviewTask({
        status: 'pending-close',
        days_in_status: 45,
        metadata: { [DEDUPE_KEYS.autoClose]: { episode: 'pending-close', at: '2026-10-01T00:00:00Z' } },
      }),
    )
    expect(decision.action).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// classifyAgedTask — review → ping / escalate / reroute
// ---------------------------------------------------------------------------

describe('classifyAgedTask: review', () => {
  it('7d review, assigned → ping_reviewer', () => {
    const decision = classifyAgedTask(reviewTask({ days_in_status: 7 }))
    expect(decision.action).toBe('ping_reviewer')
  })

  it('6d review → none', () => {
    const decision = classifyAgedTask(reviewTask({ days_in_status: 6 }))
    expect(decision.action).toBe('none')
  })

  it('14d review, assigned → escalate_owner (not ping — ping already due but escalation wins)', () => {
    const decision = classifyAgedTask(reviewTask({ days_in_status: 14 }))
    expect(decision.action).toBe('escalate_owner')
  })

  it('14d review, UNASSIGNED → reroute_rework (ruling: unassigned goes to rework, not triage)', () => {
    const decision = classifyAgedTask(reviewTask({ assignee_agent_slug: null, days_in_status: 14 }))
    expect(decision.action).toBe('reroute_rework')
  })

  it('13d unassigned review → ping (below reroute threshold, ping due)', () => {
    const decision = classifyAgedTask(reviewTask({ assignee_agent_slug: null, days_in_status: 13 }))
    expect(decision.action).toBe('ping_reviewer')
  })

  it('pinged this episode → next action is escalate at 14d (dedupe per action)', () => {
    const decision = classifyAgedTask(
      reviewTask({ days_in_status: 14, metadata: { [DEDUPE_KEYS.pingReviewer]: { episode: 'review', at: 'x' } } }),
    )
    expect(decision.action).toBe('escalate_owner')
  })

  it('escalated this episode → none (no further action for assigned review)', () => {
    const decision = classifyAgedTask(
      reviewTask({ days_in_status: 20, metadata: { [DEDUPE_KEYS.escalate]: { episode: 'review', at: 'x' } } }),
    )
    expect(decision.action).toBe('none')
  })

  it('stale-format stamp (bare string) fails closed toward not re-acting', () => {
    const decision = classifyAgedTask(
      reviewTask({ days_in_status: 8, metadata: { [DEDUPE_KEYS.pingReviewer]: '2026-10-01' } }),
    )
    expect(decision.action).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// Recursion guard — aging follow-ups are invisible to the cron
// ---------------------------------------------------------------------------

describe('recursion guard', () => {
  it('follow-up task with aging marker is excluded from scans', () => {
    const rows = [
      reviewTask({}) as unknown as { id: number; metadata: Record<string, unknown> },
      {
        id: 2,
        metadata: { aging_followup: { kind: 'ping_reviewer', source_task_id: 1 } },
      },
    ].map((r, i) => ({ ...r, id: r.id ?? i + 1 })) as never[]
    const filtered = filterAgingFollowUps(rows)
    expect(filtered).toHaveLength(1)
  })

  it('isAgingFollowUp: exact marker key only — dedupe stamps do NOT mark follow-ups', () => {
    expect(isAgingFollowUp({ aging_followup: {} })).toBe(true)
    expect(isAgingFollowUp({ aging_ping_7d: { at: 'x' } })).toBe(false)
    expect(isAgingFollowUp({ aging_escalate_14d: { at: 'x' } })).toBe(false)
    expect(isAgingFollowUp({ some_other: 1 })).toBe(false)
    expect(isAgingFollowUp(null)).toBe(false)
    expect(isAgingFollowUp(undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// assertSystemTransition — the structural preconditions (Tier 3)
// ---------------------------------------------------------------------------

describe('assertSystemTransition', () => {
  it('pending-close 30d → done: OK as system', () => {
    const verdict = assertSystemTransition(
      { status: 'pending-close', assignee_agent_slug: 'murphy', daysInStatus: 30 },
      'done',
    )
    expect(verdict).toEqual({ ok: true, role: 'system' })
  })

  it('pending-close 29d → done: rejected (below threshold)', () => {
    const verdict = assertSystemTransition(
      { status: 'pending-close', assignee_agent_slug: 'murphy', daysInStatus: 29 },
      'done',
    )
    expect(verdict.ok).toBe(false)
  })

  it('review 14d unassigned → rework: OK as system', () => {
    const verdict = assertSystemTransition(
      { status: 'review', assignee_agent_slug: null, daysInStatus: 14 },
      'rework',
    )
    expect(verdict).toEqual({ ok: true, role: 'system' })
  })

  it('review 14d ASSIGNED → rework: rejected (unassigned precondition)', () => {
    const verdict = assertSystemTransition(
      { status: 'review', assignee_agent_slug: 'murphy', daysInStatus: 14 },
      'rework',
    )
    expect(verdict.ok).toBe(false)
  })

  it('review 7d unassigned → rework: rejected (below threshold)', () => {
    const verdict = assertSystemTransition(
      { status: 'review', assignee_agent_slug: null, daysInStatus: 7 },
      'rework',
    )
    expect(verdict.ok).toBe(false)
  })

  it('no system row for other edges — throws (caller bug, not policy)', () => {
    expect(() =>
      assertSystemTransition({ status: 'wip', assignee_agent_slug: null, daysInStatus: 99 }, 'done'),
    ).toThrow(/no system row/)
    expect(() =>
      assertSystemTransition({ status: 'review', assignee_agent_slug: null, daysInStatus: 99 }, 'done'),
    ).toThrow(/no system row/)
    // review → done must never be reachable by system (no skips, P4)
    expect(() =>
      assertSystemTransition({ status: 'review', assignee_agent_slug: null, daysInStatus: 99 }, 'done'),
    ).toThrow(/no system row/)
  })
})

// ---------------------------------------------------------------------------
// buildFollowUpSpec — follow-up task factory
// ---------------------------------------------------------------------------

describe('buildFollowUpSpec', () => {
  const sourceTask = { id: 42, project_id: 7, title: 'Fix the flux capacitor', days_in_status: 8 }

  it('ping spec: assigned to given reviewer, carries recursion-guard metadata', () => {
    const spec = buildFollowUpSpec({
      sourceTask,
      kind: 'ping_reviewer',
      assigneeAgentSlug: 'scout',
      now: NOW,
    })
    expect(spec.project_id).toBe(7)
    expect(spec.assignee_agent_slug).toBe('scout')
    expect(spec.metadata.aging_followup).toEqual({ kind: 'ping_reviewer', source_task_id: 42, created_at: NOW.toISOString() })
    expect(spec.title).toContain('#42')
    expect(spec.estimated_hours).toBeGreaterThan(0)
    expect(spec.estimate_confidence).toBe('low')
  })

  it('escalation spec: title flags escalation', () => {
    const spec = buildFollowUpSpec({
      sourceTask,
      kind: 'escalate_owner',
      assigneeAgentSlug: 'elizabeth',
      now: NOW,
    })
    expect(spec.title).toContain('ESCALATION')
    expect(spec.assignee_agent_slug).toBe('elizabeth')
  })

  it('long titles are truncated to 500 chars', () => {
    const spec = buildFollowUpSpec({
      sourceTask: { ...sourceTask, title: 'x'.repeat(2000) },
      kind: 'ping_reviewer',
      assigneeAgentSlug: 'scout',
      now: NOW,
    })
    expect(spec.title.length).toBeLessThanOrEqual(500)
  })
})
