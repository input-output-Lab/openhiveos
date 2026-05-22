/**
 * tests/db/queries/tasks.test.ts
 *
 * Integration tests for src/db/queries/tasks.ts.
 * Runs against a real testcontainer (pgvector/pgvector:pg17) with the full
 * migration chain. The module-level `pool` from src/db/client.ts is replaced
 * with the testcontainer pool via vi.mock getter injection.
 *
 * Coverage targets (S7-07):
 *   createTask    — authorized, unauthorized (wrong owner)
 *   updateTask    — owner path, assignee path, unassign, unauthorized
 *   queryTasks    — 0 / 1 / 2 / 3 filter combinations + cross-owner isolation
 *   advanceSprint — unauthorized, first sprint (sprint_number=1), second sprint
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { createTestDb, type TestDb } from '../../helpers/db.js'

// ---------------------------------------------------------------------------
// Pool injection — vi.mock is hoisted before static imports.
// The getter evaluates lazily so clientPool (set in beforeAll) is available
// by the time any test function body runs.
// ---------------------------------------------------------------------------
let clientPool: Pool | undefined
vi.mock('../../../src/db/client.js', () => ({
  get pool() { return clientPool },
}))

import {
  createTask,
  updateTask,
  queryTasks,
  advanceSprint,
} from '../../../src/db/queries/tasks.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
let db: TestDb
let projectId: number
const OWNER = 'test-agent'
const OTHER = 'other-agent'

beforeAll(async () => {
  db = await createTestDb()
  clientPool = db.pool

  // Seed additional agents needed for FK constraints (assignee_agent_slug)
  await db.pool.query(`
    INSERT INTO agents (slug, display_name, token_hash, token_salt)
    VALUES
      ($1, 'Other Agent', 'other-hash-abc', 'other-salt'),
      ('murphy', 'Murphy', 'murphy-hash-abc', 'murphy-salt'),
      ('silas', 'Silas', 'silas-hash-abc', 'silas-salt')
    ON CONFLICT (slug) DO NOTHING
  `, [OTHER])

  // Fetch the test-project id
  const row = await db.pool.query<{ id: number }>(
    `SELECT id FROM projects WHERE slug = 'test-project'`,
  )
  projectId = row.rows[0]!.id
}, 90_000)

afterAll(async () => {
  await db.teardown()
})

beforeEach(async () => {
  // Hard-delete all tasks so each test starts clean
  await db.pool.query(`DELETE FROM tasks`)
  await db.pool.query(`DELETE FROM sprints`)
})

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------

describe('createTask', () => {
  it('TC-T1: returns authorized + task when caller owns the project', async () => {
    const result = await createTask({
      project_id: projectId,
      owner_agent_slug: OWNER,
      title: 'Write coverage tests',
    })

    expect(result.authorized).toBe(true)
    if (!result.authorized) throw new Error('should be authorized')
    expect(result.task.title).toBe('Write coverage tests')
    expect(result.task.status).toBe('todo')
    expect(result.task.project_id).toBe(projectId)
    expect(result.task.assignee_agent_slug).toBeNull()
  })

  it('TC-T2: returns { authorized: false } when caller does not own the project', async () => {
    const result = await createTask({
      project_id: projectId,
      owner_agent_slug: OTHER,  // not the owner of test-project
      title: 'Should be blocked',
    })

    expect(result.authorized).toBe(false)
  })

  it('TC-T3: persists optional fields (assignee, notes)', async () => {
    const result = await createTask({
      project_id: projectId,
      owner_agent_slug: OWNER,
      title: 'Assigned task',
      assignee_agent_slug: 'murphy',
      notes: 'important',
    })

    expect(result.authorized).toBe(true)
    if (!result.authorized) throw new Error('should be authorized')
    expect(result.task.assignee_agent_slug).toBe('murphy')
    expect(result.task.notes).toBe('important')
  })
})

// ---------------------------------------------------------------------------
// updateTask
// ---------------------------------------------------------------------------

describe('updateTask', () => {
  let taskId: number
  let assignedTaskId: number

  beforeEach(async () => {
    // Create a basic task owned by OWNER
    const t1 = await createTask({
      project_id: projectId,
      owner_agent_slug: OWNER,
      title: 'Base task',
    })
    if (!t1.authorized) throw new Error('setup: createTask failed')
    taskId = t1.task.id

    // Create a task assigned to OTHER so we can test the assignee path
    const t2 = await createTask({
      project_id: projectId,
      owner_agent_slug: OWNER,
      title: 'Assigned to other',
      assignee_agent_slug: OTHER,
    })
    if (!t2.authorized) throw new Error('setup: createTask (assignee) failed')
    assignedTaskId = t2.task.id
  })

  it('TC-T4: owner can update title (owner path)', async () => {
    const updated = await updateTask({
      task_id: taskId,
      owner_agent_slug: OWNER,
      title: 'Updated title',
    })

    expect(updated).toBeDefined()
    expect(updated!.title).toBe('Updated title')
    expect(updated!.status).toBe('todo') // unchanged
  })

  it('TC-T5: assignee can update status only (allowAssigneePath=true)', async () => {
    const updated = await updateTask({
      task_id: assignedTaskId,
      owner_agent_slug: OTHER,        // the assignee, not the project owner
      status: 'wip',
      allowAssigneePath: true,
    })

    expect(updated).toBeDefined()
    expect(updated!.status).toBe('wip')
  })

  it('TC-T6: unassign=true clears the assignee field', async () => {
    const updated = await updateTask({
      task_id: assignedTaskId,
      owner_agent_slug: OWNER,
      unassign: true,
    })

    expect(updated).toBeDefined()
    expect(updated!.assignee_agent_slug).toBeNull()
  })

  it('TC-T7: returns undefined when caller is not the owner and assignee path is disabled', async () => {
    const updated = await updateTask({
      task_id: taskId,
      owner_agent_slug: OTHER,        // neither owner nor valid assignee path
      title: 'Intruder update',
      allowAssigneePath: false,
    })

    expect(updated).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// queryTasks
// ---------------------------------------------------------------------------

describe('queryTasks', () => {
  beforeEach(async () => {
    // Seed 3 tasks: 2 TODO (different assignees), 1 WIP
    await db.pool.query(`
      INSERT INTO tasks (project_id, title, status, assignee_agent_slug)
      VALUES
        ($1, 'Task A', 'todo', 'murphy'),
        ($1, 'Task B', 'todo', 'silas'),
        ($1, 'Task C', 'wip', NULL)
    `, [projectId])
  })

  it('TC-T8: returns all tasks for owner with 0 filters', async () => {
    const tasks = await queryTasks({}, OWNER)
    expect(tasks).toHaveLength(3)
  })

  it('TC-T9: filters by project_id', async () => {
    const tasks = await queryTasks({ project_id: projectId }, OWNER)
    expect(tasks).toHaveLength(3)
  })

  it('TC-T10: filters by status', async () => {
    const tasks = await queryTasks({ status: 'wip' }, OWNER)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.status).toBe('wip')
  })

  it('TC-T11: filters by project_id + status (2 filters)', async () => {
    const tasks = await queryTasks({ project_id: projectId, status: 'todo' }, OWNER)
    expect(tasks).toHaveLength(2)
    expect(tasks.every(t => t.status === 'todo')).toBe(true)
  })

  it('TC-T12: filters by project_id + status + assignee (3 filters)', async () => {
    const tasks = await queryTasks(
      { project_id: projectId, status: 'todo', assignee_agent_slug: 'murphy' },
      OWNER,
    )
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.assignee_agent_slug).toBe('murphy')
  })

  it('TC-T13: cross-owner isolation — OTHER sees 0 tasks (different owner)', async () => {
    const tasks = await queryTasks({}, OTHER)
    expect(tasks).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// advanceSprint
// ---------------------------------------------------------------------------

describe('advanceSprint', () => {
  it('TC-T14: returns unauthorized when caller does not own the project', async () => {
    const result = await advanceSprint({
      project_id: projectId,
      owner_agent_slug: OTHER,
    })
    expect(result.kind).toBe('unauthorized')
  })

  it('TC-T15: inserts first sprint with sprint_number=1', async () => {
    const result = await advanceSprint({
      project_id: projectId,
      owner_agent_slug: OWNER,
      sprint_goal: 'Ship coverage',
    })
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') throw new Error('unexpected kind')
    expect(result.sprint.sprint_number).toBe(1)
    expect(result.sprint.sprint_goal).toBe('Ship coverage')
    expect(result.sprint.project_id).toBe(projectId)
  })

  it('TC-T16: second call inserts sprint_number=2', async () => {
    await advanceSprint({ project_id: projectId, owner_agent_slug: OWNER })
    const result = await advanceSprint({ project_id: projectId, owner_agent_slug: OWNER })
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') throw new Error('unexpected kind')
    expect(result.sprint.sprint_number).toBe(2)
  })
})
