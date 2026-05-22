/**
 * tests/db/queries/projects.test.ts
 *
 * Integration tests for src/db/queries/projects.ts.
 * Uses the same vi.mock pool injection pattern as tasks.test.ts.
 *
 * Coverage targets (S7-07):
 *   createProject   — success, duplicate slug (unique constraint)
 *   updateProject   — authorized partial update, unauthorized (wrong owner → undefined)
 *   queryProjects   — no filters, status filter, owner_agent_slug filter
 *   getProjectBoard — found (no tasks), found (with tasks), not found / wrong owner
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { createTestDb, type TestDb } from '../../helpers/db.js'

let clientPool: Pool | undefined
vi.mock('../../../src/db/client.js', () => ({
  get pool() { return clientPool },
}))

import {
  createProject,
  updateProject,
  queryProjects,
  getProjectBoard,
} from '../../../src/db/queries/projects.js'

let db: TestDb
const OWNER = 'test-agent'
const OTHER = 'other-agent'
let testProjectId: number

beforeAll(async () => {
  db = await createTestDb()
  clientPool = db.pool

  await db.pool.query(`
    INSERT INTO agents (slug, display_name, token_hash, token_salt)
    VALUES ($1, 'Other Agent', 'other-hash-projects', 'other-salt-p')
    ON CONFLICT (slug) DO NOTHING
  `, [OTHER])

  const row = await db.pool.query<{ id: number }>(
    `SELECT id FROM projects WHERE slug = 'test-project'`,
  )
  testProjectId = row.rows[0]!.id
}, 90_000)

afterAll(async () => {
  await db.teardown()
})

beforeEach(async () => {
  // Remove any projects added during tests (keep the seed test-project)
  await db.pool.query(`DELETE FROM projects WHERE slug != 'test-project'`)
})

// ---------------------------------------------------------------------------
// createProject
// ---------------------------------------------------------------------------

describe('createProject', () => {
  it('TC-P1: inserts and returns a new project', async () => {
    const project = await createProject({
      slug: 'new-project',
      name: 'New Project',
      owner_agent_slug: OWNER,
    })

    expect(project.slug).toBe('new-project')
    expect(project.name).toBe('New Project')
    expect(project.owner_agent_slug).toBe(OWNER)
    expect(project.status).toBe('active')
    expect(Number(project.id)).toBeGreaterThan(0)
  })

  it('TC-P2: persists optional description', async () => {
    const project = await createProject({
      slug: 'with-desc',
      name: 'Described Project',
      description: 'A helpful description',
      owner_agent_slug: OWNER,
    })

    expect(project.description).toBe('A helpful description')
  })

  it('TC-P3: throws on duplicate slug (unique constraint)', async () => {
    await createProject({ slug: 'dup-slug', name: 'First', owner_agent_slug: OWNER })

    await expect(
      createProject({ slug: 'dup-slug', name: 'Second', owner_agent_slug: OWNER }),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// updateProject
// ---------------------------------------------------------------------------

describe('updateProject', () => {
  it('TC-P4: owner can update name and status', async () => {
    const updated = await updateProject({
      project_id: testProjectId,
      owner_agent_slug: OWNER,
      name: 'Renamed Project',
      status: 'archived',
    })

    expect(updated).toBeDefined()
    expect(updated!.name).toBe('Renamed Project')
    expect(updated!.status).toBe('archived')

    // Restore for other tests
    await updateProject({
      project_id: testProjectId,
      owner_agent_slug: OWNER,
      name: 'Test Project',
      status: 'active',
    })
  })

  it('TC-P5: returns undefined when caller does not own the project', async () => {
    const updated = await updateProject({
      project_id: testProjectId,
      owner_agent_slug: OTHER,
      name: 'Unauthorised rename',
    })

    expect(updated).toBeUndefined()
  })

  it('TC-P6: partial update — description only', async () => {
    const updated = await updateProject({
      project_id: testProjectId,
      owner_agent_slug: OWNER,
      description: 'Updated description',
    })

    expect(updated).toBeDefined()
    expect(updated!.description).toBe('Updated description')
    expect(updated!.name).toBe('Test Project') // unchanged
  })
})

// ---------------------------------------------------------------------------
// queryProjects
// ---------------------------------------------------------------------------

describe('queryProjects', () => {
  beforeEach(async () => {
    // Reset test-project status in case a previous test archived it
    await db.pool.query(
      `UPDATE projects SET status = 'active', name = 'Test Project', description = NULL WHERE id = $1`,
      [testProjectId],
    )
    // Add an extra project owned by OTHER for filter testing
    await db.pool.query(`
      INSERT INTO projects (slug, name, owner_agent_slug)
      VALUES ('other-project', 'Other Project', $1)
      ON CONFLICT (slug) DO NOTHING
    `, [OTHER])
  })

  it('TC-P7: returns all projects when no filters supplied', async () => {
    const projects = await queryProjects({})
    expect(projects.length).toBeGreaterThanOrEqual(2)
  })

  it('TC-P8: filters by status', async () => {
    // Archive test-project temporarily
    await db.pool.query(`UPDATE projects SET status = 'archived' WHERE id = $1`, [testProjectId])

    const archived = await queryProjects({ status: 'archived' })
    expect(archived.every(p => p.status === 'archived')).toBe(true)
    expect(archived.some(p => p.slug === 'test-project')).toBe(true)
  })

  it('TC-P9: filters by owner_agent_slug', async () => {
    const owned = await queryProjects({ owner_agent_slug: OTHER })
    expect(owned.every(p => p.owner_agent_slug === OTHER)).toBe(true)
    expect(owned.some(p => p.slug === 'other-project')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// getProjectBoard
// ---------------------------------------------------------------------------

describe('getProjectBoard', () => {
  it('TC-P10: returns board with zero task counts when project has no tasks', async () => {
    const board = await getProjectBoard({ slug: 'test-project', owner_agent_slug: OWNER })

    expect(board).toBeDefined()
    expect(board!.slug).toBe('test-project')
    expect(board!.todo_count).toBe(0)
    expect(board!.wip_count).toBe(0)
    expect(board!.tasks).toEqual([])
  })

  it('TC-P11: returns board with accurate task counts when tasks exist', async () => {
    // Seed some tasks
    await db.pool.query(`
      INSERT INTO tasks (project_id, title, status)
      VALUES
        ($1, 'Todo 1', 'todo'),
        ($1, 'Todo 2', 'todo'),
        ($1, 'Wip 1',  'wip')
    `, [testProjectId])

    const board = await getProjectBoard({ slug: 'test-project', owner_agent_slug: OWNER })

    expect(board!.todo_count).toBe(2)
    expect(board!.wip_count).toBe(1)
    expect(board!.tasks).toHaveLength(3)

    // Cleanup
    await db.pool.query(`DELETE FROM tasks`)
  })

  it('TC-P12: returns undefined for wrong owner', async () => {
    const board = await getProjectBoard({ slug: 'test-project', owner_agent_slug: OTHER })
    expect(board).toBeUndefined()
  })

  it('TC-P13: returns undefined for non-existent slug', async () => {
    const board = await getProjectBoard({ slug: 'no-such-project', owner_agent_slug: OWNER })
    expect(board).toBeUndefined()
  })
})
