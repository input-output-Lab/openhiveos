/**
 * tests/workers/handlers/worklog-derive.integration.test.ts
 *
 * Integration tests for the worklog derivation job (S17-BE-04 #2552).
 * Real testcontainer, full migration chain including 027. Verifies:
 *   - the SQL view matches the TS derivation oracle (same numbers)
 *   - the handler writes source='auto' worklogs attributed to system:worklog
 *   - idempotency: re-run corrects, never duplicates
 *   - automation exclusion at the view level
 *   - task/session bucketing
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { createTestDb, insertAgent, insertTask, insertInvocation, type TestDb } from '../../helpers/db.js'

let clientPool: Pool | undefined
vi.mock('../../../src/db/client.js', () => ({
  get pool() { return clientPool! },
  withActor: (actorSlug: string, fn: (tx: PoolClient) => Promise<unknown>) => realWithActor(clientPool!, actorSlug, fn),
}))

import { worklogDeriveHandler } from '../../../src/workers/handlers/worklog-derive.js'
import { deriveWorklog, ACTIVE_GAP_THRESHOLD_MINUTES } from '../../../src/utilities/worklog-derive.js'
import type { PoolClient } from 'pg'

async function realWithActor<T>(pool: Pool, actorSlug: string, fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  if (!/^(system:[a-z0-9_-]+|[a-z][a-z0-9_-]*)$/.test(actorSlug)) throw new Error('invalid actor slug')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL hive.actor = '${actorSlug}'`)
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

let db: TestDb
let taskId: number
// Fixtures anchor invocations on a FIXED day (2026-10-30). The handler is
// invoked with an explicit { day } payload for that date — the handler's
// default (yesterday from the real clock) would drift as the calendar moves
// and silently find nothing (2026-11-02 incident: 3 CI failures on main-
// adjacent branches when the calendar advanced past the fixture date).
const FIXTURE_DAY = '2026-10-30'
const NOW = new Date('2026-10-31T10:00:00.000Z')

function yesterdayIso(hour: number, minute = 0): string {
  return new Date(new Date('2026-10-30T00:00:00.000Z').getTime() + hour * 3_600_000 + minute * 60_000).toISOString()
}

beforeAll(async () => {
  db = await createTestDb()
  clientPool = db.pool
  await insertAgent(db.pool, 'murphy', 'Murphy')
  await insertAgent(db.pool, 'scout', 'Scout')
  taskId = await insertTask(db.pool, { title: 'Derivation target', status: 'wip', assignee_agent_slug: 'murphy' })
}, 90_000)

afterAll(async () => {
  await db.teardown()
})

beforeEach(async () => {
  await db.pool.query(`DELETE FROM task_worklogs`)
  await db.pool.query(`DELETE FROM tool_invocations`)
})

// ---------------------------------------------------------------------------
// View parity with the TS oracle
// ---------------------------------------------------------------------------

describe('v_session_active_time', () => {
  it('matches the TS derivation for a mixed agent/automation session', async () => {
    // 9:00 agent (1 min), 9:05 agent (gap 5), 9:08 automation (gap 3), 9:20 agent (gap 12 ≤ 15)
    await insertInvocation(db.pool, { session_id: 's1', task_id: taskId, called_at: yesterdayIso(9, 0), duration_ms: 60_000, actor_type: 'agent' })
    await insertInvocation(db.pool, { session_id: 's1', task_id: taskId, called_at: yesterdayIso(9, 5), duration_ms: 60_000, actor_type: 'agent' })
    await insertInvocation(db.pool, { session_id: 's1', task_id: taskId, called_at: yesterdayIso(9, 8), duration_ms: 30_000, actor_type: 'automation' })
    await insertInvocation(db.pool, { session_id: 's1', task_id: taskId, called_at: yesterdayIso(9, 20), duration_ms: 60_000, actor_type: 'agent' })

    const view = await db.pool.query<{ active_minutes: string; automation_minutes: string }>(
      `SELECT active_minutes::text, automation_minutes::text FROM v_session_active_time`,
    )
    expect(view.rows).toHaveLength(1)
    expect(Number(view.rows[0]!.active_minutes)).toBeGreaterThan(0)

    // TS oracle over the same fixtures
    const oracle = deriveWorklog(
      [
        { agent_slug: 'test-agent', actor_type: 'agent', called_at: new Date(yesterdayIso(9, 0)), duration_ms: 60_000 },
        { agent_slug: 'test-agent', actor_type: 'agent', called_at: new Date(yesterdayIso(9, 5)), duration_ms: 60_000 },
        { agent_slug: 'test-agent', actor_type: 'automation', called_at: new Date(yesterdayIso(9, 8)), duration_ms: 30_000 },
        { agent_slug: 'test-agent', actor_type: 'agent', called_at: new Date(yesterdayIso(9, 20)), duration_ms: 60_000 },
      ],
      '2026-10-30',
    )
    expect(Number(view.rows[0]!.active_minutes)).toBe(oracle.active_minutes)
    expect(Number(view.rows[0]!.automation_minutes)).toBe(oracle.automation_minutes)
  })

  it('excludes gaps over the documented threshold', async () => {
    await insertInvocation(db.pool, { session_id: 's1', task_id: taskId, called_at: yesterdayIso(9, 0), duration_ms: 60_000 })
    await insertInvocation(db.pool, { session_id: 's1', task_id: taskId, called_at: yesterdayIso(11, 0), duration_ms: 60_000 }) // 2h gap

    const view = await db.pool.query<{ active_minutes: string }>(`SELECT active_minutes::text FROM v_session_active_time`)
    expect(Number(view.rows[0]!.active_minutes)).toBe(2) // two own-durations, gap excluded
  })
})

// ---------------------------------------------------------------------------
// Handler end-to-end
// ---------------------------------------------------------------------------

describe('worklog_derive handler', () => {
  it('writes source=auto worklog attributed to system:worklog', async () => {
    await insertInvocation(db.pool, { session_id: 's1', task_id: taskId, called_at: yesterdayIso(9, 0), duration_ms: 60_000 })
    await insertInvocation(db.pool, { session_id: 's1', task_id: taskId, called_at: yesterdayIso(9, 10), duration_ms: 60_000 })

    await worklogDeriveHandler('worklog_derive', { day: FIXTURE_DAY }, db.pool)

    const wl = await db.pool.query<{ source: string; minutes: string; agent_slug: string; session_id: string | null }>(
      `SELECT source, minutes::text AS minutes, agent_slug, session_id FROM task_worklogs`,
    )
    expect(wl.rows).toHaveLength(1)
    expect(wl.rows[0]!.source).toBe('auto')
    expect(wl.rows[0]!.session_id).toBe('s1')
    expect(Number(wl.rows[0]!.minutes)).toBe(11) // 1 + 10-gap

    // Audit ledger metadata carries the gap threshold + automation ledger
    const meta = await db.pool.query<{ metadata: Record<string, unknown> }>(`SELECT metadata FROM task_worklogs`)
    expect(meta.rows[0]!.metadata['gap_threshold_minutes']).toBe(ACTIVE_GAP_THRESHOLD_MINUTES)
  })

  it('is idempotent — a second run corrects, never duplicates', async () => {
    await insertInvocation(db.pool, { session_id: 's1', task_id: taskId, called_at: yesterdayIso(9, 0), duration_ms: 60_000 })
    await worklogDeriveHandler('worklog_derive', { day: FIXTURE_DAY }, db.pool)
    await worklogDeriveHandler('worklog_derive', { day: FIXTURE_DAY }, db.pool)

    const n = await db.pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM task_worklogs`)
    expect(n.rows[0]!.n).toBe('1')
  })

  it('buckets per task — a session touching two tasks yields two worklogs', async () => {
    const otherTask = await insertTask(db.pool, { title: 'Second target', status: 'wip', assignee_agent_slug: 'murphy' })
    await insertInvocation(db.pool, { session_id: 's1', task_id: taskId, called_at: yesterdayIso(9, 0), duration_ms: 60_000 })
    await insertInvocation(db.pool, { session_id: 's1', task_id: otherTask, called_at: yesterdayIso(9, 2), duration_ms: 60_000 })

    await worklogDeriveHandler('worklog_derive', { day: FIXTURE_DAY }, db.pool)

    const rows = await db.pool.query<{ task_id: number; minutes: string }>(
      `SELECT task_id, minutes::text AS minutes FROM task_worklogs ORDER BY task_id`,
    )
    expect(rows.rows).toHaveLength(2)
  })

  it('zero active_minutes buckets (all-automation) are NOT written', async () => {
    await insertInvocation(db.pool, { session_id: 's1', task_id: taskId, called_at: yesterdayIso(9, 0), duration_ms: 60_000, actor_type: 'automation' })
    await insertInvocation(db.pool, { session_id: 's1', task_id: taskId, called_at: yesterdayIso(9, 4), duration_ms: 60_000, actor_type: 'automation' })

    await worklogDeriveHandler('worklog_derive', { day: FIXTURE_DAY }, db.pool)

    const n = await db.pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM task_worklogs`)
    expect(n.rows[0]!.n).toBe('0')
  })

  it('day parameter override derives a specific past day', async () => {
    await insertInvocation(db.pool, { session_id: 's1', task_id: taskId, called_at: '2026-10-20T09:00:00.000Z', duration_ms: 60_000 })
    await worklogDeriveHandler('worklog_derive', { day: '2026-10-20' }, db.pool)

    const n = await db.pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM task_worklogs`)
    expect(n.rows[0]!.n).toBe('1')
  })

  it('today-only sessions are invisible to a one-day-old window', async () => {
    // Seeds an invocation "today" (relative to NOW) and derives YESTERDAY —
    // the documented default window. The session must NOT be picked up:
    // derivation is day-bucketed, not "everything newer than the window".
    const todayIso = new Date(NOW.getTime() - 3_600_000).toISOString().slice(0, 10)
    await insertInvocation(db.pool, { session_id: 's1', task_id: taskId, called_at: new Date(NOW.getTime() - 3_600_000).toISOString(), duration_ms: 60_000 })
    await worklogDeriveHandler('worklog_derive', { day: FIXTURE_DAY }, db.pool)
    const n = await db.pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM task_worklogs`)
    expect(n.rows[0]!.n).toBe('0')
    // And deriving the session's OWN day DOES pick it up — proving the zero
    // above is window semantics, not a broken seed.
    await worklogDeriveHandler('worklog_derive', { day: todayIso }, db.pool)
    const n2 = await db.pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM task_worklogs`)
    expect(n2.rows[0]!.n).toBe('1')
  })

  it('cross-midnight session attributes to its START day', async () => {
    await insertInvocation(db.pool, { session_id: 's1', task_id: taskId, called_at: '2026-10-29T23:55:00.000Z', duration_ms: 60_000 })
    await insertInvocation(db.pool, { session_id: 's1', task_id: taskId, called_at: '2026-10-30T00:05:00.000Z', duration_ms: 60_000 })
    // Day window [10-29, 10-30): the session's start day. Deriving 10-30
    // would MISS it — that is the documented attribution behavior.
    await worklogDeriveHandler('worklog_derive', { day: '2026-10-29' }, db.pool)

    const days = await db.pool.query<{ worked_on: string }>(`SELECT TO_CHAR(worked_on, 'YYYY-MM-DD') AS worked_on FROM task_worklogs`)
    expect(days.rows).toHaveLength(1)
    expect(days.rows[0]!.worked_on).toBe('2026-10-29')
  })
})
