import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { createTestDb, insertAgent, type TestDb } from '../helpers/db.js'

// ---------------------------------------------------------------------------
// S19-ARCH-01a (#2774) — migration 031 integration tests on a real Postgres
// (testcontainers, full migration chain incl. 031). Verifies:
//   1. withActor(identity) → trigger writes claimed_persona + auth_strength
//      onto task_status_history rows.
//   2. Omitted identity → columns stay NULL (cron/system transitions
//      unaffected — back-compat with every existing call site).
//   3. withActor rejects malformed identity values BEFORE any SQL runs.
//   4. The CHECK constraint domains match what the app emits.
//   5. handleUpdateTask end-to-end: the tool layer's identity reaches the
//      history row.
//   6. Rollback restores the 024 trigger so transitions keep recording after
//      a rollback (ordering guarantee: function restore BEFORE column drop).
//
// Pool injection — same pattern as task-aging.integration.test.ts: the
// production module closes over its own module-level pool, so withActor is
// re-bound to the test pool here (real validation + SET LOCAL chain copied
// so the rejection tests exercise the actual guard logic).
let clientPool: Pool | undefined
vi.mock('../../src/db/client.js', () => ({
  get pool() { return clientPool },
  withActor: (
    actorSlug: string,
    fn: (tx: PoolClient) => Promise<unknown>,
    identity?: { claimedPersona?: string | null; authStrength?: string },
  ) => testWithActor(clientPool!, actorSlug, fn, identity),
}))

import type { PoolClient } from 'pg'
import { handleUpdateTask } from '../../src/utilities/update-task.js'

// Real withActor logic bound to the test pool (mirrors src/db/client.ts,
// including the identity guards added in S19-ARCH-01a).
async function testWithActor<T>(
  pool: Pool,
  actorSlug: string,
  fn: (tx: PoolClient) => Promise<T>,
  identity?: { claimedPersona?: string | null; authStrength?: string },
): Promise<T> {
  if (!/^(system:[a-z0-9_-]+|[a-z][a-z0-9_-]*)$/.test(actorSlug)) {
    throw new Error('[db] withActor: invalid actor slug format')
  }
  const claim = identity?.claimedPersona
  if (claim !== undefined && claim !== null && !/^[a-z][a-z0-9_-]{0,63}$/.test(claim)) {
    throw new Error('[db] withActor: invalid claimed persona format')
  }
  const strength = identity?.authStrength
  if (
    strength !== undefined &&
    !['bearer', 'shared_token', 'dev', 'session', 'unverified'].includes(strength)
  ) {
    throw new Error('[db] withActor: invalid auth strength')
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL hive.actor = '${actorSlug}'`)
    if (claim) await client.query(`SET LOCAL hive.claimed_persona = '${claim}'`)
    if (strength) await client.query(`SET LOCAL hive.auth_strength = '${strength}'`)
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
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations')

beforeAll(async () => {
  db = await createTestDb()
  clientPool = db.pool

  await insertAgent(db.pool, 'elizabeth', 'Elizabeth')
  await insertAgent(db.pool, 'murphy', 'Murphy')

  const proj = await db.pool.query<{ id: number }>(`SELECT id FROM projects WHERE slug = 'test-project'`)
  projectId = proj.rows[0]!.id
}, 90_000)

afterAll(async () => {
  await db.teardown()
})

beforeEach(async () => {
  await db.cleanTasks()
})

/** Latest history row for a task. */
async function latestHistory(taskId: number): Promise<{
  to_status: string
  changed_by: string | null
  claimed_persona: string | null
  auth_strength: string | null
}> {
  const r = await db.pool.query<{
    to_status: string
    changed_by: string | null
    claimed_persona: string | null
    auth_strength: string | null
  }>(
    `SELECT to_status, changed_by, claimed_persona, auth_strength
       FROM task_status_history
      WHERE task_id = $1
      ORDER BY changed_at DESC, id DESC
      LIMIT 1`,
    [taskId],
  )
  return r.rows[0]!
}

async function createTask(assignee: string): Promise<number> {
  const r = await db.pool.query<{ id: number }>(
    `INSERT INTO tasks (project_id, title, status, assignee_agent_slug, estimated_hours, billing_low, billing_high, estimate_confidence)
     VALUES ($1, 'Identity audit test task', 'todo', $2, 1, 0.5, 1.5, 'high')
     RETURNING id`,
    [projectId, assignee],
  )
  return Number(r.rows[0]!.id)
}

describe('S19-ARCH-01a: identity audit columns (real DB)', () => {
  it('withActor with identity writes claimed_persona + auth_strength on the transition row', async () => {
    const taskId = await createTask('murphy')

    await testWithActor(
      db.pool,
      'murphy',
      (tx) =>
        tx.query(`UPDATE tasks SET status = 'wip', updated_at = now() WHERE id = $1`, [taskId]),
      { claimedPersona: 'murphy', authStrength: 'bearer' },
    )

    const row = await latestHistory(taskId)
    expect(row.to_status).toBe('wip')
    expect(row.changed_by).toBe('murphy')
    expect(row.claimed_persona).toBe('murphy')
    expect(row.auth_strength).toBe('bearer')
  })

  it('omitted identity leaves both columns NULL (cron/system path unaffected)', async () => {
    const taskId = await createTask('murphy')

    await testWithActor(db.pool, 'system:aging', (tx) =>
      tx.query(`UPDATE tasks SET status = 'done', resolution = 'auto_closed', updated_at = now() WHERE id = $1`, [taskId]),
    )

    const row = await latestHistory(taskId)
    expect(row.changed_by).toBe('system:aging')
    expect(row.claimed_persona).toBeNull()
    expect(row.auth_strength).toBeNull()
  })

  it('rejects a malformed persona claim before any SQL runs', async () => {
    const taskId = await createTask('murphy')

    await expect(
      testWithActor(
        db.pool,
        'murphy',
        (tx) => tx.query(`UPDATE tasks SET status = 'wip' WHERE id = $1`, [taskId]),
        { claimedPersona: 'Bad Slug; DROP TABLE agents', authStrength: 'bearer' },
      ),
    ).rejects.toThrow('invalid claimed persona format')

    // Nothing was written: the throw happens in the argument guard, before
    // BEGIN — no transaction ever opened.
    const after = await db.pool.query<{ status: string }>(
      `SELECT status FROM tasks WHERE id = $1`,
      [taskId],
    )
    expect(after.rows[0]!.status).toBe('todo')
  })

  it('rejects an auth strength outside the CHECK domain', async () => {
    const taskId = await createTask('murphy')
    await expect(
      testWithActor(
        db.pool,
        'murphy',
        (tx) => tx.query(`UPDATE tasks SET status = 'wip' WHERE id = $1`, [taskId]),
        { authStrength: 'root' },
      ),
    ).rejects.toThrow('invalid auth strength')
  })

  it('CHECK constraint rejects out-of-domain values written directly', async () => {
    const taskId = await createTask('murphy')
    await expect(
      db.pool.query(
        `INSERT INTO task_status_history (task_id, from_status, to_status, changed_by, claimed_persona, auth_strength)
         VALUES ($1, 'todo', 'wip', 'murphy', 'murphy', 'telepathy')`,
        [taskId],
      ),
    ).rejects.toThrow()
  })

  it('handleUpdateTask end-to-end: transition row carries the identity from the tool layer', async () => {
    const taskId = await createTask('murphy')

    // Legal assignee walk: todo → wip → review (todo → review is matrix-invalid).
    const r1 = await handleUpdateTask(
      { task_id: taskId, status: 'wip' },
      'murphy',
      { claimedPersona: 'murphy', authStrength: 'bearer' },
    )
    expect(r1).not.toHaveProperty('error')

    const result = await handleUpdateTask(
      { task_id: taskId, status: 'review' },
      'murphy',
      { claimedPersona: 'murphy', authStrength: 'bearer' },
    )
    expect(result).not.toHaveProperty('error')

    const row = await latestHistory(taskId)
    expect(row.to_status).toBe('review')
    expect(row.claimed_persona).toBe('murphy')
    expect(row.auth_strength).toBe('bearer')
  })

  it('tool_invocations accepts the new columns with the same domains', async () => {
    await db.pool.query(
      `INSERT INTO tool_invocations (agent_slug, tool_name, transport, claimed_persona, auth_strength)
       VALUES ('murphy', 'update_task', 'streamable_http', 'murphy', 'bearer')`,
    )
    const r = await db.pool.query<{ claimed_persona: string | null; auth_strength: string | null }>(
      `SELECT claimed_persona, auth_strength FROM tool_invocations WHERE agent_slug = 'murphy' ORDER BY id DESC LIMIT 1`,
    )
    expect(r.rows[0]).toEqual({ claimed_persona: 'murphy', auth_strength: 'bearer' })
  })

  it('rollback restores the 024 trigger and transitions keep recording', async () => {
    // Apply the rollback, verify the trigger still writes history (without
    // identity columns), then re-apply 031 so later tests see the full chain.
    const rollbackSql = await readFile(join(MIGRATIONS_DIR, 'rollback_031_identity_audit_columns.sql'), 'utf8')
    const forwardSql = await readFile(join(MIGRATIONS_DIR, '031_identity_audit_columns.sql'), 'utf8')

    await db.pool.query(rollbackSql)

    const taskId = await createTask('murphy')
    await testWithActor(db.pool, 'murphy', (tx) =>
      tx.query(`UPDATE tasks SET status = 'wip', updated_at = now() WHERE id = $1`, [taskId]),
    )
    // While rolled back, the identity columns are gone — query only the
    // columns the restored 024 trigger writes. The transition itself must
    // still be recorded (that's the ordering guarantee under test).
    const restored = await db.pool.query<{ to_status: string; changed_by: string | null }>(
      `SELECT to_status, changed_by FROM task_status_history
        WHERE task_id = $1 ORDER BY changed_at DESC, id DESC LIMIT 1`,
      [taskId],
    )
    expect(restored.rows[0]!.to_status).toBe('wip')
    expect(restored.rows[0]!.changed_by).toBe('murphy')

    // Re-apply 031: columns return and the trigger writes identity again.
    await db.pool.query(forwardSql)
    await testWithActor(
      db.pool,
      'murphy',
      (tx) => tx.query(`UPDATE tasks SET status = 'review', updated_at = now() WHERE id = $1`, [taskId]),
      { claimedPersona: 'murphy', authStrength: 'bearer' },
    )
    const row = await latestHistory(taskId)
    expect(row.to_status).toBe('review')
    expect(row.claimed_persona).toBe('murphy')
    expect(row.auth_strength).toBe('bearer')
  })
})
