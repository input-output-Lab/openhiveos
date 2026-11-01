/**
 * tests/db/queries/worklogs.integration.test.ts
 *
 * Integration tests for human worklog writes (S17-BE-03 #2557).
 * Real testcontainer, full migration chain including 028. Verifies:
 *   - insertHumanWorklog writes source='human' with the expected columns
 *   - the audit trigger attributes the INSERT to the caller slug via withActor
 *   - DB-level CHECK constraints reject malformed rows (fail closed)
 *   - auto rows (027 contract) still satisfy the 028 constraints
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool, type PoolClient } from 'pg'
import { createTestDb, insertAgent, insertTask, type TestDb } from '../../helpers/db.js'

let clientPool: Pool | undefined
vi.mock('../../../src/db/client.js', () => ({
  get pool() { return clientPool! },
  withActor: (actorSlug: string, fn: (tx: PoolClient) => Promise<unknown>) =>
    realWithActor(clientPool!, actorSlug, fn),
}))

import { insertHumanWorklog } from '../../../src/db/queries/worklogs.js'

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

beforeAll(async () => {
  db = await createTestDb()
  clientPool = db.pool
  await insertAgent(db.pool, 'murphy', 'Murphy')
  taskId = await insertTask(db.pool, { title: 'Log time target', status: 'wip', assignee_agent_slug: 'murphy' })
}, 90_000)

afterAll(async () => {
  await db.teardown()
})

beforeEach(async () => {
  await db.pool.query(`DELETE FROM task_worklogs`)
  await db.pool.query(`DELETE FROM audit_log WHERE table_name = 'task_worklogs'`)
})

const baseRow = {
  get task_id() { return taskId },
  agent_slug: 'murphy',
  actor_type: 'agent' as const,
  minutes: 42.5,
  worked_on: '2026-10-30',
  category: 'BE' as const,
  billable: true,
  note: 'wired the endpoint',
}

describe('insertHumanWorklog', () => {
  it('writes a source=human row with the expected columns', async () => {
    const tx = await db.pool.connect()
    try {
      await tx.query('BEGIN')
      const row = await insertHumanWorklog(tx, baseRow)
      await tx.query('COMMIT')

      expect(row.source).toBe('human')
      expect(row.minutes).toBe('42.50')
      expect(row.worked_on).toBe('2026-10-30')
      expect(row.actor_type).toBe('agent')
      expect(row.category).toBe('BE')
      expect(row.billable).toBe(true)
      expect(row.note).toBe('wired the endpoint')
    } finally {
      tx.release()
    }
  })

  it('attributes the audit INSERT to the caller slug', async () => {
    const tx = await db.pool.connect()
    let id: number
    try {
      await tx.query('BEGIN')
      await tx.query(`SET LOCAL hive.actor = 'murphy'`)
      const row = await insertHumanWorklog(tx, baseRow)
      id = row.id
      await tx.query('COMMIT')
    } finally {
      tx.release()
    }

    const audit = await db.pool.query<{ action: string; actor: string }>(
      `SELECT action, actor FROM audit_log
        WHERE table_name = 'task_worklogs' AND row_id::text = $1::text`,
      [String(id)],
    )
    expect(audit.rows).toEqual([{ action: 'INSERT', actor: 'murphy' }])
  })

  it('rejects a zero-minute entry at the DB', async () => {
    await expect(
      db.pool.query(
        `INSERT INTO task_worklogs (task_id, agent_slug, source, actor_type, minutes, worked_on, category)
         VALUES ($1, 'murphy', 'human', 'agent', 0, '2026-10-30', 'BE')`,
        [taskId],
      ),
    ).rejects.toThrow(/chk_task_worklogs_minutes|minutes/)
  })

  it('rejects an unknown category at the DB', async () => {
    await expect(
      db.pool.query(
        `INSERT INTO task_worklogs (task_id, agent_slug, source, actor_type, minutes, worked_on, category)
         VALUES ($1, 'murphy', 'human', 'agent', 10, '2026-10-30', 'XX')`,
        [taskId],
      ),
    ).rejects.toThrow(/chk_task_worklogs_category/)
  })

  it('rejects a human row missing actor_type or category', async () => {
    await expect(
      db.pool.query(
        `INSERT INTO task_worklogs (task_id, agent_slug, source, minutes, worked_on)
         VALUES ($1, 'murphy', 'human', 10, '2026-10-30')`,
        [taskId],
      ),
    ).rejects.toThrow(/chk_task_worklogs_manual_fields/)
  })

  it('rejects a human row that carries a session_id (027 contract)', async () => {
    await expect(
      db.pool.query(
        `INSERT INTO task_worklogs (task_id, agent_slug, source, actor_type, minutes, worked_on, category, session_id)
         VALUES ($1, 'murphy', 'human', 'agent', 10, '2026-10-30', 'BE', 'sess-1')`,
        [taskId],
      ),
    ).rejects.toThrow(/chk_task_worklogs_session/)
  })

  it('rejects a note over 500 characters at the DB', async () => {
    await expect(
      db.pool.query(
        `INSERT INTO task_worklogs (task_id, agent_slug, source, actor_type, minutes, worked_on, category, note)
         VALUES ($1, 'murphy', 'human', 'agent', 10, '2026-10-30', 'BE', $2)`,
        [taskId, 'x'.repeat(501)],
      ),
    ).rejects.toThrow(/chk_task_worklogs_note/)
  })

  it('keeps auto rows valid under the 028 constraints', async () => {
    await db.pool.query(
      `INSERT INTO task_worklogs (task_id, agent_slug, source, minutes, worked_on, session_id)
       VALUES ($1, 'murphy', 'auto', 15, '2026-10-30', 'sess-auto')`,
      [taskId],
    )
    const res = await db.pool.query<{ actor_type: string | null; category: string | null; billable: boolean }>(
      `SELECT actor_type, category, billable FROM task_worklogs WHERE source = 'auto'`,
    )
    expect(res.rows).toEqual([{ actor_type: null, category: null, billable: true }])
  })
})
