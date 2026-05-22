/**
 * tests/utilities/handlers.test.ts
 *
 * Unit tests for all utility handler functions not yet at threshold coverage.
 * The database query modules are mocked — this file tests handler response
 * shaping, schema validation, and error propagation, not SQL execution.
 *
 * Coverage targets (S7-08):
 *   advance-sprint   — unauthorized, conflict, success; schema rejection
 *   create-cron      — authorized success, unauthorized, schema rejection (schedule, tool_name)
 *   create-project   — success, schema rejection (invalid slug)
 *   create-task      — authorized, unauthorized, invalid assignee slug
 *   delete-cron      — not_found_or_unauthorized, already_deleted, success
 *   get-project-board — not found, success
 *   query-crons      — handler path (handleQueryCrons with mock)
 *   query-projects   — handler path
 *   query-sprints    — handler path
 *   query-tasks      — handler path
 *   update-cron      — success, not_found_or_unauthorized; validatePayload paths
 *   update-project   — success, not_found_or_unauthorized
 */

import { vi, describe, it, expect, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock db/queries modules — hoisted before handler imports
// ---------------------------------------------------------------------------

vi.mock('../../src/db/queries/tasks.js', () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  queryTasks: vi.fn(),
  advanceSprint: vi.fn(),
  ALLOWED_TASK_FILTERS: ['project_id', 'status', 'assignee_agent_slug'],
}))

vi.mock('../../src/db/queries/crons.js', () => ({
  createCron: vi.fn(),
  queryCrons: vi.fn(),
  updateCron: vi.fn(),
  deleteCron: vi.fn(),
  getDueCrons: vi.fn(),
  markCronFired: vi.fn(),
  ALLOWED_CRON_FILTERS: ['project_id', 'status', 'owner_agent_slug'],
}))

vi.mock('../../src/db/queries/projects.js', () => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
  queryProjects: vi.fn(),
  getProjectBoard: vi.fn(),
  ALLOWED_PROJECT_FILTERS: ['status', 'owner_agent_slug'],
}))

vi.mock('../../src/db/queries/sprints.js', () => ({
  querySprints: vi.fn(),
  ALLOWED_SPRINT_FILTERS: ['project_id', 'sprint_number'],
}))

import { handleAdvanceSprint } from '../../src/utilities/advance-sprint.js'
import { handleCreateCron } from '../../src/utilities/create-cron.js'
import { handleCreateProject } from '../../src/utilities/create-project.js'
import { handleCreateTask } from '../../src/utilities/create-task.js'
import { handleDeleteCron } from '../../src/utilities/delete-cron.js'
import { handleGetProjectBoard } from '../../src/utilities/get-project-board.js'
import { handleQueryCrons } from '../../src/utilities/query-crons.js'
import { handleQueryProjects } from '../../src/utilities/query-projects.js'
import { handleQuerySprints } from '../../src/utilities/query-sprints.js'
import { handleQueryTasks } from '../../src/utilities/query-tasks.js'
import { handleUpdateCron, validatePayload } from '../../src/utilities/update-cron.js'
import { handleUpdateProject } from '../../src/utilities/update-project.js'

import * as tasksDb from '../../src/db/queries/tasks.js'
import * as cronsDb from '../../src/db/queries/crons.js'
import * as projectsDb from '../../src/db/queries/projects.js'
import * as sprintsDb from '../../src/db/queries/sprints.js'

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------
const mockAdvanceSprint = vi.mocked(tasksDb.advanceSprint)
const mockCreateTask    = vi.mocked(tasksDb.createTask)
const mockQueryTasks    = vi.mocked(tasksDb.queryTasks)

const mockCreateCron  = vi.mocked(cronsDb.createCron)
const mockQueryCrons  = vi.mocked(cronsDb.queryCrons)
const mockUpdateCron  = vi.mocked(cronsDb.updateCron)
const mockDeleteCron  = vi.mocked(cronsDb.deleteCron)

const mockCreateProject  = vi.mocked(projectsDb.createProject)
const mockUpdateProject  = vi.mocked(projectsDb.updateProject)
const mockQueryProjects  = vi.mocked(projectsDb.queryProjects)
const mockGetProjectBoard = vi.mocked(projectsDb.getProjectBoard)

const mockQuerySprints = vi.mocked(sprintsDb.querySprints)

const AGENT = 'test-agent'
const SCHEDULE = '* * * * *'
const TOOL = 'query_tasks'

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// advance-sprint
// ---------------------------------------------------------------------------

describe('handleAdvanceSprint', () => {
  it('TC-H1: returns not_found_or_unauthorized when db returns unauthorized', async () => {
    mockAdvanceSprint.mockResolvedValue({ kind: 'unauthorized' })

    const result = await handleAdvanceSprint({ project_id: 1 }, AGENT)

    expect(result).toMatchObject({ error: 'not_found_or_unauthorized' })
  })

  it('TC-H2: returns conflict error when db returns conflict', async () => {
    mockAdvanceSprint.mockResolvedValue({ kind: 'conflict' })

    const result = await handleAdvanceSprint({ project_id: 1 }, AGENT)

    expect(result).toMatchObject({ error: 'sprint_conflict', retryable: true })
  })

  it('TC-H3: returns sprint on success', async () => {
    const sprint = { id: 1, project_id: 1, sprint_number: 1, sprint_goal: null, started_at: new Date(), created_at: new Date() }
    mockAdvanceSprint.mockResolvedValue({ kind: 'success', sprint })

    const result = await handleAdvanceSprint({ project_id: 1 }, AGENT)

    expect(result).toEqual(sprint)
  })

  it('TC-H4: rejects negative project_id at schema level', async () => {
    await expect(handleAdvanceSprint({ project_id: -1 }, AGENT)).rejects.toThrow()
    expect(mockAdvanceSprint).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// create-cron
// ---------------------------------------------------------------------------

describe('handleCreateCron', () => {
  it('TC-H5: returns cron on authorized success', async () => {
    const cron = { id: 10, project_id: 1, owner_agent_slug: AGENT, name: 'My cron', description: null, schedule: SCHEDULE, tool_name: TOOL, payload: null, status: 'active' as const, next_fire_at: null, last_fired_at: null, created_at: new Date(), updated_at: new Date() }
    mockCreateCron.mockResolvedValue({ authorized: true, cron })

    const result = await handleCreateCron(
      { project_id: 1, name: 'My cron', schedule: SCHEDULE, tool_name: TOOL },
      AGENT,
    )

    expect(result).toEqual(cron)
  })

  it('TC-H6: returns error object when db returns unauthorized', async () => {
    mockCreateCron.mockResolvedValue({ authorized: false })

    const result = await handleCreateCron(
      { project_id: 1, name: 'X', schedule: SCHEDULE, tool_name: TOOL },
      AGENT,
    )

    expect(result).toMatchObject({ error: 'not_found_or_unauthorized' })
  })

  it('TC-H7: rejects invalid cron schedule at schema level', async () => {
    await expect(
      handleCreateCron({ project_id: 1, name: 'X', schedule: 'not-a-cron', tool_name: TOOL }, AGENT),
    ).rejects.toThrow()
    expect(mockCreateCron).not.toHaveBeenCalled()
  })

  it('TC-H8: rejects unknown tool_name (SEC-26)', async () => {
    await expect(
      handleCreateCron({ project_id: 1, name: 'X', schedule: SCHEDULE, tool_name: 'evil_tool' }, AGENT),
    ).rejects.toThrow()
    expect(mockCreateCron).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// create-project
// ---------------------------------------------------------------------------

describe('handleCreateProject', () => {
  it('TC-H9: calls db and returns project on success', async () => {
    const project = { id: 5, slug: 'my-project', name: 'My Project', description: null, status: 'active' as const, owner_agent_slug: AGENT, created_at: new Date(), updated_at: new Date() }
    mockCreateProject.mockResolvedValue(project)

    const result = await handleCreateProject({ slug: 'my-project', name: 'My Project' }, AGENT)

    expect(result).toEqual(project)
    expect(mockCreateProject).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'my-project', owner_agent_slug: AGENT }),
    )
  })

  it('TC-H10: rejects invalid slug at schema level (single char)', async () => {
    await expect(handleCreateProject({ slug: 'x', name: 'Bad' }, AGENT)).rejects.toThrow()
    expect(mockCreateProject).not.toHaveBeenCalled()
  })

  it('TC-H11: rejects slug with uppercase at schema level', async () => {
    await expect(handleCreateProject({ slug: 'My-Project', name: 'Bad' }, AGENT)).rejects.toThrow()
    expect(mockCreateProject).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// create-task
// ---------------------------------------------------------------------------

describe('handleCreateTask', () => {
  it('TC-H12: returns task on authorized success', async () => {
    const task = { id: 7, project_id: 1, title: 'Do it', description: null, status: 'todo' as const, assignee_agent_slug: null, github_pr_url: null, notes: null, created_at: new Date(), updated_at: new Date() }
    mockCreateTask.mockResolvedValue({ authorized: true, task })

    const result = await handleCreateTask({ project_id: 1, title: 'Do it' }, AGENT)

    expect(result).toEqual(task)
  })

  it('TC-H13: returns error when db returns unauthorized', async () => {
    mockCreateTask.mockResolvedValue({ authorized: false })

    const result = await handleCreateTask({ project_id: 1, title: 'X' }, AGENT)

    expect(result).toMatchObject({ error: 'not_found_or_unauthorized' })
  })

  it('TC-H14: rejects invalid assignee_slug not in manifest', async () => {
    await expect(
      handleCreateTask({ project_id: 1, title: 'X', assignee_agent_slug: 'evil-hacker' }, AGENT),
    ).rejects.toThrow()
    expect(mockCreateTask).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// delete-cron
// ---------------------------------------------------------------------------

describe('handleDeleteCron', () => {
  it('TC-H15: returns cron on success', async () => {
    const cron = { id: 3, project_id: 1, owner_agent_slug: AGENT, name: 'C', description: null, schedule: SCHEDULE, tool_name: TOOL, payload: null, status: 'deleted' as const, next_fire_at: null, last_fired_at: null, created_at: new Date(), updated_at: new Date() }
    mockDeleteCron.mockResolvedValue({ kind: 'success', cron })

    const result = await handleDeleteCron({ id: 3 }, AGENT)

    expect(result).toEqual(cron)
  })

  it('TC-H16: returns already_deleted error', async () => {
    mockDeleteCron.mockResolvedValue({ kind: 'already_deleted' })

    const result = await handleDeleteCron({ id: 3 }, AGENT)

    expect(result).toMatchObject({ error: 'already_deleted' })
  })

  it('TC-H17: returns not_found_or_unauthorized error', async () => {
    mockDeleteCron.mockResolvedValue({ kind: 'not_found_or_unauthorized' })

    const result = await handleDeleteCron({ id: 3 }, AGENT)

    expect(result).toMatchObject({ error: 'not_found_or_unauthorized' })
  })
})

// ---------------------------------------------------------------------------
// get-project-board
// ---------------------------------------------------------------------------

describe('handleGetProjectBoard', () => {
  it('TC-H18: returns board when project is found', async () => {
    const board = { id: 1, slug: 'my-proj', name: 'My Proj', description: null, status: 'active' as const, owner_agent_slug: AGENT, created_at: new Date(), updated_at: new Date(), todo_count: 0, wip_count: 0, review_count: 0, done_count: 0, rework_count: 0, tasks: [] }
    mockGetProjectBoard.mockResolvedValue(board)

    const result = await handleGetProjectBoard({ slug: 'my-proj' }, AGENT)

    expect(result).toEqual(board)
  })

  it('TC-H19: returns not_found_or_unauthorized when board is undefined', async () => {
    mockGetProjectBoard.mockResolvedValue(undefined)

    const result = await handleGetProjectBoard({ slug: 'missing' }, AGENT)

    expect(result).toMatchObject({ error: 'not_found_or_unauthorized' })
  })
})

// ---------------------------------------------------------------------------
// query-crons (handler coverage — schema tested in query-crons.test.ts)
// ---------------------------------------------------------------------------

describe('handleQueryCrons', () => {
  it('TC-H20: calls db and returns array', async () => {
    mockQueryCrons.mockResolvedValue([])

    const result = await handleQueryCrons({})

    expect(result).toEqual([])
    expect(mockQueryCrons).toHaveBeenCalledWith({})
  })

  it('TC-H21: passes filters through to queryCrons', async () => {
    mockQueryCrons.mockResolvedValue([])

    await handleQueryCrons({ owner_agent_slug: 'murphy', status: 'active' })

    expect(mockQueryCrons).toHaveBeenCalledWith(
      expect.objectContaining({ owner_agent_slug: 'murphy', status: 'active' }),
    )
  })

  it('TC-H22: rejects unknown filter key (strict schema)', async () => {
    await expect(
      handleQueryCrons({ unknown_key: 'x' } as never),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// query-projects
// ---------------------------------------------------------------------------

describe('handleQueryProjects', () => {
  it('TC-H23: calls db and returns array', async () => {
    mockQueryProjects.mockResolvedValue([])

    const result = await handleQueryProjects({})

    expect(result).toEqual([])
  })

  it('TC-H24: passes status filter to db', async () => {
    mockQueryProjects.mockResolvedValue([])

    await handleQueryProjects({ status: 'archived' })

    expect(mockQueryProjects).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'archived' }),
    )
  })
})

// ---------------------------------------------------------------------------
// query-sprints
// ---------------------------------------------------------------------------

describe('handleQuerySprints', () => {
  it('TC-H25: calls db and returns array', async () => {
    mockQuerySprints.mockResolvedValue([])

    const result = await handleQuerySprints({}, AGENT)

    expect(result).toEqual([])
    expect(mockQuerySprints).toHaveBeenCalledWith({}, AGENT)
  })

  it('TC-H26: passes project_id filter', async () => {
    mockQuerySprints.mockResolvedValue([])

    await handleQuerySprints({ project_id: 42 }, AGENT)

    expect(mockQuerySprints).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 42 }),
      AGENT,
    )
  })
})

// ---------------------------------------------------------------------------
// query-tasks
// ---------------------------------------------------------------------------

describe('handleQueryTasks', () => {
  it('TC-H27: calls db and returns array', async () => {
    mockQueryTasks.mockResolvedValue([])

    const result = await handleQueryTasks({}, AGENT)

    expect(result).toEqual([])
    expect(mockQueryTasks).toHaveBeenCalledWith({}, AGENT)
  })

  it('TC-H28: passes status + assignee filters', async () => {
    mockQueryTasks.mockResolvedValue([])

    await handleQueryTasks({ status: 'wip', assignee_agent_slug: 'murphy' }, AGENT)

    expect(mockQueryTasks).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'wip', assignee_agent_slug: 'murphy' }),
      AGENT,
    )
  })
})

// ---------------------------------------------------------------------------
// update-cron
// ---------------------------------------------------------------------------

describe('handleUpdateCron', () => {
  it('TC-H29: returns cron on success', async () => {
    const cron = { id: 5, project_id: 1, owner_agent_slug: AGENT, name: 'Updated', description: null, schedule: SCHEDULE, tool_name: TOOL, payload: null, status: 'active' as const, next_fire_at: null, last_fired_at: null, created_at: new Date(), updated_at: new Date() }
    mockUpdateCron.mockResolvedValue({ kind: 'success', cron })

    const result = await handleUpdateCron({ id: 5, name: 'Updated' }, AGENT)

    expect(result).toEqual(cron)
  })

  it('TC-H30: returns not_found_or_unauthorized', async () => {
    mockUpdateCron.mockResolvedValue({ kind: 'not_found_or_unauthorized' })

    const result = await handleUpdateCron({ id: 5, name: 'X' }, AGENT)

    expect(result).toMatchObject({ error: 'not_found_or_unauthorized' })
  })

  it('TC-H31: rejects invalid cron expression (SEC-28)', async () => {
    await expect(handleUpdateCron({ id: 5, schedule: 'not-a-cron' }, AGENT)).rejects.toThrow()
    expect(mockUpdateCron).not.toHaveBeenCalled()
  })

  it('TC-H32: rejects invalid tool_name (SEC-26)', async () => {
    await expect(handleUpdateCron({ id: 5, tool_name: 'rm -rf' }, AGENT)).rejects.toThrow()
    expect(mockUpdateCron).not.toHaveBeenCalled()
  })
})

describe('validatePayload', () => {
  it('TC-H33: accepts a plain object within limits', () => {
    expect(validatePayload({ key: 'value' })).toBe(true)
  })

  it('TC-H34: rejects non-object (string)', () => {
    expect(validatePayload('string')).toBe(false)
  })

  it('TC-H35: rejects null', () => {
    expect(validatePayload(null)).toBe(false)
  })

  it('TC-H36: rejects array', () => {
    expect(validatePayload([1, 2, 3])).toBe(false)
  })

  it('TC-H37: rejects deeply nested object (>5 levels)', () => {
    // 6 levels of nesting
    const deep = { a: { b: { c: { d: { e: { f: 'too-deep' } } } } } }
    expect(validatePayload(deep)).toBe(false)
  })

  it('TC-H38: accepts object at exactly 5 levels', () => {
    const fiveLevels = { a: { b: { c: { d: { e: 'ok' } } } } }
    expect(validatePayload(fiveLevels)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// update-project
// ---------------------------------------------------------------------------

describe('handleUpdateProject', () => {
  it('TC-H39: returns project on success', async () => {
    const project = { id: 1, slug: 'p', name: 'Updated', description: null, status: 'active' as const, owner_agent_slug: AGENT, created_at: new Date(), updated_at: new Date() }
    mockUpdateProject.mockResolvedValue(project)

    const result = await handleUpdateProject({ project_id: 1, name: 'Updated' }, AGENT)

    expect(result).toEqual(project)
  })

  it('TC-H40: returns not_found_or_unauthorized when db returns undefined', async () => {
    mockUpdateProject.mockResolvedValue(undefined)

    const result = await handleUpdateProject({ project_id: 1, name: 'X' }, AGENT)

    expect(result).toMatchObject({ error: 'not_found_or_unauthorized' })
  })

  it('TC-H41: rejects invalid status at schema level', async () => {
    await expect(
      handleUpdateProject({ project_id: 1, status: 'deleted' as never }, AGENT),
    ).rejects.toThrow()
    expect(mockUpdateProject).not.toHaveBeenCalled()
  })
})
