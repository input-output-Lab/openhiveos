/**
 * tests/db/queries/sprints.test.ts
 *
 * Integration tests for src/db/queries/sprints.ts.
 *
 * Coverage targets (S7-07):
 *   querySprints — empty, one sprint, filter by project_id,
 *                  filter by sprint_number, cross-owner isolation
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { createTestDb, type TestDb } from '../../helpers/db.js'

let clientPool: Pool | undefined
vi.mock('../../../src/db/client.js', () => ({
  get pool() { return clientPool },
}))

import { querySprints } from '../../../src/db/queries/sprints.js'

let db: TestDb
let projectId: number
const OWNER = 'test-agent'
const OTHER = 'other-agent'

beforeAll(async () => {
  db = await createTestDb()
  clientPool = db.pool

  await db.pool.query(`
    INSERT INTO agents (slug, display_name, token_hash, token_salt)
    VALUES ($1, 'Other Agent', 'other-hash-sprints', 'other-salt-s')
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
  await db.pool.query(`DELETE FROM sprints`)
})

// ---------------------------------------------------------------------------
// querySprints
// ---------------------------------------------------------------------------

describe('querySprints', () => {
  it('TC-S1: returns empty array when no sprints exist', async () => {
    const sprints = await querySprints({}, OWNER)
    expect(sprints).toHaveLength(0)
  })

  it('TC-S2: returns sprints for the calling agent', async () => {
    await db.pool.query(
      `INSERT INTO sprints (project_id, sprint_number, sprint_goal) VALUES ($1, 1, 'Sprint 1')`,
      [projectId],
    )

    const sprints = await querySprints({}, OWNER)
    expect(sprints).toHaveLength(1)
    expect(sprints[0]!.sprint_number).toBe(1)
    expect(sprints[0]!.sprint_goal).toBe('Sprint 1')
    expect(sprints[0]!.project_id).toBe(projectId)
  })

  it('TC-S3: filters by project_id', async () => {
    await db.pool.query(
      `INSERT INTO sprints (project_id, sprint_number) VALUES ($1, 1)`,
      [projectId],
    )

    const sprints = await querySprints({ project_id: projectId }, OWNER)
    expect(sprints).toHaveLength(1)
    expect(sprints[0]!.project_id).toBe(projectId)
  })

  it('TC-S4: filters by sprint_number', async () => {
    await db.pool.query(
      `INSERT INTO sprints (project_id, sprint_number) VALUES ($1, 1), ($1, 2)`,
      [projectId],
    )

    const sprints = await querySprints({ sprint_number: 2 }, OWNER)
    expect(sprints).toHaveLength(1)
    expect(sprints[0]!.sprint_number).toBe(2)
  })

  it('TC-S5: cross-owner isolation — OTHER cannot see OWNER sprints', async () => {
    await db.pool.query(
      `INSERT INTO sprints (project_id, sprint_number) VALUES ($1, 1)`,
      [projectId],
    )

    const sprints = await querySprints({}, OTHER)
    expect(sprints).toHaveLength(0)
  })

  it('TC-S6: filters by project_id + sprint_number (2 filters)', async () => {
    await db.pool.query(
      `INSERT INTO sprints (project_id, sprint_number) VALUES ($1, 1), ($1, 2), ($1, 3)`,
      [projectId],
    )

    const sprints = await querySprints({ project_id: projectId, sprint_number: 1 }, OWNER)
    expect(sprints).toHaveLength(1)
    expect(sprints[0]!.sprint_number).toBe(1)
  })
})
