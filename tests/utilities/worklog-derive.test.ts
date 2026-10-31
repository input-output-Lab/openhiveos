/**
 * tests/utilities/worklog-derive.test.ts
 *
 * Unit tests for the pure active-time derivation (S17-BE-04 #2552).
 * No DB — timestamps are explicit fixtures. The documented gap threshold
 * (15 min) and automation exclusion are the contract under test.
 */
import { describe, it, expect } from 'vitest'
import {
  deriveWorklog,
  bucketInvocations,
  dayKeyOf,
  ACTIVE_GAP_THRESHOLD_MINUTES,
  type Invocation,
} from '../../src/utilities/worklog-derive.js'

const DAY = '2026-10-30'

function iso(hour: number, minute = 0, second = 0): Date {
  return new Date(`2026-10-30T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`)
}

function inv(minuteOffsetMinutes: number, overrides: Partial<Invocation> = {}): Invocation {
  return {
    agent_slug: 'murphy',
    actor_type: 'agent',
    called_at: new Date(iso(9).getTime() + minuteOffsetMinutes * 60_000),
    duration_ms: 0,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------

describe('ACTIVE_GAP_THRESHOLD_MINUTES', () => {
  it('is the documented 15-minute L10 policy value', () => {
    expect(ACTIVE_GAP_THRESHOLD_MINUTES).toBe(15)
  })
})

describe('deriveWorklog', () => {
  it('single call contributes its own duration_ms', () => {
    const wl = deriveWorklog([inv(0, { duration_ms: 90_000 })], DAY) // 1.5 min
    expect(wl.active_minutes).toBe(1.5)
    expect(wl.agent_slug).toBe('murphy')
    expect(wl.total_calls).toBe(1)
  })

  it('two calls 5 minutes apart → gap counts (5 min), not durations', () => {
    const wl = deriveWorklog(
      [
        inv(0, { duration_ms: 60_000 }), // 1 min
        inv(5, { duration_ms: 600_000 }), // 10 min — duration NOT counted
      ],
      DAY,
    )
    // 1 (own duration of first) + 5 (gap) = 6
    expect(wl.active_minutes).toBe(6)
  })

  it('gap of exactly 15 minutes still counts (≤ threshold)', () => {
    const wl = deriveWorklog([inv(0, { duration_ms: 60_000 }), inv(15, { duration_ms: 60_000 })], DAY)
    expect(wl.active_minutes).toBe(16) // 1 + 15-gap + 0? no: second call gets gap only → 1 + 15 = 16
  })

  it('gap of 15 minutes + 1 second does NOT count (away) — only own durations', () => {
    const awayGap = 15 * 60_000 + 1_000
    const wl = deriveWorklog(
      [inv(0, { duration_ms: 60_000 }), inv(0, { called_at: new Date(iso(9).getTime() + awayGap), duration_ms: 120_000 })],
      DAY,
    )
    expect(wl.active_minutes).toBe(3) // 1 + 2, gap excluded
  })

  it('automation rows are excluded from active_minutes but ledgered', () => {
    const wl = deriveWorklog(
      [
        inv(0, { duration_ms: 60_000 }),
        inv(3, { actor_type: 'automation', duration_ms: 30_000 }), // 3-min gap, automation
        inv(8, { duration_ms: 60_000 }), // 5-min gap from the automation call
      ],
      DAY,
    )
    // agent: 1 (first) + 5 (gap from automation call to last) = 6
    // automation: 3 (its gap) ledgered
    expect(wl.active_minutes).toBe(6)
    expect(wl.automation_minutes).toBe(3)
    expect(wl.automation_calls).toBe(1)
  })

  it('all-automation session derives zero active minutes', () => {
    const wl = deriveWorklog([inv(0, { actor_type: 'automation', duration_ms: 60_000 }), inv(4, { actor_type: 'automation', duration_ms: 60_000 })], DAY)
    expect(wl.active_minutes).toBe(0)
    // first call own duration (1) + 4-min gap = 5, ledgered
    expect(wl.automation_minutes).toBe(5)
    expect(wl.automation_calls).toBe(2)
  })

  it('calls arrive unsorted — derivation orders internally', () => {
    const wl = deriveWorklog([inv(5, { duration_ms: 60_000 }), inv(0, { duration_ms: 60_000 })], DAY)
    expect(wl.active_minutes).toBe(6) // 1 + 5-gap regardless of input order
  })

  it('null duration_ms is treated as 0 for own-duration contributions', () => {
    const wl = deriveWorklog([inv(0, { duration_ms: null }), inv(10, { duration_ms: null })], DAY)
    expect(wl.active_minutes).toBe(10) // 0 + 10-gap
  })

  it('empty input throws (caller bug, not a zero-minute day)', () => {
    expect(() => deriveWorklog([], DAY)).toThrow(/at least one/)
  })

  it('fractional minutes are rounded to 2 decimals', () => {
    const wl = deriveWorklog([inv(0, { duration_ms: 61_400 })], DAY) // 1.0233… min
    expect(wl.active_minutes).toBe(1.02)
  })
})

describe('dayKeyOf', () => {
  it('buckets by UTC date', () => {
    expect(dayKeyOf(new Date('2026-10-30T23:59:59.000Z'))).toBe('2026-10-30')
    expect(dayKeyOf(new Date('2026-10-31T00:00:01.000Z'))).toBe('2026-10-31')
  })
})

describe('bucketInvocations', () => {
  it('splits by session, task, and agent', () => {
    const rows = [
      { ...inv(0), session_id: 's1', task_id: 1 },
      { ...inv(2), session_id: 's1', task_id: 1 },
      { ...inv(0), session_id: 's2', task_id: 1 },
      { ...inv(1), session_id: 's1', task_id: 2, agent_slug: 'scout' },
    ]
    const buckets = bucketInvocations(rows)
    expect(buckets).toHaveLength(3)
    const sizes = buckets.map((b) => b.invocations.length).sort((a, b) => a - b)
    expect(sizes).toEqual([1, 1, 2])
  })

  it('cross-midnight session attributes to the day it STARTED', () => {
    const beforeMidnight = { ...inv(0), called_at: new Date('2026-10-30T23:50:00.000Z'), session_id: 's1', task_id: 1 }
    const afterMidnight = { ...inv(0), called_at: new Date('2026-10-31T00:10:00.000Z'), session_id: 's1', task_id: 1 }
    const buckets = bucketInvocations([beforeMidnight, afterMidnight])
    expect(buckets).toHaveLength(1)
    expect(buckets[0]!.worked_on).toBe('2026-10-30')
  })
})
