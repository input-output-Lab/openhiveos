import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool, type PoolClient } from 'pg'
import { createTestDb, insertAgent, type TestDb } from '../helpers/db.js'

// ---------------------------------------------------------------------------
// S19-ARCH-01c (#2776) — migration 032 + the fail-closed step-up gate,
// on a real Postgres (testcontainers, full migration chain incl. 031+032).
//
// Gate matrix (ARCH-028 Decision 3):
//   - gated role (approver) + NO callback       → step_up_required, no write
//   - gated role + callback denies              → step_up_denied, no write
//   - gated role + callback approves            → transition proceeds; history
//     row carries step_up_user + auth_strength='session'
//   - non-gated roles (assignee/owner) proceed with NO callback (unchanged)
//   - history rows from non-step-up transitions keep step_up_user NULL
//
// Pool injection — same pattern as identity-audit-columns.integration.test.ts.
// ---------------------------------------------------------------------------
let clientPool: Pool | undefined
vi.mock('../../src/db/client.js', () => ({
  get pool() { return clientPool },
  withActor: (
    actorSlug: string,
    fn: (tx: PoolClient) => Promise<unknown>,
    identity?: { claimedPersona?: string | null; authStrength?: string; stepUpUser?: string },
  ) => testWithActor(clientPool!, actorSlug, fn, identity),
}))

import type { PoolClient as PC } from 'pg'
import { handleUpdateTask } from '../../src/utilities/update-task.js'

async function testWithActor<T>(
  pool: Pool,
  actorSlug: string,
  fn: (tx: PC) => Promise<T>,
  identity?: { claimedPersona?: string | null; authStrength?: string; stepUpUser?: string },
): Promise<T> {
  if (!/^(system:[a-z0-9_-]+|[a-z][a-z0-9_-]*)$/.test(actorSlug)) {
    throw new Error('[db] withActor: invalid actor slug format')
  }
  const claim = identity?.claimedPersona
  if (claim !== undefined && claim !== null && !/^[a-z][a-z0-9_-]{0,63}$/.test(claim)) {
    throw new Error('[db] withActor: invalid claimed persona format')
  }
  const strength = identity?.authStrength
  if (strength !== undefined && !['bearer', 'shared_token', 'dev', 'session', 'unverified'].includes(strength)) {
    throw new Error('[db] withActor: invalid auth strength')
  }
  const stepUpUser = identity?.stepUpUser
  if (stepUpUser !== undefined && (stepUpUser.length < 1 || stepUpUser.length > 64 || /\s/.test(stepUpUser))) {
    throw new Error('[db] withActor: invalid step-up user')
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL hive.actor = '${actorSlug}'`)
    if (claim) await client.query(`SET LOCAL hive.claimed_persona = '${claim}'`)
    if (strength) await client.query(`SET LOCAL hive.auth_strength = '${strength}'`)
    if (stepUpUser) await client.query(`SET LOCAL hive.step_up_user = '${stepUpUser}'`)
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

// Production-shaped fixture (mirrors project 70): elizabeth owns the project
// → resolveApprover yields 'nova' (D5) — and getTaskForActor grants nova
// approver visibility ONLY on elizabeth-owned projects, so this is the
// arrangement the gate must serve.
const OWNER = 'elizabeth'
const ASSIGNEE = 'murphy'
const APPROVER = 'nova'

beforeAll(async () => {
  db = await createTestDb()
  clientPool = db.pool

  await insertAgent(db.pool, OWNER, 'Elizabeth')
  await insertAgent(db.pool, ASSIGNEE, 'Murphy')
  await insertAgent(db.pool, APPROVER, 'Nova')

  // Production-shaped project: owned by elizabeth → approver is nova.
  const proj = await db.pool.query<{ id: number }>(
    `INSERT INTO projects (slug, name, owner_agent_slug)
     VALUES ('stepup-gate-project', 'Step-up Gate Project', $1)
     ON CONFLICT (slug) DO UPDATE SET owner_agent_slug = EXCLUDED.owner_agent_slug
     RETURNING id`,
    [OWNER],
  )
  projectId = proj.rows[0]!.id
}, 90_000)

afterAll(async () => {
  await db.teardown()
})

beforeEach(async () => {
  await db.cleanTasks()
})

/** Create a task already at pending-close so the next legal step is approver done. */
async function createPendingCloseTask(): Promise<number> {
  const r = await db.pool.query<{ id: number }>(
    `INSERT INTO tasks (project_id, title, status, assignee_agent_slug, estimated_hours, billing_low, billing_high, estimate_confidence)
     VALUES ($1, 'Step-up gate test', 'review', $2, 1, 0.5, 1.5, 'high')
     RETURNING id`,
    [projectId, ASSIGNEE],
  )
  const id = Number(r.rows[0]!.id)
  await db.pool.query(`UPDATE tasks SET status = 'pending-close', updated_at = now() WHERE id = $1`, [id])
  return id
}

/** Walk murphy through todo→wip→review→(reviewer)pending-close as elizabeth-owner transitions are owner rows. Simpler: seed at pending-close. */
async function latestHistory(taskId: number): Promise<{
  to_status: string
  changed_by: string | null
  claimed_persona: string | null
  auth_strength: string | null
  step_up_user: string | null
}> {
  const r = await db.pool.query<{
    to_status: string
    changed_by: string | null
    claimed_persona: string | null
    auth_strength: string | null
    step_up_user: string | null
  }>(
    `SELECT to_status, changed_by, claimed_persona, auth_strength, step_up_user
       FROM task_status_history
      WHERE task_id = $1
      ORDER BY changed_at DESC, id DESC
      LIMIT 1`,
    [taskId],
  )
  return r.rows[0]!
}

async function currentStatus(taskId: number): Promise<string> {
  const r = await db.pool.query<{ status: string }>(`SELECT status FROM tasks WHERE id = $1`, [taskId])
  return r.rows[0]!.status
}

describe('S19-ARCH-01c: step-up gate (real DB)', () => {
  it('gated role + NO callback → step_up_required, nothing written', async () => {
    const id = await createPendingCloseTask()

    const result = await handleUpdateTask({ task_id: id, status: 'done' }, APPROVER)
    expect(result).toMatchObject({ error: 'step_up_required' })
    expect(await currentStatus(id)).toBe('pending-close')
  })

  it('gated role + callback denial → step_up_denied, nothing written', async () => {
    const id = await createPendingCloseTask()

    const result = await handleUpdateTask(
      { task_id: id, status: 'done' },
      APPROVER,
      undefined,
      async () => ({ approved: false, stepUpUser: '', reason: 'human declined' }),
    )
    expect(result).toMatchObject({ error: 'step_up_denied' })
    expect(await currentStatus(id)).toBe('pending-close')
  })

  it('gated role + callback approval → done, history row carries step_up_user + session strength', async () => {
    const id = await createPendingCloseTask()

    const result = await handleUpdateTask(
      { task_id: id, status: 'done' },
      APPROVER,
      undefined,
      async () => ({ approved: true, stepUpUser: 'richo', reason: 'human approved via elicitation' }),
    )
    expect(result).not.toHaveProperty('error')
    expect(await currentStatus(id)).toBe('done')

    const row = await latestHistory(id)
    expect(row.to_status).toBe('done')
    expect(row.changed_by).toBe(APPROVER) // matrix keys on the agent
    expect(row.auth_strength).toBe('session') // reserved by 031, emitted here
    expect(row.step_up_user).toBe('richo')
  })

  it('non-gated roles proceed without a callback and keep step_up_user NULL', async () => {
    const r = await db.pool.query<{ id: number }>(
      `INSERT INTO tasks (project_id, title, status, assignee_agent_slug, estimated_hours, billing_low, billing_high, estimate_confidence)
       VALUES ($1, 'Ungated walk', 'todo', $2, 1, 0.5, 1.5, 'high') RETURNING id`,
      [projectId, ASSIGNEE],
    )
    const id = Number(r.rows[0]!.id)

    const result = await handleUpdateTask({ task_id: id, status: 'wip' }, ASSIGNEE)
    expect(result).not.toHaveProperty('error')

    const row = await latestHistory(id)
    expect(row.to_status).toBe('wip')
    expect(row.step_up_user).toBeNull()
    expect(row.auth_strength).toBeNull() // no identity ctx supplied
  })

  it('withActor rejects a malformed step-up user before any SQL runs', async () => {
    const id = await createPendingCloseTask()
    await expect(
      testWithActor(db.pool, APPROVER, (tx) => tx.query(`SELECT 1`), { stepUpUser: 'has spaces' }),
    ).rejects.toThrow('invalid step-up user')
    expect(await currentStatus(id)).toBe('pending-close')
  })

  it('migration 032 CHECK rejects out-of-domain step_up_user values', async () => {
    const id = await createPendingCloseTask()
    await expect(
      db.pool.query(
        `INSERT INTO task_status_history (task_id, from_status, to_status, changed_by, step_up_user)
         VALUES ($1, 'pending-close', 'done', 'nova', 'has space')`,
        [id],
      ),
    ).rejects.toThrow()
  })
})
