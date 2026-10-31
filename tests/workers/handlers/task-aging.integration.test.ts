/**
 * tests/workers/handlers/task-aging.integration.test.ts
 *
 * Integration tests for the task-aging cron handler (S17-BE-02 #2551).
 * Runs the REAL handler against a real testcontainer (full migration chain
 * incl. 024 lifecycle triggers) — no dispatcher mocks for the DB path.
 *
 * AC from the task:
 *   - handler tests with clock fixtures (backdated updated_at/history rows)
 *   - history rows written by the system actor ('system:auto_close'/'system:aging')
 *   - pending-close 30d → done with resolution=auto_closed (audited, reversible via audit trail)
 *   - review 7d → reviewer ping (follow-up task), 14d → owner escalation
 *   - unassigned review 14d → rework (NOT triage — Locksmith ruling)
 *   - recursion guard: cron-created follow-ups are never re-aged
 *   - dedupe: actions fire once per episode
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool, type PoolClient } from 'pg'
import { createTestDb, insertAgent, insertTask, type TestDb } from '../../helpers/db.js'

// Pool injection — same pattern as tests/db/queries/tasks.test.ts. The mock
// forwards withActor to the real implementation bound to the test pool (the
// production module closes over its own module-level pool).
let clientPool: Pool | undefined
vi.mock('../../../src/db/client.js', () => ({
  get pool() { return clientPool! },
  withActor: (actorSlug: string, fn: (tx: PoolClient) => Promise<unknown>) => realWithActor(clientPool!, actorSlug, fn),
}))

import { taskAgingHandler } from '../../../src/workers/handlers/task-aging.js'

// Real withActor bound to the test pool (the mock above forwards here)
async function realWithActor<T>(pool: Pool, actorSlug: string, fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  if (!/^(system:[a-z0-9_-]+|[a-z][a-z0-9_-]*)$/.test(actorSlug)) {
    throw new Error('invalid actor slug')
  }
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
let projectId: number

beforeAll(async () => {
  db = await createTestDb()
  clientPool = db.pool

  // Agents used across scenarios (synthetic tokens — auth not under test)
  await insertAgent(db.pool, 'elizabeth', 'Elizabeth')
  await insertAgent(db.pool, 'murphy', 'Murphy')
  await insertAgent(db.pool, 'scout', 'Scout')
  await insertAgent(db.pool, 'nova', 'Nova')

  const proj = await db.pool.query<{ id: number }>(`SELECT id FROM projects WHERE slug = 'test-project'`)
  projectId = proj.rows[0]!.id
}, 90_000)

afterAll(async () => {
  await db.teardown()
})

beforeEach(async () => {
  await db.cleanTasks()
})

// ---------------------------------------------------------------------------
// pending-close → auto-close
// ---------------------------------------------------------------------------

describe('auto-close: pending-close 30d → done', () => {
  it('closes a 30d pending-close task with resolution=auto_closed', async () => {
    const taskId = await insertTask(db.pool, {
      status: 'pending-close',
      assignee_agent_slug: 'murphy',
      statusSince: "NOW() - interval '30 days'",
    })

    await taskAgingHandler('task_aging', null, db.pool)

    const row = await db.pool.query<{ status: string; resolution: string | null }>(
      `SELECT status::text AS status, resolution FROM tasks WHERE id = $1`,
      [taskId],
    )
    expect(row.rows[0]!.status).toBe('done')
    expect(row.rows[0]!.resolution).toBe('auto_closed')
    expect(row.rows[0]!.status).not.toBe('pending-close')
  })

  it('writes the history row attributed to system:auto_close (AC: system actor)', async () => {
    const taskId = await insertTask(db.pool, {
      status: 'pending-close',
      statusSince: "NOW() - interval '31 days'",
    })

    await taskAgingHandler('task_aging', null, db.pool)

    const history = await db.pool.query<{ from_status: string | null; to_status: string; changed_by: string | null }>(
      `SELECT from_status, to_status, changed_by FROM task_status_history
       WHERE task_id = $1 ORDER BY changed_at DESC LIMIT 1`,
      [taskId],
    )
    expect(history.rows[0]!.from_status).toBe('pending-close')
    expect(history.rows[0]!.to_status).toBe('done')
    expect(history.rows[0]!.changed_by).toBe('system:auto_close')
  })

  it('does NOT close a 29d pending-close task (threshold exact)', async () => {
    const taskId = await insertTask(db.pool, {
      status: 'pending-close',
      statusSince: "NOW() - interval '29 days'",
    })

    await taskAgingHandler('task_aging', null, db.pool)

    const row = await db.pool.query<{ status: string }>(`SELECT status::text AS status FROM tasks WHERE id = $1`, [taskId])
    expect(row.rows[0]!.status).toBe('pending-close')
  })

  it('sets completed_at via the lifecycle trigger', async () => {
    const taskId = await insertTask(db.pool, {
      status: 'pending-close',
      statusSince: "NOW() - interval '30 days'",
    })

    await taskAgingHandler('task_aging', null, db.pool)

    const row = await db.pool.query<{ completed_at: Date | null }>(`SELECT completed_at FROM tasks WHERE id = $1`, [taskId])
    expect(row.rows[0]!.completed_at).not.toBeNull()
  })

  it('skips externally-synced tasks (sync-state guard)', async () => {
    const taskId = await insertTask(db.pool, {
      status: 'pending-close',
      statusSince: "NOW() - interval '30 days'",
    })
    await db.pool.query(
      `INSERT INTO external_task_links (task_id, provider, external_id) VALUES ($1, 'clickup', 'cu-1')`,
      [taskId],
    )

    await taskAgingHandler('task_aging', null, db.pool)

    const row = await db.pool.query<{ status: string }>(`SELECT status::text AS status FROM tasks WHERE id = $1`, [taskId])
    expect(row.rows[0]!.status).toBe('pending-close')
  })

  it('stamps the dedupe key so a second run is a no-op (audited once)', async () => {
    const taskId = await insertTask(db.pool, {
      status: 'pending-close',
      statusSince: "NOW() - interval '30 days'",
    })

    await taskAgingHandler('task_aging', null, db.pool)
    // Second run: task is already done → scan excludes it. No errors, no churn.
    await taskAgingHandler('task_aging', null, db.pool)

    const historyCount = await db.pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM task_status_history WHERE task_id = $1 AND to_status = 'done'`,
      [taskId],
    )
    expect(historyCount.rows[0]!.n).toBe('1')
  })
})

// ---------------------------------------------------------------------------
// review → ping / escalate
// ---------------------------------------------------------------------------

describe('ping and escalate: review follow-ups', () => {
  it('7d review → follow-up task assigned to the explicit reviewer', async () => {
    const taskId = await insertTask(db.pool, {
      status: 'review',
      assignee_agent_slug: 'murphy',
      reviewer_agent_slug: 'scout',
      statusSince: "NOW() - interval '7 days'",
    })

    await taskAgingHandler('task_aging', null, db.pool)

    const followUps = await db.pool.query<{ title: string; assignee_agent_slug: string | null; status: string }>(
      `SELECT title, assignee_agent_slug, status::text AS status FROM tasks
       WHERE title LIKE '%' || $1::text || '%' AND id <> $1::bigint`,
      [String(taskId)],
    )
    expect(followUps.rows).toHaveLength(1)
    expect(followUps.rows[0]!.assignee_agent_slug).toBe('scout')
    expect(followUps.rows[0]!.status).toBe('todo')
  })

  it('14d review (already pinged) → escalation follow-up assigned to the project owner', async () => {
    const taskId = await insertTask(db.pool, {
      status: 'review',
      assignee_agent_slug: 'murphy',
      reviewer_agent_slug: 'scout',
      statusSince: "NOW() - interval '14 days'",
      metadata: { aging_ping_7d: { episode: 'review', at: '2026-10-20T00:00:00Z' } },
    })

    await taskAgingHandler('task_aging', null, db.pool)

    const followUps = await db.pool.query<{ assignee_agent_slug: string | null; title: string }>(
      `SELECT assignee_agent_slug, title FROM tasks WHERE title LIKE '%ESCALATION%' AND id <> $1::bigint`,
      [String(taskId)],
    )
    expect(followUps.rows).toHaveLength(1)
    expect(followUps.rows[0]!.assignee_agent_slug).toBe('test-agent') // owner of test-project
  })

  it('6d review → no follow-up (below threshold)', async () => {
    await insertTask(db.pool, {
      status: 'review',
      assignee_agent_slug: 'murphy',
      statusSince: "NOW() - interval '6 days'",
    })

    await taskAgingHandler('task_aging', null, db.pool)

    const n = await db.pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM tasks`)
    expect(n.rows[0]!.n).toBe('1') // only the original
  })

  it('follow-up carries the recursion-guard metadata marker', async () => {
    const taskId = await insertTask(db.pool, {
      status: 'review',
      assignee_agent_slug: 'murphy',
      reviewer_agent_slug: 'scout',
      statusSince: "NOW() - interval '7 days'",
    })

    await taskAgingHandler('task_aging', null, db.pool)

    const followUp = await db.pool.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM tasks WHERE id <> $1::bigint AND metadata ? 'aging_followup'`,
      [String(taskId)],
    )
    expect(followUp.rows).toHaveLength(1)
  })

  it('RECURSION GUARD: a 30d-old aging follow-up itself is never aged or auto-closed', async () => {
    // Simulate a follow-up the cron created long ago that nobody touched.
    const followUpId = await insertTask(db.pool, {
      status: 'review',
      assignee_agent_slug: 'scout',
      metadata: { aging_followup: { kind: 'ping_reviewer', source_task_id: 999 } },
      statusSince: "NOW() - interval '30 days'",
    })

    await taskAgingHandler('task_aging', null, db.pool)

    const row = await db.pool.query<{ status: string; metadata: Record<string, unknown> }>(
      `SELECT status::text AS status, metadata FROM tasks WHERE id = $1`,
      [followUpId],
    )
    expect(row.rows[0]!.status).toBe('review') // untouched
    expect(row.rows[0]!.metadata['aging_ping_7d']).toBeUndefined() // never pinged again
  })
})

// ---------------------------------------------------------------------------
// review → rework (unassigned), the ruling replacement for triage
// ---------------------------------------------------------------------------

describe('reroute: unassigned review 14d → rework', () => {
  it('reroutes an unassigned 14d review task to rework as system:aging', async () => {
    const taskId = await insertTask(db.pool, {
      status: 'review',
      assignee_agent_slug: null,
      statusSince: "NOW() - interval '14 days'",
    })

    await taskAgingHandler('task_aging', null, db.pool)

    const row = await db.pool.query<{ status: string }>(`SELECT status::text AS status FROM tasks WHERE id = $1`, [taskId])
    expect(row.rows[0]!.status).toBe('rework')

    const history = await db.pool.query<{ changed_by: string | null }>(
      `SELECT changed_by FROM task_status_history WHERE task_id = $1 ORDER BY changed_at DESC LIMIT 1`,
      [taskId],
    )
    expect(history.rows[0]!.changed_by).toBe('system:aging')
  })

  it('does NOT reroute an ASSIGNED 14d review task (escalates instead)', async () => {
    const taskId = await insertTask(db.pool, {
      status: 'review',
      assignee_agent_slug: 'murphy',
      statusSince: "NOW() - interval '14 days'",
    })

    await taskAgingHandler('task_aging', null, db.pool)

    const row = await db.pool.query<{ status: string }>(`SELECT status::text AS status FROM tasks WHERE id = $1`, [taskId])
    expect(row.rows[0]!.status).toBe('review') // still review — escalation is the action

    const escalation = await db.pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM tasks WHERE title LIKE '%ESCALATION%' AND id <> $1::bigint`,
      [String(taskId)],
    )
    expect(escalation.rows[0]!.n).toBe('1')
  })

  it('rework → wip remains available to the owner afterwards (task re-enters the machine)', async () => {
    const taskId = await insertTask(db.pool, {
      status: 'review',
      assignee_agent_slug: null,
      statusSince: "NOW() - interval '20 days'",
    })

    await taskAgingHandler('task_aging', null, db.pool)

    // Owner path: rework → wip is in the matrix. Simulate via direct SQL with
    // the owner actor to prove the task is actionable, not stranded.
    const client = await db.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`SET LOCAL hive.actor = 'test-agent'`)
      await client.query(`UPDATE tasks SET status = 'wip' WHERE id = $1`, [taskId])
      await client.query('COMMIT')
    } finally {
      client.release()
    }
    const row = await db.pool.query<{ status: string }>(`SELECT status::text AS status FROM tasks WHERE id = $1`, [taskId])
    expect(row.rows[0]!.status).toBe('wip')
  })
})

// ---------------------------------------------------------------------------
// Mixed-run sanity + audit trail
// ---------------------------------------------------------------------------

describe('run summary and audit', () => {
  it('handles a mixed board in one run (close, reroute, ping) without cross-talk', async () => {
    await insertTask(db.pool, { status: 'pending-close', statusSince: "NOW() - interval '30 days'" })
    await insertTask(db.pool, { status: 'review', assignee_agent_slug: null, statusSince: "NOW() - interval '15 days'" })
    await insertTask(db.pool, {
      status: 'review',
      assignee_agent_slug: 'murphy',
      reviewer_agent_slug: 'scout',
      statusSince: "NOW() - interval '8 days'",
    })
    await insertTask(db.pool, { status: 'todo', statusSince: "NOW() - interval '40 days'" }) // not scanned

    await taskAgingHandler('task_aging', null, db.pool)

    const statuses = await db.pool.query<{ status: string; n: string }>(
      `SELECT status::text AS status, COUNT(*)::text AS n FROM tasks GROUP BY status ORDER BY status`,
    )
    const byStatus = Object.fromEntries(statuses.rows.map((r) => [r.status, Number(r.n)]))
    expect(byStatus['done']).toBe(1)
    expect(byStatus['rework']).toBe(1)
    expect(byStatus['todo']).toBe(2) // original untouched + 1 ping follow-up
  })

  it('audit_log records the system actor on auto-close', async () => {
    const taskId = await insertTask(db.pool, {
      status: 'pending-close',
      statusSince: "NOW() - interval '30 days'",
    })

    await taskAgingHandler('task_aging', null, db.pool)

    const audit = await db.pool.query<{ actor: string | null; changes: Record<string, unknown> }>(
      `SELECT actor, changes FROM audit_log WHERE table_name = 'tasks' AND row_id = $1 ORDER BY changed_at DESC LIMIT 1`,
      [taskId],
    )
    expect(audit.rows[0]!.actor).toBe('system:auto_close')
    expect(JSON.stringify(audit.rows[0]!.changes)).toContain('"status"')
    expect(JSON.stringify(audit.rows[0]!.changes)).toContain('"resolution"')
  })
})
