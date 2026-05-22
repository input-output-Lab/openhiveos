/**
 * tests/db/queries/crons.test.ts
 *
 * Integration tests for src/db/queries/crons.ts — CRUD functions only.
 * getDueCrons and markCronFired are already covered in crons-worker.test.ts.
 *
 * Coverage targets (S7-07):
 *   createCron  — authorized, unauthorized
 *   queryCrons  — no filters, project_id, status, owner_agent_slug, soft-delete default
 *   updateCron  — success, not_found_or_unauthorized
 *   deleteCron  — success, already_deleted, not_found_or_unauthorized
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { createTestDb, type TestDb } from '../../helpers/db.js'

let clientPool: Pool | undefined
vi.mock('../../../src/db/client.js', () => ({
  get pool() { return clientPool },
}))

import {
  createCron,
  queryCrons,
  updateCron,
  deleteCron,
} from '../../../src/db/queries/crons.js'

let db: TestDb
let projectId: number
const OWNER = 'test-agent'
const OTHER = 'other-agent'
const SCHEDULE = '* * * * *'
const TOOL = 'query_tasks'

beforeAll(async () => {
  db = await createTestDb()
  clientPool = db.pool

  await db.pool.query(`
    INSERT INTO agents (slug, display_name, token_hash, token_salt)
    VALUES ($1, 'Other Agent', 'other-hash-crons', 'other-salt-c')
    ON CONFLICT (slug) DO NOTHING
  `, [OTHER])

  const row = await db.pool.query<{ id: number }>(
    `SELECT id FROM projects WHERE slug = 'test-project'`,
  )
  projectId = row.rows[0]!.id
}, 90_000)

afterAll(async () => {
  await db.teardown()
})

beforeEach(async () => {
  await db.cleanCrons()
})

// ---------------------------------------------------------------------------
// createCron
// ---------------------------------------------------------------------------

describe('createCron', () => {
  it('TC-C1: inserts and returns cron when caller owns the project', async () => {
    const result = await createCron({
      project_id: projectId,
      owner_agent_slug: OWNER,
      name: 'Daily sync',
      schedule: SCHEDULE,
      tool_name: TOOL,
    })

    expect(result.authorized).toBe(true)
    if (!result.authorized) throw new Error('should be authorized')
    expect(result.cron.name).toBe('Daily sync')
    expect(result.cron.status).toBe('active')
    expect(result.cron.project_id).toBe(projectId)
    expect(result.cron.owner_agent_slug).toBe(OWNER)
  })

  it('TC-C2: returns { authorized: false } when caller does not own the project', async () => {
    const result = await createCron({
      project_id: projectId,
      owner_agent_slug: OTHER,
      name: 'Should fail',
      schedule: SCHEDULE,
      tool_name: TOOL,
    })

    expect(result.authorized).toBe(false)
  })

  it('TC-C3: persists optional payload', async () => {
    const payload = { key: 'value', count: 3 }
    const result = await createCron({
      project_id: projectId,
      owner_agent_slug: OWNER,
      name: 'With payload',
      schedule: SCHEDULE,
      tool_name: TOOL,
      payload,
    })

    expect(result.authorized).toBe(true)
    if (!result.authorized) throw new Error('should be authorized')
    expect(result.cron.payload).toMatchObject(payload)
  })
})

// ---------------------------------------------------------------------------
// queryCrons
// ---------------------------------------------------------------------------

describe('queryCrons', () => {
  beforeEach(async () => {
    // Seed: 2 active crons owned by OWNER, 1 paused, 1 deleted
    const r1 = await createCron({
      project_id: projectId,
      owner_agent_slug: OWNER,
      name: 'Active 1',
      schedule: SCHEDULE,
      tool_name: TOOL,
    })
    const r2 = await createCron({
      project_id: projectId,
      owner_agent_slug: OWNER,
      name: 'Active 2',
      schedule: SCHEDULE,
      tool_name: TOOL,
    })
    const r3 = await createCron({
      project_id: projectId,
      owner_agent_slug: OWNER,
      name: 'Paused',
      schedule: SCHEDULE,
      tool_name: TOOL,
    })

    if (!r1.authorized || !r2.authorized || !r3.authorized) {
      throw new Error('setup: createCron failed')
    }

    // Soft-delete r2 and pause r3 directly via pool
    await db.pool.query(
      `UPDATE crons SET status = 'deleted' WHERE id = $1`,
      [r2.cron.id],
    )
    await db.pool.query(
      `UPDATE crons SET status = 'paused' WHERE id = $1`,
      [r3.cron.id],
    )
  })

  it('TC-C4: returns only non-deleted crons when no status filter', async () => {
    const crons = await queryCrons({})
    expect(crons.every(c => c.status !== 'deleted')).toBe(true)
    expect(crons).toHaveLength(2) // Active 1 + Paused
  })

  it('TC-C5: returns deleted crons when status=deleted is passed', async () => {
    const deleted = await queryCrons({ status: 'deleted' })
    expect(deleted.every(c => c.status === 'deleted')).toBe(true)
    expect(deleted).toHaveLength(1)
  })

  it('TC-C6: filters by project_id', async () => {
    const crons = await queryCrons({ project_id: projectId })
    expect(crons.length).toBeGreaterThanOrEqual(1)
    expect(crons.every(c => c.project_id === projectId)).toBe(true)
  })

  it('TC-C7: filters by owner_agent_slug', async () => {
    const crons = await queryCrons({ owner_agent_slug: OWNER })
    expect(crons.every(c => c.owner_agent_slug === OWNER)).toBe(true)
  })

  it('TC-C8: filters by status=paused', async () => {
    const paused = await queryCrons({ status: 'paused' })
    expect(paused.every(c => c.status === 'paused')).toBe(true)
    expect(paused).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// updateCron
// ---------------------------------------------------------------------------

describe('updateCron', () => {
  let cronId: number

  beforeEach(async () => {
    const result = await createCron({
      project_id: projectId,
      owner_agent_slug: OWNER,
      name: 'Updatable cron',
      schedule: SCHEDULE,
      tool_name: TOOL,
    })
    if (!result.authorized) throw new Error('setup: createCron failed')
    cronId = result.cron.id
  })

  it('TC-C9: updates name and returns success', async () => {
    const result = await updateCron({
      id: cronId,
      owner_agent_slug: OWNER,
      name: 'Renamed cron',
    })

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') throw new Error('unexpected kind')
    expect(result.cron.name).toBe('Renamed cron')
    expect(result.cron.id).toBe(cronId)
  })

  it('TC-C10: returns not_found_or_unauthorized when caller is not the owner', async () => {
    const result = await updateCron({
      id: cronId,
      owner_agent_slug: OTHER,
      name: 'Should fail',
    })

    expect(result.kind).toBe('not_found_or_unauthorized')
  })

  it('TC-C11: returns not_found_or_unauthorized for non-existent id', async () => {
    const result = await updateCron({
      id: 999999,
      owner_agent_slug: OWNER,
      name: 'Ghost cron',
    })

    expect(result.kind).toBe('not_found_or_unauthorized')
  })
})

// ---------------------------------------------------------------------------
// deleteCron
// ---------------------------------------------------------------------------

describe('deleteCron', () => {
  let cronId: number

  beforeEach(async () => {
    const result = await createCron({
      project_id: projectId,
      owner_agent_slug: OWNER,
      name: 'Deletable cron',
      schedule: SCHEDULE,
      tool_name: TOOL,
    })
    if (!result.authorized) throw new Error('setup: createCron failed')
    cronId = result.cron.id
  })

  it('TC-C12: soft-deletes and returns success', async () => {
    const result = await deleteCron({ id: cronId, owner_agent_slug: OWNER })

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') throw new Error('unexpected kind')
    expect(result.cron.status).toBe('deleted')
    expect(result.cron.id).toBe(cronId)
  })

  it('TC-C13: returns already_deleted when cron is already soft-deleted', async () => {
    await deleteCron({ id: cronId, owner_agent_slug: OWNER })
    const result = await deleteCron({ id: cronId, owner_agent_slug: OWNER })

    expect(result.kind).toBe('already_deleted')
  })

  it('TC-C14: returns not_found_or_unauthorized when caller is not the owner', async () => {
    const result = await deleteCron({ id: cronId, owner_agent_slug: OTHER })

    expect(result.kind).toBe('not_found_or_unauthorized')
  })

  it('TC-C15: returns not_found_or_unauthorized for non-existent id', async () => {
    const result = await deleteCron({ id: 999999, owner_agent_slug: OWNER })

    expect(result.kind).toBe('not_found_or_unauthorized')
  })
})
