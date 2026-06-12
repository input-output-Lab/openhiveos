/**
 * tests/utilities/utilities.test.ts
 *
 * Consolidated test suite for all 12 coordination utilities.
 * Target: 85% line / 65% branch coverage across all handlers.
 * Organized by utility (12 test suites, ~240 test cases).
 *
 * Consolidates:
 * - handlers.test.ts (advance-sprint, create-cron, create-project, create-task,
 *   delete-cron, get-project-board, query-crons, query-projects, query-sprints,
 *   query-tasks, update-cron, update-project)
 * - update-task.test.ts (field gate logic + new edge cases)
 * - query-crons.test.ts (schema validation + new filter combos)
 *
 * Coverage priorities: Tier 1 (advance-sprint, create-cron, update-cron, update-task,
 * query-crons) → Tier 2 (create-task, create-project, update-project) → Tier 3
 * (query-projects, query-sprints, query-tasks, delete-cron)
 */

import { vi, describe, it, expect, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock db/queries modules (hoisted before handler imports)
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
  applyPortfolioUpdate: vi.fn(),
  ALLOWED_PROJECT_FILTERS: ['status', 'owner_agent_slug'],
}))

vi.mock('../../src/db/queries/sprints.js', () => ({
  querySprints: vi.fn(),
  ALLOWED_SPRINT_FILTERS: ['project_id', 'sprint_number'],
}))

vi.mock('../../src/db/client.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../../src/squad/manifest.js', () => ({
  isValidAgentSlug: vi.fn((slug: string) => /^[a-z0-9-]+$/.test(slug) && slug.length > 0),
}))

vi.mock('../../src/config.js', () => ({
  config: {
    DATABASE_URL: 'postgres://test',
    GEMINI_API_KEY: 'test-key',
    AGENT_TOKEN: 'test.token',
    HEALTH_PORT: 3000,
    SQUAD_API_URL: 'http://localhost:3005',
    OPENHIVEOS_INGESTION_TOKEN: 'test-ingestion-token-0123456789abcdef0123456789abcdef',
    ETHOS_SEAL_PATH: './ethos.seal.json',
  },
}))

// Mock global fetch for HTTP requests
global.fetch = vi.fn()

// Import handlers after mocks are set up
import { handleAdvanceSprint } from '../../src/utilities/advance-sprint.js'
import { handleCreateCron } from '../../src/utilities/create-cron.js'
import { handleCreateProject } from '../../src/utilities/create-project.js'
import { handleCreateTask } from '../../src/utilities/create-task.js'
import { handleDeleteCron } from '../../src/utilities/delete-cron.js'
import { handleGetProjectBoard } from '../../src/utilities/get-project-board.js'
import { handleGetCompanyEthos } from '../../src/utilities/get-company-ethos.js'
import { handleReportUsage } from '../../src/utilities/report-usage.js'
import { handleQueryCrons } from '../../src/utilities/query-crons.js'
import { handleQueryProjects } from '../../src/utilities/query-projects.js'
import { handleQuerySprints } from '../../src/utilities/query-sprints.js'
import { handleQueryTasks } from '../../src/utilities/query-tasks.js'
import { handleUpdateCron, validatePayload } from '../../src/utilities/update-cron.js'
import { handleUpdateProject, updateProjectSchema } from '../../src/utilities/update-project.js'
import { handleUpdateTask } from '../../src/utilities/update-task.js'

import * as tasksDb from '../../src/db/queries/tasks.js'
import * as cronsDb from '../../src/db/queries/crons.js'
import * as projectsDb from '../../src/db/queries/projects.js'
import * as sprintsDb from '../../src/db/queries/sprints.js'
import { pool } from '../../src/db/client.js'
import { isValidAgentSlug } from '../../src/squad/manifest.js'

// Typed mock helpers
const mockAdvanceSprint = vi.mocked(tasksDb.advanceSprint)
const mockCreateTask = vi.mocked(tasksDb.createTask)
const mockUpdateTask = vi.mocked(tasksDb.updateTask)
const mockQueryTasks = vi.mocked(tasksDb.queryTasks)

const mockCreateCron = vi.mocked(cronsDb.createCron)
const mockQueryCrons = vi.mocked(cronsDb.queryCrons)
const mockUpdateCron = vi.mocked(cronsDb.updateCron)
const mockDeleteCron = vi.mocked(cronsDb.deleteCron)

const mockCreateProject = vi.mocked(projectsDb.createProject)
const mockUpdateProject = vi.mocked(projectsDb.updateProject)
const mockQueryProjects = vi.mocked(projectsDb.queryProjects)
const mockGetProjectBoard = vi.mocked(projectsDb.getProjectBoard)
const mockApplyPortfolioUpdate = vi.mocked(projectsDb.applyPortfolioUpdate)

const mockQuerySprints = vi.mocked(sprintsDb.querySprints)
const mockIsValidAgentSlug = vi.mocked(isValidAgentSlug)
const mockPoolQuery = vi.mocked(pool.query)

// ---------------------------------------------------------------------------
// Test Constants
// ---------------------------------------------------------------------------

const AGENT = 'test-agent'
const SCHEDULE = '0 0 * * *' // Every day at midnight
const TOOL = 'query_tasks'

// ---------------------------------------------------------------------------
// Shared Fixtures (Stub Objects)
// ---------------------------------------------------------------------------

const stubTask = {
  id: 42,
  project_id: 1,
  title: 'Test Task',
  status: 'todo' as const,
  assignee_agent_slug: AGENT,
}

const stubCron = {
  id: 10,
  project_id: 1,
  name: 'Test Cron',
  description: 'A test cron job',
  schedule: SCHEDULE,
  tool_name: TOOL,
  payload: { query: 'test' },
  status: 'active' as const,
  owner_agent_slug: AGENT,
}

const stubProject = {
  id: 5,
  slug: 'test-project',
  name: 'Test Project',
  description: 'A test project',
  status: 'active' as const,
  owner_agent_slug: AGENT,
}

const stubSprint = {
  id: 1,
  project_id: 1,
  sprint_number: 1,
  goal: 'Test sprint',
  start_date: new Date().toISOString(),
}

// Factory functions for test variants
const taskWith = (overrides: Record<string, unknown>) => ({ ...stubTask, ...overrides })
const cronWith = (overrides: Record<string, unknown>) => ({ ...stubCron, ...overrides })
const projectWith = (overrides: Record<string, unknown>) => ({ ...stubProject, ...overrides })
const sprintWith = (overrides: Record<string, unknown>) => ({ ...stubSprint, ...overrides })

// ---------------------------------------------------------------------------
// TIER 1: advance-sprint
// ---------------------------------------------------------------------------

describe('TC-U1: advance-sprint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('TC-U1-1: returns success when advancing sprint without goal', async () => {
    mockAdvanceSprint.mockResolvedValueOnce({ kind: 'success', sprint: stubSprint })

    const result = await handleAdvanceSprint({ project_id: 1 }, AGENT)

    expect(result).toEqual(stubSprint)
    expect(mockAdvanceSprint).toHaveBeenCalledWith({
      project_id: 1,
      owner_agent_slug: AGENT,
    })
  })

  it('TC-U1-2: returns success when advancing sprint with goal', async () => {
    const goal = 'Complete core features'
    mockAdvanceSprint.mockResolvedValueOnce({ kind: 'success', sprint: stubSprint })

    const result = await handleAdvanceSprint({ project_id: 1, sprint_goal: goal }, AGENT)

    expect(result).toEqual(stubSprint)
    expect(mockAdvanceSprint).toHaveBeenCalledWith({
      project_id: 1,
      owner_agent_slug: AGENT,
      sprint_goal: goal,
    })
  })

  it('TC-U1-3: returns unauthorized when caller does not own project', async () => {
    mockAdvanceSprint.mockResolvedValueOnce({ kind: 'unauthorized' })

    const result = await handleAdvanceSprint({ project_id: 1 }, 'other-agent')

    expect(result).toHaveProperty('error', 'not_found_or_unauthorized')
  })

  it('TC-U1-4: returns conflict on concurrent advance attempt', async () => {
    mockAdvanceSprint.mockResolvedValueOnce({ kind: 'conflict' })

    const result = await handleAdvanceSprint({ project_id: 1 }, AGENT)

    expect(result).toHaveProperty('error', 'sprint_conflict')
  })

  it('TC-U1-5: rejects project_id ≤ 0 at schema level', async () => {
    await expect(handleAdvanceSprint({ project_id: 0 }, AGENT)).rejects.toThrow()
  })

  it('TC-U1-6: rejects project_id as non-integer at schema level', async () => {
    await expect(handleAdvanceSprint({ project_id: 1.5 as any }, AGENT)).rejects.toThrow()
  })

  it('TC-U1-7: rejects sprint_goal > 2000 chars at schema level', async () => {
    const longGoal = 'x'.repeat(2001)
    await expect(
      handleAdvanceSprint({ project_id: 1, sprint_goal: longGoal }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U1-8: accepts sprint_goal at exactly 2000 chars (boundary)', async () => {
    const boundaryGoal = 'x'.repeat(2000)
    mockAdvanceSprint.mockResolvedValueOnce({ kind: 'success', sprint: stubSprint })

    const result = await handleAdvanceSprint(
      { project_id: 1, sprint_goal: boundaryGoal },
      AGENT,
    )

    expect(result).toEqual(stubSprint)
  })

  it('TC-U1-9: accepts empty sprint_goal string', async () => {
    mockAdvanceSprint.mockResolvedValueOnce({ kind: 'success', sprint: stubSprint })

    const result = await handleAdvanceSprint({ project_id: 1, sprint_goal: '' }, AGENT)

    expect(result).toEqual(stubSprint)
  })

  it('TC-U1-10: handles DB error from query layer', async () => {
    mockAdvanceSprint.mockRejectedValueOnce(new Error('DB error'))

    await expect(handleAdvanceSprint({ project_id: 1 }, AGENT)).rejects.toThrow('DB error')
  })

  it('TC-U1-11: project_id at boundary (minimum positive)', async () => {
    mockAdvanceSprint.mockResolvedValueOnce({ kind: 'success', sprint: stubSprint })

    const result = await handleAdvanceSprint({ project_id: 1 }, AGENT)

    expect(result).toEqual(stubSprint)
  })

  it('TC-U1-12: returns success with large project_id', async () => {
    mockAdvanceSprint.mockResolvedValueOnce({ kind: 'success', sprint: stubSprint })

    const result = await handleAdvanceSprint({ project_id: 999999 }, AGENT)

    expect(result).toEqual(stubSprint)
  })
})

// ---------------------------------------------------------------------------
// TIER 1: create-cron
// ---------------------------------------------------------------------------

describe('TC-U2: create-cron', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsValidAgentSlug.mockReturnValue(true)
  })

  it('TC-U2-1: returns success with all fields', async () => {
    mockCreateCron.mockResolvedValueOnce({ authorized: true, cron: stubCron })

    const result = await handleCreateCron(
      {
        project_id: 1,
        name: 'Daily Sync',
        schedule: SCHEDULE,
        tool_name: TOOL,
        description: 'Daily task sync',
        payload: { test: true },
      },
      AGENT,
    )

    expect(result).toEqual(stubCron)
  })

  it('TC-U2-2: returns success with minimal fields', async () => {
    mockCreateCron.mockResolvedValueOnce({ authorized: true, cron: stubCron })

    const result = await handleCreateCron(
      {
        project_id: 1,
        name: 'Daily Sync',
        schedule: SCHEDULE,
        tool_name: TOOL,
      },
      AGENT,
    )

    expect(result).toEqual(stubCron)
  })

  it('TC-U2-3: returns error when project not owned or not found', async () => {
    mockCreateCron.mockResolvedValueOnce({ authorized: false })

    const result = await handleCreateCron(
      {
        project_id: 1,
        name: 'Daily Sync',
        schedule: SCHEDULE,
        tool_name: TOOL,
      },
      'other-agent',
    )

    expect(result).toHaveProperty('error', 'not_found_or_unauthorized')
  })

  it('TC-U2-4: rejects invalid cron schedule at schema level', async () => {
    await expect(
      handleCreateCron(
        {
          project_id: 1,
          name: 'Daily Sync',
          schedule: 'invalid-schedule',
          tool_name: TOOL,
        },
        AGENT,
      ),
    ).rejects.toThrow()
  })

  it('TC-U2-5: rejects invalid tool_name at schema level', async () => {
    await expect(
      handleCreateCron(
        {
          project_id: 1,
          name: 'Daily Sync',
          schedule: SCHEDULE,
          tool_name: 'nonexistent_tool',
        },
        AGENT,
      ),
    ).rejects.toThrow()
  })

  it('TC-U2-6: rejects project_id ≤ 0 at schema level', async () => {
    await expect(
      handleCreateCron(
        {
          project_id: 0,
          name: 'Daily Sync',
          schedule: SCHEDULE,
          tool_name: TOOL,
        },
        AGENT,
      ),
    ).rejects.toThrow()
  })

  it('TC-U2-7: rejects name > 200 chars at schema level', async () => {
    await expect(
      handleCreateCron(
        {
          project_id: 1,
          name: 'x'.repeat(201),
          schedule: SCHEDULE,
          tool_name: TOOL,
        },
        AGENT,
      ),
    ).rejects.toThrow()
  })

  it('TC-U2-8: accepts name at exactly 200 chars (boundary)', async () => {
    mockCreateCron.mockResolvedValueOnce({ authorized: true, cron: stubCron })

    const result = await handleCreateCron(
      {
        project_id: 1,
        name: 'x'.repeat(200),
        schedule: SCHEDULE,
        tool_name: TOOL,
      },
      AGENT,
    )

    expect(result).toEqual(stubCron)
  })

  it('TC-U2-9: rejects description > 1000 chars at schema level', async () => {
    await expect(
      handleCreateCron(
        {
          project_id: 1,
          name: 'Daily Sync',
          schedule: SCHEDULE,
          tool_name: TOOL,
          description: 'x'.repeat(1001),
        },
        AGENT,
      ),
    ).rejects.toThrow()
  })

  it('TC-U2-10: rejects payload > 16KB at schema level', async () => {
    const largePayload = { data: 'x'.repeat(16_385) }
    await expect(
      handleCreateCron(
        {
          project_id: 1,
          name: 'Daily Sync',
          schedule: SCHEDULE,
          tool_name: TOOL,
          payload: largePayload,
        },
        AGENT,
      ),
    ).rejects.toThrow()
  })

  it('TC-U2-11: accepts payload that serializes to ~16KB', async () => {
    const payload = { data: 'x'.repeat(16_300) }
    mockCreateCron.mockResolvedValueOnce({ authorized: true, cron: stubCron })

    const result = await handleCreateCron(
      {
        project_id: 1,
        name: 'Daily Sync',
        schedule: SCHEDULE,
        tool_name: TOOL,
        payload,
      },
      AGENT,
    )

    expect(result).toEqual(stubCron)
  })

  it('TC-U2-12: rejects payload with > 5 nesting levels at schema level', async () => {
    const deepPayload = {
      level1: { level2: { level3: { level4: { level5: { level6: 'too deep' } } } } },
    }
    await expect(
      handleCreateCron(
        {
          project_id: 1,
          name: 'Daily Sync',
          schedule: SCHEDULE,
          tool_name: TOOL,
          payload: deepPayload,
        },
        AGENT,
      ),
    ).rejects.toThrow()
  })

  it('TC-U2-13: accepts payload with exactly 5 nesting levels (boundary)', async () => {
    const deepPayload = {
      level1: { level2: { level3: { level4: { level5: 'ok' } } } },
    }
    mockCreateCron.mockResolvedValueOnce({ authorized: true, cron: stubCron })

    const result = await handleCreateCron(
      {
        project_id: 1,
        name: 'Daily Sync',
        schedule: SCHEDULE,
        tool_name: TOOL,
        payload: deepPayload,
      },
      AGENT,
    )

    expect(result).toEqual(stubCron)
  })

  it('TC-U2-14: rejects payload as array instead of object at schema level', async () => {
    await expect(
      handleCreateCron(
        {
          project_id: 1,
          name: 'Daily Sync',
          schedule: SCHEDULE,
          tool_name: TOOL,
          payload: [1, 2, 3] as any,
        },
        AGENT,
      ),
    ).rejects.toThrow()
  })

  it('TC-U2-15: rejects empty name at schema level', async () => {
    await expect(
      handleCreateCron(
        {
          project_id: 1,
          name: '',
          schedule: SCHEDULE,
          tool_name: TOOL,
        },
        AGENT,
      ),
    ).rejects.toThrow()
  })

  it('TC-U2-16: accepts empty description string', async () => {
    mockCreateCron.mockResolvedValueOnce({ authorized: true, cron: stubCron })

    const result = await handleCreateCron(
      {
        project_id: 1,
        name: 'Daily Sync',
        schedule: SCHEDULE,
        tool_name: TOOL,
        description: '',
      },
      AGENT,
    )

    expect(result).toEqual(stubCron)
  })

  it('TC-U2-17: handles DB error from query layer', async () => {
    mockCreateCron.mockRejectedValueOnce(new Error('DB error'))

    await expect(
      handleCreateCron(
        {
          project_id: 1,
          name: 'Daily Sync',
          schedule: SCHEDULE,
          tool_name: TOOL,
        },
        AGENT,
      ),
    ).rejects.toThrow('DB error')
  })

  it('TC-U2-18: accepts special cron syntax (@hourly)', async () => {
    mockCreateCron.mockResolvedValueOnce({ authorized: true, cron: stubCron })

    const result = await handleCreateCron(
      {
        project_id: 1,
        name: 'Hourly Job',
        schedule: '@hourly',
        tool_name: TOOL,
      },
      AGENT,
    )

    expect(result).toEqual(stubCron)
  })

  it('TC-U2-19: description at exactly 1000 chars (boundary)', async () => {
    mockCreateCron.mockResolvedValueOnce({ authorized: true, cron: stubCron })

    const result = await handleCreateCron(
      {
        project_id: 1,
        name: 'Daily Sync',
        schedule: SCHEDULE,
        tool_name: TOOL,
        description: 'x'.repeat(1000),
      },
      AGENT,
    )

    expect(result).toEqual(stubCron)
  })

  it('TC-U2-20: project_id at exactly 1 (minimum positive)', async () => {
    mockCreateCron.mockResolvedValueOnce({ authorized: true, cron: stubCron })

    const result = await handleCreateCron(
      {
        project_id: 1,
        name: 'Daily Sync',
        schedule: SCHEDULE,
        tool_name: TOOL,
      },
      AGENT,
    )

    expect(result).toEqual(stubCron)
  })

  it('TC-U2-21: project_id with large value', async () => {
    mockCreateCron.mockResolvedValueOnce({ authorized: true, cron: stubCron })

    const result = await handleCreateCron(
      {
        project_id: 999999,
        name: 'Daily Sync',
        schedule: SCHEDULE,
        tool_name: TOOL,
      },
      AGENT,
    )

    expect(result).toEqual(stubCron)
  })

  it('TC-U2-22: rejects name as null at schema level', async () => {
    await expect(
      handleCreateCron(
        {
          project_id: 1,
          name: null as any,
          schedule: SCHEDULE,
          tool_name: TOOL,
        },
        AGENT,
      ),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// TC-U10: update-cron (23 tests)
// ---------------------------------------------------------------------------

describe('TC-U10: update-cron', () => {
  const stubCronForUpdate = {
    id: 10,
    project_id: 1,
    name: 'Original Name',
    description: 'Original description',
    schedule: SCHEDULE,
    tool_name: TOOL,
    payload: { key: 'value' },
    status: 'active' as const,
    owner_agent_slug: AGENT,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Happy paths (8 tests) — single and multiple field updates
  it('TC-U10-1: updates name only', async () => {
    mockUpdateCron.mockResolvedValueOnce({ authorized: true, cron: { ...stubCronForUpdate, name: 'New Name' } })

    const result = await handleUpdateCron({ id: 10, name: 'New Name' }, AGENT)

    expect(result.name).toBe('New Name')
    expect(mockUpdateCron).toHaveBeenCalledWith(
      expect.objectContaining({ id: 10, owner_agent_slug: AGENT, name: 'New Name' }),
    )
  })

  it('TC-U10-2: updates description only', async () => {
    mockUpdateCron.mockResolvedValueOnce({ authorized: true, cron: { ...stubCronForUpdate, description: 'New desc' } })

    const result = await handleUpdateCron({ id: 10, description: 'New desc' }, AGENT)

    expect(result.description).toBe('New desc')
  })

  it('TC-U10-3: updates schedule only', async () => {
    const newSchedule = '0 12 * * *'
    mockUpdateCron.mockResolvedValueOnce({ authorized: true, cron: { ...stubCronForUpdate, schedule: newSchedule } })

    const result = await handleUpdateCron({ id: 10, schedule: newSchedule }, AGENT)

    expect(result.schedule).toBe(newSchedule)
  })

  it('TC-U10-4: updates tool_name only', async () => {
    mockUpdateCron.mockResolvedValueOnce({ authorized: true, cron: { ...stubCronForUpdate, tool_name: 'create_task' } })

    const result = await handleUpdateCron({ id: 10, tool_name: 'create_task' }, AGENT)

    expect(result.tool_name).toBe('create_task')
  })

  it('TC-U10-5: updates payload only', async () => {
    const newPayload = { updated: true, count: 99 }
    mockUpdateCron.mockResolvedValueOnce({ authorized: true, cron: { ...stubCronForUpdate, payload: newPayload } })

    const result = await handleUpdateCron({ id: 10, payload: newPayload }, AGENT)

    expect(result.payload).toEqual(newPayload)
  })

  it('TC-U10-6: updates status to paused', async () => {
    mockUpdateCron.mockResolvedValueOnce({ authorized: true, cron: { ...stubCronForUpdate, status: 'paused' } })

    const result = await handleUpdateCron({ id: 10, status: 'paused' }, AGENT)

    expect(result.status).toBe('paused')
  })

  it('TC-U10-7: updates status to active', async () => {
    const cronPaused = { ...stubCronForUpdate, status: 'paused' as const }
    mockUpdateCron.mockResolvedValueOnce({ authorized: true, cron: { ...cronPaused, status: 'active' } })

    const result = await handleUpdateCron({ id: 10, status: 'active' }, AGENT)

    expect(result.status).toBe('active')
  })

  it('TC-U10-8: updates multiple fields (name + description)', async () => {
    mockUpdateCron.mockResolvedValueOnce({
      authorized: true,
      cron: { ...stubCronForUpdate, name: 'Multi', description: 'Updated multiple' },
    })

    const result = await handleUpdateCron(
      { id: 10, name: 'Multi', description: 'Updated multiple' },
      AGENT,
    )

    expect(result.name).toBe('Multi')
    expect(result.description).toBe('Updated multiple')
  })

  // Authorization & DB errors (2 tests)
  it('TC-U10-9: returns error when cron not found or not owned', async () => {
    mockUpdateCron.mockResolvedValueOnce({ kind: 'not_found_or_unauthorized' })

    const result = await handleUpdateCron({ id: 10, name: 'Hack Attempt' }, AGENT)

    expect(result).toHaveProperty('error', 'not_found_or_unauthorized')
  })

  it('TC-U10-10: handles DB error from query layer', async () => {
    mockUpdateCron.mockRejectedValueOnce(new Error('DB connection lost'))

    await expect(
      handleUpdateCron({ id: 10, name: 'Update' }, AGENT),
    ).rejects.toThrow('DB connection lost')
  })

  // Schema validation errors (10 tests)
  it('TC-U10-11: rejects id ≤ 0 at schema level', async () => {
    await expect(
      handleUpdateCron({ id: 0, name: 'Test' }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U10-12: rejects id as non-integer at schema level', async () => {
    await expect(
      handleUpdateCron({ id: 10.5 as any, name: 'Test' }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U10-13: rejects name > 200 chars at schema level', async () => {
    await expect(
      handleUpdateCron({ id: 10, name: 'x'.repeat(201) }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U10-14: rejects description > 1000 chars at schema level', async () => {
    await expect(
      handleUpdateCron({ id: 10, description: 'x'.repeat(1001) }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U10-15: rejects invalid cron schedule at schema level', async () => {
    await expect(
      handleUpdateCron({ id: 10, schedule: 'not-a-cron' }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U10-16: rejects tool_name not in registry at schema level', async () => {
    await expect(
      handleUpdateCron({ id: 10, tool_name: 'nonexistent_tool' }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U10-17: rejects payload > 16KB at schema level', async () => {
    const largePayload = { data: 'x'.repeat(16_385) }
    await expect(
      handleUpdateCron({ id: 10, payload: largePayload }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U10-18: rejects payload with > 5 nesting levels at schema level', async () => {
    const deepPayload = {
      l1: { l2: { l3: { l4: { l5: { l6: 'too deep' } } } } },
    }
    await expect(
      handleUpdateCron({ id: 10, payload: deepPayload }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U10-19: rejects status invalid (not active or paused) at schema level', async () => {
    await expect(
      handleUpdateCron({ id: 10, status: 'deleted' as any }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U10-20: rejects payload as array instead of object at schema level', async () => {
    await expect(
      handleUpdateCron({ id: 10, payload: [1, 2, 3] as any }, AGENT),
    ).rejects.toThrow()
  })

  // Edge cases & boundaries (3 tests)
  it('TC-U10-21: id at exactly 1 (minimum positive)', async () => {
    mockUpdateCron.mockResolvedValueOnce({ authorized: true, cron: { ...stubCronForUpdate, id: 1 } })

    const result = await handleUpdateCron({ id: 1, name: 'Min ID' }, AGENT)

    expect(result.id).toBe(1)
  })

  it('TC-U10-22: id with large value', async () => {
    mockUpdateCron.mockResolvedValueOnce({ authorized: true, cron: { ...stubCronForUpdate, id: 999999 } })

    const result = await handleUpdateCron({ id: 999999, name: 'Large ID' }, AGENT)

    expect(result.id).toBe(999999)
  })

  it('TC-U10-23: clear payload with null', async () => {
    mockUpdateCron.mockResolvedValueOnce({ authorized: true, cron: { ...stubCronForUpdate, payload: null } })

    const result = await handleUpdateCron({ id: 10, payload: null }, AGENT)

    expect(result.payload).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// TC-U3: create-project (9 tests)
// ---------------------------------------------------------------------------

describe('TC-U3: create-project', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC-U3-1: creates project with all fields', async () => {
    mockCreateProject.mockResolvedValueOnce(stubProject)
    const result = await handleCreateProject({ slug: 'my-project', name: 'My Project', description: 'A desc' }, AGENT)
    expect(result).toEqual(stubProject)
  })

  it('TC-U3-2: creates project with minimal fields (slug + name)', async () => {
    mockCreateProject.mockResolvedValueOnce(stubProject)
    const result = await handleCreateProject({ slug: 'my-project', name: 'My Project' }, AGENT)
    expect(result).toEqual(stubProject)
    expect(mockCreateProject).toHaveBeenCalledWith(
      expect.objectContaining({ owner_agent_slug: AGENT }),
    )
  })

  it('TC-U3-3: rejects slug < 2 chars at schema level', async () => {
    await expect(handleCreateProject({ slug: 'a', name: 'My Project' }, AGENT)).rejects.toThrow()
  })

  it('TC-U3-4: rejects slug > 80 chars at schema level', async () => {
    await expect(
      handleCreateProject({ slug: 'a'.repeat(79) + '-z', name: 'My Project' }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U3-5: rejects slug with uppercase at schema level', async () => {
    await expect(handleCreateProject({ slug: 'My-Project', name: 'My Project' }, AGENT)).rejects.toThrow()
  })

  it('TC-U3-6: rejects slug with leading hyphen at schema level', async () => {
    await expect(handleCreateProject({ slug: '-project', name: 'My Project' }, AGENT)).rejects.toThrow()
  })

  it('TC-U3-7: rejects name > 200 chars at schema level', async () => {
    await expect(handleCreateProject({ slug: 'my-project', name: 'x'.repeat(201) }, AGENT)).rejects.toThrow()
  })

  it('TC-U3-8: rejects description > 2000 chars at schema level', async () => {
    await expect(
      handleCreateProject({ slug: 'my-project', name: 'My Project', description: 'x'.repeat(2001) }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U3-9: handles DB error from query layer', async () => {
    mockCreateProject.mockRejectedValueOnce(new Error('slug conflict'))
    await expect(handleCreateProject({ slug: 'my-project', name: 'My Project' }, AGENT)).rejects.toThrow('slug conflict')
  })
})

// ---------------------------------------------------------------------------
// TC-U4: create-task (14 tests)
// ---------------------------------------------------------------------------

describe('TC-U4: create-task', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC-U4-1: creates task with all fields', async () => {
    mockCreateTask.mockResolvedValueOnce({ authorized: true, task: stubTask })
    const result = await handleCreateTask(
      {
        project_id: 1,
        title: 'Fix bug',
        description: 'A description',
        github_pr_url: 'https://github.com/org/repo/pull/1',
        notes: 'Some notes',
      },
      AGENT,
    )
    expect(result).toEqual(stubTask)
  })

  it('TC-U4-2: creates task with minimal fields (project_id + title)', async () => {
    mockCreateTask.mockResolvedValueOnce({ authorized: true, task: stubTask })
    const result = await handleCreateTask({ project_id: 1, title: 'Fix bug' }, AGENT)
    expect(result).toEqual(stubTask)
    expect(mockCreateTask).toHaveBeenCalledWith(expect.objectContaining({ owner_agent_slug: AGENT }))
  })

  it('TC-U4-3: returns error when project not owned or not found', async () => {
    mockCreateTask.mockResolvedValueOnce({ authorized: false })
    const result = await handleCreateTask({ project_id: 1, title: 'Fix bug' }, AGENT)
    expect(result).toHaveProperty('error', 'not_found_or_unauthorized')
  })

  it('TC-U4-4: rejects project_id ≤ 0 at schema level', async () => {
    await expect(handleCreateTask({ project_id: 0, title: 'Fix bug' }, AGENT)).rejects.toThrow()
  })

  it('TC-U4-5: rejects title > 500 chars at schema level', async () => {
    await expect(handleCreateTask({ project_id: 1, title: 'x'.repeat(501) }, AGENT)).rejects.toThrow()
  })

  it('TC-U4-6: rejects empty title at schema level', async () => {
    await expect(handleCreateTask({ project_id: 1, title: '' }, AGENT)).rejects.toThrow()
  })

  it('TC-U4-7: rejects description > 5000 chars at schema level', async () => {
    await expect(
      handleCreateTask({ project_id: 1, title: 'Fix bug', description: 'x'.repeat(5001) }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U4-8: rejects notes > 5000 chars at schema level', async () => {
    await expect(
      handleCreateTask({ project_id: 1, title: 'Fix bug', notes: 'x'.repeat(5001) }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U4-9: rejects invalid github_pr_url at schema level', async () => {
    await expect(
      handleCreateTask({ project_id: 1, title: 'Fix bug', github_pr_url: 'not-a-url' }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U4-10: rejects unknown assignee_agent_slug at schema level', async () => {
    mockIsValidAgentSlug.mockReturnValueOnce(false)
    await expect(
      handleCreateTask({ project_id: 1, title: 'Fix bug', assignee_agent_slug: 'ghost-agent' }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U4-11: accepts valid assignee_agent_slug', async () => {
    mockCreateTask.mockResolvedValueOnce({ authorized: true, task: stubTask })
    const result = await handleCreateTask(
      { project_id: 1, title: 'Fix bug', assignee_agent_slug: 'other-agent' },
      AGENT,
    )
    expect(result).toEqual(stubTask)
  })

  it('TC-U4-12: handles DB error from query layer', async () => {
    mockCreateTask.mockRejectedValueOnce(new Error('DB error'))
    await expect(handleCreateTask({ project_id: 1, title: 'Fix bug' }, AGENT)).rejects.toThrow('DB error')
  })

  it('TC-U4-13: title at exactly 500 chars (boundary) accepted', async () => {
    mockCreateTask.mockResolvedValueOnce({ authorized: true, task: stubTask })
    const result = await handleCreateTask({ project_id: 1, title: 'x'.repeat(500) }, AGENT)
    expect(result).toEqual(stubTask)
  })

  it('TC-U4-14: accepts valid github_pr_url with HTTPS', async () => {
    mockCreateTask.mockResolvedValueOnce({ authorized: true, task: stubTask })
    const result = await handleCreateTask(
      { project_id: 1, title: 'Fix bug', github_pr_url: 'https://github.com/org/repo/pull/42' },
      AGENT,
    )
    expect(result).toEqual(stubTask)
  })
})

// ---------------------------------------------------------------------------
// TC-U5: delete-cron (7 tests)
// ---------------------------------------------------------------------------

describe('TC-U5: delete-cron', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC-U5-1: soft-deletes cron and returns deleted cron', async () => {
    const deletedCron = { ...stubCron, status: 'deleted' as const }
    mockDeleteCron.mockResolvedValueOnce({ kind: 'success', cron: deletedCron })
    const result = await handleDeleteCron({ id: 10 }, AGENT)
    expect(result).toEqual(deletedCron)
  })

  it('TC-U5-2: returns error when cron not found or not owned', async () => {
    mockDeleteCron.mockResolvedValueOnce({ kind: 'not_found_or_unauthorized' })
    const result = await handleDeleteCron({ id: 10 }, AGENT)
    expect(result).toHaveProperty('error', 'not_found_or_unauthorized')
  })

  it('TC-U5-3: returns already_deleted error when cron already soft-deleted', async () => {
    mockDeleteCron.mockResolvedValueOnce({ kind: 'already_deleted' })
    const result = await handleDeleteCron({ id: 10 }, AGENT)
    expect(result).toHaveProperty('error', 'already_deleted')
  })

  it('TC-U5-4: passes owner_agent_slug to DB layer', async () => {
    mockDeleteCron.mockResolvedValueOnce({ kind: 'success', cron: stubCron })
    await handleDeleteCron({ id: 10 }, AGENT)
    expect(mockDeleteCron).toHaveBeenCalledWith({ id: 10, owner_agent_slug: AGENT })
  })

  it('TC-U5-5: rejects id ≤ 0 at schema level', async () => {
    await expect(handleDeleteCron({ id: 0 }, AGENT)).rejects.toThrow()
  })

  it('TC-U5-6: rejects id as non-integer at schema level', async () => {
    await expect(handleDeleteCron({ id: 1.5 as any }, AGENT)).rejects.toThrow()
  })

  it('TC-U5-7: handles DB error from query layer', async () => {
    mockDeleteCron.mockRejectedValueOnce(new Error('DB error'))
    await expect(handleDeleteCron({ id: 10 }, AGENT)).rejects.toThrow('DB error')
  })
})

// ---------------------------------------------------------------------------
// TC-U6: query-crons (15 tests)
// ---------------------------------------------------------------------------

describe('TC-U6: query-crons', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC-U6-1: returns all crons with no filters', async () => {
    mockQueryCrons.mockResolvedValueOnce([stubCron])
    const result = await handleQueryCrons({})
    expect(result).toEqual([stubCron])
  })

  it('TC-U6-2: filters by project_id', async () => {
    mockQueryCrons.mockResolvedValueOnce([stubCron])
    await handleQueryCrons({ project_id: 1 })
    expect(mockQueryCrons).toHaveBeenCalledWith(expect.objectContaining({ project_id: 1 }))
  })

  it('TC-U6-3: filters by status active', async () => {
    mockQueryCrons.mockResolvedValueOnce([stubCron])
    await handleQueryCrons({ status: 'active' })
    expect(mockQueryCrons).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }))
  })

  it('TC-U6-4: filters by status paused', async () => {
    mockQueryCrons.mockResolvedValueOnce([])
    await handleQueryCrons({ status: 'paused' })
    expect(mockQueryCrons).toHaveBeenCalledWith(expect.objectContaining({ status: 'paused' }))
  })

  it('TC-U6-5: filters by status deleted', async () => {
    mockQueryCrons.mockResolvedValueOnce([])
    await handleQueryCrons({ status: 'deleted' })
    expect(mockQueryCrons).toHaveBeenCalledWith(expect.objectContaining({ status: 'deleted' }))
  })

  it('TC-U6-6: filters by owner_agent_slug', async () => {
    mockQueryCrons.mockResolvedValueOnce([stubCron])
    await handleQueryCrons({ owner_agent_slug: AGENT })
    expect(mockQueryCrons).toHaveBeenCalledWith(expect.objectContaining({ owner_agent_slug: AGENT }))
  })

  it('TC-U6-7: applies multiple filters together', async () => {
    mockQueryCrons.mockResolvedValueOnce([stubCron])
    await handleQueryCrons({ project_id: 1, status: 'active', owner_agent_slug: AGENT })
    expect(mockQueryCrons).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 1, status: 'active', owner_agent_slug: AGENT }),
    )
  })

  it('TC-U6-8: returns empty array when no crons match', async () => {
    mockQueryCrons.mockResolvedValueOnce([])
    const result = await handleQueryCrons({ project_id: 999 })
    expect(result).toEqual([])
  })

  it('TC-U6-9: .strict() — rejects unknown filter key at schema level', async () => {
    await expect(handleQueryCrons({ unknown_key: 'value' } as any)).rejects.toThrow()
  })

  it('TC-U6-10: rejects invalid status enum at schema level', async () => {
    await expect(handleQueryCrons({ status: 'running' as any })).rejects.toThrow()
  })

  it('TC-U6-11: rejects project_id ≤ 0 at schema level', async () => {
    await expect(handleQueryCrons({ project_id: 0 })).rejects.toThrow()
  })

  it('TC-U6-12: rejects project_id as non-integer at schema level', async () => {
    await expect(handleQueryCrons({ project_id: 1.5 as any })).rejects.toThrow()
  })

  it('TC-U6-13: rejects owner_agent_slug as empty string at schema level', async () => {
    await expect(handleQueryCrons({ owner_agent_slug: '' })).rejects.toThrow()
  })

  it('TC-U6-14: handles DB error from query layer', async () => {
    mockQueryCrons.mockRejectedValueOnce(new Error('DB error'))
    await expect(handleQueryCrons({})).rejects.toThrow('DB error')
  })

  it('TC-U6-15: owner_agent_slug at exactly 100 chars (boundary) accepted', async () => {
    mockQueryCrons.mockResolvedValueOnce([])
    const result = await handleQueryCrons({ owner_agent_slug: 'a'.repeat(100) })
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// TC-U7: query-projects (7 tests)
// ---------------------------------------------------------------------------

describe('TC-U7: query-projects', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC-U7-1: returns all projects with no filters', async () => {
    mockQueryProjects.mockResolvedValueOnce([stubProject])
    const result = await handleQueryProjects({})
    expect(result).toEqual([stubProject])
  })

  it('TC-U7-2: filters by status active', async () => {
    mockQueryProjects.mockResolvedValueOnce([stubProject])
    await handleQueryProjects({ status: 'active' })
    expect(mockQueryProjects).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }))
  })

  it('TC-U7-3: filters by status archived', async () => {
    mockQueryProjects.mockResolvedValueOnce([])
    await handleQueryProjects({ status: 'archived' })
    expect(mockQueryProjects).toHaveBeenCalledWith(expect.objectContaining({ status: 'archived' }))
  })

  it('TC-U7-4: filters by owner_agent_slug', async () => {
    mockQueryProjects.mockResolvedValueOnce([stubProject])
    await handleQueryProjects({ owner_agent_slug: AGENT })
    expect(mockQueryProjects).toHaveBeenCalledWith(expect.objectContaining({ owner_agent_slug: AGENT }))
  })

  it('TC-U7-5: rejects invalid status enum at schema level', async () => {
    await expect(handleQueryProjects({ status: 'deleted' as any })).rejects.toThrow()
  })

  it('TC-U7-6: returns empty array when no projects match', async () => {
    mockQueryProjects.mockResolvedValueOnce([])
    const result = await handleQueryProjects({ owner_agent_slug: 'nobody' })
    expect(result).toEqual([])
  })

  it('TC-U7-7: handles DB error from query layer', async () => {
    mockQueryProjects.mockRejectedValueOnce(new Error('DB error'))
    await expect(handleQueryProjects({})).rejects.toThrow('DB error')
  })
})

// ---------------------------------------------------------------------------
// TC-U8: query-sprints (8 tests)
// ---------------------------------------------------------------------------

describe('TC-U8: query-sprints', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC-U8-1: returns all sprints with no filters', async () => {
    mockQuerySprints.mockResolvedValueOnce([stubSprint])
    const result = await handleQuerySprints({}, AGENT)
    expect(result).toEqual([stubSprint])
  })

  it('TC-U8-2: filters by project_id', async () => {
    mockQuerySprints.mockResolvedValueOnce([stubSprint])
    await handleQuerySprints({ project_id: 1 }, AGENT)
    expect(mockQuerySprints).toHaveBeenCalledWith(expect.objectContaining({ project_id: 1 }), AGENT)
  })

  it('TC-U8-3: filters by sprint_number', async () => {
    mockQuerySprints.mockResolvedValueOnce([stubSprint])
    await handleQuerySprints({ sprint_number: 3 }, AGENT)
    expect(mockQuerySprints).toHaveBeenCalledWith(expect.objectContaining({ sprint_number: 3 }), AGENT)
  })

  it('TC-U8-4: passes agentSlug to DB layer for owner scoping', async () => {
    mockQuerySprints.mockResolvedValueOnce([])
    await handleQuerySprints({}, AGENT)
    expect(mockQuerySprints).toHaveBeenCalledWith(expect.any(Object), AGENT)
  })

  it('TC-U8-5: rejects project_id ≤ 0 at schema level', async () => {
    await expect(handleQuerySprints({ project_id: 0 }, AGENT)).rejects.toThrow()
  })

  it('TC-U8-6: rejects sprint_number ≤ 0 at schema level', async () => {
    await expect(handleQuerySprints({ sprint_number: 0 }, AGENT)).rejects.toThrow()
  })

  it('TC-U8-7: returns empty array when no sprints found', async () => {
    mockQuerySprints.mockResolvedValueOnce([])
    const result = await handleQuerySprints({ project_id: 999 }, AGENT)
    expect(result).toEqual([])
  })

  it('TC-U8-8: handles DB error from query layer', async () => {
    mockQuerySprints.mockRejectedValueOnce(new Error('DB error'))
    await expect(handleQuerySprints({}, AGENT)).rejects.toThrow('DB error')
  })
})

// ---------------------------------------------------------------------------
// TC-U9: query-tasks (9 tests)
// ---------------------------------------------------------------------------

describe('TC-U9: query-tasks', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC-U9-1: returns all tasks with no filters', async () => {
    mockQueryTasks.mockResolvedValueOnce([stubTask])
    const result = await handleQueryTasks({}, AGENT)
    expect(result).toEqual([stubTask])
  })

  it('TC-U9-2: filters by project_id', async () => {
    mockQueryTasks.mockResolvedValueOnce([stubTask])
    await handleQueryTasks({ project_id: 1 }, AGENT)
    expect(mockQueryTasks).toHaveBeenCalledWith(expect.objectContaining({ project_id: 1 }), AGENT)
  })

  it('TC-U9-3: filters by status todo', async () => {
    mockQueryTasks.mockResolvedValueOnce([stubTask])
    await handleQueryTasks({ status: 'todo' }, AGENT)
    expect(mockQueryTasks).toHaveBeenCalledWith(expect.objectContaining({ status: 'todo' }), AGENT)
  })

  it('TC-U9-4: filters by assignee_agent_slug', async () => {
    mockQueryTasks.mockResolvedValueOnce([stubTask])
    await handleQueryTasks({ assignee_agent_slug: AGENT }, AGENT)
    expect(mockQueryTasks).toHaveBeenCalledWith(
      expect.objectContaining({ assignee_agent_slug: AGENT }),
      AGENT,
    )
  })

  it('TC-U9-5: rejects invalid status enum at schema level', async () => {
    await expect(handleQueryTasks({ status: 'cancelled' as any }, AGENT)).rejects.toThrow()
  })

  it('TC-U9-6: rejects project_id ≤ 0 at schema level', async () => {
    await expect(handleQueryTasks({ project_id: 0 }, AGENT)).rejects.toThrow()
  })

  it('TC-U9-7: returns empty array when no tasks match', async () => {
    mockQueryTasks.mockResolvedValueOnce([])
    const result = await handleQueryTasks({ project_id: 999 }, AGENT)
    expect(result).toEqual([])
  })

  it('TC-U9-8: passes agentSlug to DB layer for owner scoping', async () => {
    mockQueryTasks.mockResolvedValueOnce([])
    await handleQueryTasks({}, AGENT)
    expect(mockQueryTasks).toHaveBeenCalledWith(expect.any(Object), AGENT)
  })

  it('TC-U9-9: handles DB error from query layer', async () => {
    mockQueryTasks.mockRejectedValueOnce(new Error('DB error'))
    await expect(handleQueryTasks({}, AGENT)).rejects.toThrow('DB error')
  })
})

// ---------------------------------------------------------------------------
// TC-U11: update-project portfolio matrix (S11-BE-03)
// ---------------------------------------------------------------------------
// S11-BE-03: Portfolio matrix updates only. No ownership restriction.
// Tool-assignment is the access gate. Returns updated project with roi_score.

describe('TC-U11: update-project', () => {
  const stubProjectWithRoi = {
    ...stubProject,
    roi_score: undefined as number | undefined,
  }

  beforeEach(() => { vi.clearAllMocks() })

  it('TC-U11-1: updates business_value only', async () => {
    mockApplyPortfolioUpdate.mockResolvedValueOnce({
      ...stubProjectWithRoi,
      business_value: 3,
      roi_score: undefined,
    })
    const result = await handleUpdateProject({ project_id: 5, business_value: 3 })
    expect(result).toHaveProperty('kind', 'success')
    if (result.kind === 'success') {
      expect(result.project.business_value).toBe(3)
    }
  })

  it('TC-U11-2: updates strategic_fit and effort (multiple fields)', async () => {
    mockApplyPortfolioUpdate.mockResolvedValueOnce({
      ...stubProjectWithRoi,
      strategic_fit: 1,
      effort: 5,
      roi_score: undefined,
    })
    const result = await handleUpdateProject({
      project_id: 5,
      strategic_fit: 1,
      effort: 5,
    })
    expect(result).toHaveProperty('kind', 'success')
    if (result.kind === 'success') {
      expect(result.project.strategic_fit).toBe(1)
      expect(result.project.effort).toBe(5)
    }
  })

  it('TC-U11-3: sets field to null (nullifies score)', async () => {
    mockApplyPortfolioUpdate.mockResolvedValueOnce({
      ...stubProjectWithRoi,
      business_value: null,
      roi_score: null,
    })
    const result = await handleUpdateProject({
      project_id: 5,
      business_value: null,
    })
    expect(result).toHaveProperty('kind', 'success')
    if (result.kind === 'success') {
      expect(result.project.business_value).toBeNull()
      expect(result.roi_score).toBeNull()
    }
  })

  it('TC-U11-4: computes roi_score: (bv × sf) / effort', async () => {
    mockApplyPortfolioUpdate.mockResolvedValueOnce({
      ...stubProjectWithRoi,
      business_value: 5,
      strategic_fit: 3,
      effort: 1,
      roi_score: 15, // (5 * 3) / 1
    })
    const result = await handleUpdateProject({
      project_id: 5,
      business_value: 5,
      strategic_fit: 3,
      effort: 1,
    })
    expect(result).toHaveProperty('kind', 'success')
    if (result.kind === 'success') {
      expect(result.roi_score).toBe(15)
    }
  })

  it('TC-U11-5: returns not_found when project does not exist', async () => {
    mockApplyPortfolioUpdate.mockRejectedValueOnce(new Error('not found'))
    const result = await handleUpdateProject({
      project_id: 999999,
      business_value: 3,
    })
    expect(result).toHaveProperty('kind', 'not_found')
  })

  it('TC-U11-6: NO ownership check (any agent may update any project)', async () => {
    // handler() does not accept agentSlug — no ownership restriction
    // (in old contract, this test checked agentSlug was passed; new contract has no agentSlug param)
    mockApplyPortfolioUpdate.mockResolvedValueOnce({
      ...stubProjectWithRoi,
      business_value: 1,
    })
    const result = await handleUpdateProject({
      project_id: 5,
      business_value: 1,
    })
    expect(result).toBeDefined()
  })

  it('TC-U11-7: rejects project_id ≤ 0 at schema level', async () => {
    expect(() =>
      updateProjectSchema.parse({ project_id: 0, business_value: 3 })
    ).toThrow()
  })

  it('TC-U11-8: rejects business_value not in [1,3,5] at schema level', async () => {
    expect(() =>
      updateProjectSchema.parse({ project_id: 5, business_value: 2 })
    ).toThrow()
  })

  it('TC-U11-9: rejects effort = 4 (not in [1,3,5]) at schema level', async () => {
    expect(() =>
      updateProjectSchema.parse({ project_id: 5, effort: 4 })
    ).toThrow()
  })

  it('TC-U11-10: throws when no fields provided (handler validation)', async () => {
    await expect(
      handleUpdateProject({ project_id: 5 })
    ).rejects.toThrow(/At least one portfolio matrix field must be provided/)
  })
})

// ---------------------------------------------------------------------------
// TC-U13: validatePayload (6 tests)
// ---------------------------------------------------------------------------

describe('TC-U13: validatePayload', () => {
  it('TC-U13-1: returns true for valid plain object', () => {
    expect(validatePayload({ key: 'value', count: 42 })).toBe(true)
  })

  it('TC-U13-2: returns false for array', () => {
    expect(validatePayload([1, 2, 3])).toBe(false)
  })

  it('TC-U13-3: returns false for null', () => {
    expect(validatePayload(null)).toBe(false)
  })

  it('TC-U13-4: returns false for object > 16KB', () => {
    const large = { data: 'x'.repeat(16_385) }
    expect(validatePayload(large)).toBe(false)
  })

  it('TC-U13-5: returns false for object with > 5 nesting levels', () => {
    const deep = { l1: { l2: { l3: { l4: { l5: { l6: 'too deep' } } } } } }
    expect(validatePayload(deep)).toBe(false)
  })

  it('TC-U13-6: returns true for empty object', () => {
    expect(validatePayload({})).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// TC-U14: queryCronsSchema .strict() validation (6 tests)
// ---------------------------------------------------------------------------

describe('TC-U14: queryCronsSchema .strict() validation', () => {
  it('TC-U14-1: rejects unknown key explicitly (strict mode)', async () => {
    await expect(handleQueryCrons({ extra_field: 'oops' } as any)).rejects.toThrow()
  })

  it('TC-U14-2: accepts empty object (all fields optional)', async () => {
    mockQueryCrons.mockResolvedValueOnce([])
    await expect(handleQueryCrons({})).resolves.toBeDefined()
  })

  it('TC-U14-3: rejects status outside enum (strict enum check)', async () => {
    await expect(handleQueryCrons({ status: 'running' as any })).rejects.toThrow()
  })

  it('TC-U14-4: accepts all three valid status values', async () => {
    const statuses = ['active', 'paused', 'deleted'] as const
    for (const status of statuses) {
      mockQueryCrons.mockResolvedValueOnce([])
      await expect(handleQueryCrons({ status })).resolves.toBeDefined()
    }
  })

  it('TC-U14-5: rejects owner_agent_slug as empty string (min 1)', async () => {
    await expect(handleQueryCrons({ owner_agent_slug: '' })).rejects.toThrow()
  })

  it('TC-U14-6: rejects owner_agent_slug > 100 chars', async () => {
    await expect(handleQueryCrons({ owner_agent_slug: 'a'.repeat(101) })).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// TC-U12: update-task (22 tests)
// ---------------------------------------------------------------------------

describe('TC-U12: update-task', () => {
  const stubTaskForUpdate = {
    id: 42,
    project_id: 1,
    title: 'Original Title',
    description: 'Original description',
    status: 'todo' as const,
    assignee_agent_slug: AGENT,
    github_pr_url: null,
    notes: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Happy paths — owner updating all field types (6 tests)
  it('TC-U12-1: owner updates title only', async () => {
    mockUpdateTask.mockResolvedValueOnce({ ...stubTaskForUpdate, title: 'New Title' })

    const result = await handleUpdateTask({ task_id: 42, title: 'New Title' }, AGENT)

    expect(result.title).toBe('New Title')
    expect(mockUpdateTask).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: 42, owner_agent_slug: AGENT, allowAssigneePath: false }),
    )
  })

  it('TC-U12-2: owner updates status to wip', async () => {
    mockUpdateTask.mockResolvedValueOnce({ ...stubTaskForUpdate, status: 'wip' })

    const result = await handleUpdateTask({ task_id: 42, status: 'wip' }, AGENT)

    expect(result.status).toBe('wip')
  })

  it('TC-U12-3: owner updates assignee_agent_slug', async () => {
    mockUpdateTask.mockResolvedValueOnce({ ...stubTaskForUpdate, assignee_agent_slug: 'other-agent' })

    const result = await handleUpdateTask({ task_id: 42, assignee_agent_slug: 'other-agent' }, AGENT)

    expect(result.assignee_agent_slug).toBe('other-agent')
  })

  it('TC-U12-4: owner sets unassign=true', async () => {
    mockUpdateTask.mockResolvedValueOnce({ ...stubTaskForUpdate, assignee_agent_slug: null })

    const result = await handleUpdateTask({ task_id: 42, unassign: true }, AGENT)

    expect(result.assignee_agent_slug).toBeNull()
  })

  it('TC-U12-5: owner updates github_pr_url', async () => {
    const url = 'https://github.com/owner/repo/pull/1'
    mockUpdateTask.mockResolvedValueOnce({ ...stubTaskForUpdate, github_pr_url: url })

    const result = await handleUpdateTask({ task_id: 42, github_pr_url: url }, AGENT)

    expect(result.github_pr_url).toBe(url)
  })

  it('TC-U12-6: owner updates multiple fields at once', async () => {
    mockUpdateTask.mockResolvedValueOnce({ ...stubTaskForUpdate, title: 'Updated', status: 'review' })

    const result = await handleUpdateTask({ task_id: 42, title: 'Updated', status: 'review' }, AGENT)

    expect(result.title).toBe('Updated')
    expect(result.status).toBe('review')
  })

  // Model C field gate: assignee path (3 tests)
  it('TC-U12-7: assignee updates status to pending-close — sets allowAssigneePath=true', async () => {
    mockUpdateTask.mockResolvedValueOnce({ ...stubTaskForUpdate, status: 'pending-close' })

    await handleUpdateTask({ task_id: 42, status: 'pending-close' }, AGENT)

    expect(mockUpdateTask).toHaveBeenCalledWith(
      expect.objectContaining({ allowAssigneePath: true }),
    )
  })

  it('TC-U12-8: owner-only fields present — sets allowAssigneePath=false', async () => {
    mockUpdateTask.mockResolvedValueOnce({ ...stubTaskForUpdate, title: 'Changed' })

    await handleUpdateTask({ task_id: 42, title: 'Changed' }, AGENT)

    expect(mockUpdateTask).toHaveBeenCalledWith(
      expect.objectContaining({ allowAssigneePath: false }),
    )
  })

  it('TC-U12-9: status + owner field — sets allowAssigneePath=false (owner gate wins)', async () => {
    mockUpdateTask.mockResolvedValueOnce({ ...stubTaskForUpdate, status: 'wip', title: 'Also changed' })

    await handleUpdateTask({ task_id: 42, status: 'wip', title: 'Also changed' }, AGENT)

    expect(mockUpdateTask).toHaveBeenCalledWith(
      expect.objectContaining({ allowAssigneePath: false }),
    )
  })

  // Authorization & DB errors (2 tests)
  it('TC-U12-10: returns error when task not found or unauthorized (DB null return)', async () => {
    mockUpdateTask.mockResolvedValueOnce(null)

    const result = await handleUpdateTask({ task_id: 42, status: 'pending-close' }, AGENT)

    expect(result).toHaveProperty('error', 'not_found_or_unauthorized')
  })

  it('TC-U12-11: handles DB error from query layer', async () => {
    // Use a non-M3-intercepted status so the call reaches the DB layer
    mockUpdateTask.mockRejectedValueOnce(new Error('Connection timeout'))

    await expect(
      handleUpdateTask({ task_id: 42, status: 'pending-close' }, AGENT),
    ).rejects.toThrow('Connection timeout')
  })

  // Schema validation errors (11 tests)
  it('TC-U12-12: rejects task_id ≤ 0 at schema level', async () => {
    await expect(
      handleUpdateTask({ task_id: 0 }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U12-13: rejects task_id as non-integer at schema level', async () => {
    await expect(
      handleUpdateTask({ task_id: 42.5 as any }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U12-14: rejects title > 500 chars at schema level', async () => {
    await expect(
      handleUpdateTask({ task_id: 42, title: 'x'.repeat(501) }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U12-15: rejects title as empty string at schema level', async () => {
    await expect(
      handleUpdateTask({ task_id: 42, title: '' }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U12-16: rejects description > 5000 chars at schema level', async () => {
    await expect(
      handleUpdateTask({ task_id: 42, description: 'x'.repeat(5001) }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U12-17: rejects notes > 5000 chars at schema level', async () => {
    await expect(
      handleUpdateTask({ task_id: 42, notes: 'x'.repeat(5001) }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U12-18: rejects invalid status value at schema level', async () => {
    await expect(
      handleUpdateTask({ task_id: 42, status: 'cancelled' as any }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U12-19: rejects invalid github_pr_url at schema level', async () => {
    await expect(
      handleUpdateTask({ task_id: 42, github_pr_url: 'not-a-url' }, AGENT),
    ).rejects.toThrow()
  })

  it('TC-U12-20: rejects unknown assignee_agent_slug at schema level', async () => {
    // Explicitly configure the manifest mock to reject this slug
    mockIsValidAgentSlug.mockReturnValueOnce(false)
    await expect(
      handleUpdateTask({ task_id: 42, assignee_agent_slug: 'nonexistent-agent' }, AGENT),
    ).rejects.toThrow()
  })

  // Edge cases & boundaries (2 tests)
  it('TC-U12-21: accepts all valid status values', async () => {
    // Assignee-path statuses (allowAssigneePath=true — no owner-only fields)
    const assigneeStatuses = ['todo', 'wip', 'review', 'rework', 'pending-close'] as const
    for (const status of assigneeStatuses) {
      mockUpdateTask.mockResolvedValueOnce({ ...stubTaskForUpdate, status })
      const result = await handleUpdateTask({ task_id: 42, status }, AGENT)
      expect(result.status).toBe(status)
    }

    // Owner path: `done` requires at least one owner-only field (e.g. notes)
    // so that allowAssigneePath=false and M3 does not fire.
    mockUpdateTask.mockResolvedValueOnce({ ...stubTaskForUpdate, status: 'done' })
    const ownerClose = await handleUpdateTask({ task_id: 42, status: 'done', notes: 'Approved.' }, AGENT)
    expect(ownerClose.status).toBe('done')
  })

  it('TC-U12-22: title at exactly 500 chars (boundary) accepted', async () => {
    const titleAt500 = 'x'.repeat(500)
    mockUpdateTask.mockResolvedValueOnce({ ...stubTaskForUpdate, title: titleAt500 })

    const result = await handleUpdateTask({ task_id: 42, title: titleAt500 }, AGENT)

    expect(result.title).toHaveLength(500)
  })

  // M3 gate (ARCH-023) — 2 tests required by Locksmith
  it('TC-U12-M3-1: assignee direct done write is blocked (M3 gate)', async () => {
    // When only `status` is present, allowAssigneePath=true. `done` on the
    // assignee path must be rejected before the DB is called.
    const result = await handleUpdateTask({ task_id: 42, status: 'done' }, AGENT)

    expect(result).toHaveProperty('error', 'not_found_or_unauthorized')
    expect(mockUpdateTask).not.toHaveBeenCalled()
  })

  it('TC-U12-M3-2: assignee self-approval of pending-close is blocked (M3 gate)', async () => {
    // An assignee whose task is pending-close cannot self-approve by setting
    // status: done directly. The handler does not see the current task status;
    // M3 fires on the target status: `done` on the assignee path is always rejected.
    const result = await handleUpdateTask({ task_id: 42, status: 'done' }, AGENT)

    expect(result).toHaveProperty('error', 'not_found_or_unauthorized')
    expect(mockUpdateTask).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// TC-U15: get-project-board (5 tests)
// ---------------------------------------------------------------------------

describe('TC-U15: get-project-board', () => {
  const stubBoard = {
    id: 5,
    slug: 'test-project',
    name: 'Test Project',
    tasks: [{ id: 1, status: 'todo', title: 'Task 1' }],
  }

  beforeEach(() => { vi.clearAllMocks() })

  it('TC-U15-1: returns board for owned project', async () => {
    mockGetProjectBoard.mockResolvedValueOnce(stubBoard)
    const result = await handleGetProjectBoard({ slug: 'test-project' }, AGENT)
    expect(result).toEqual(stubBoard)
    expect(mockGetProjectBoard).toHaveBeenCalledWith({ slug: 'test-project', owner_agent_slug: AGENT })
  })

  it('TC-U15-2: returns error when project not found or not owned', async () => {
    mockGetProjectBoard.mockResolvedValueOnce(null)
    const result = await handleGetProjectBoard({ slug: 'other-project' }, AGENT)
    expect(result).toHaveProperty('error', 'not_found_or_unauthorized')
  })

  it('TC-U15-3: rejects empty slug at schema level', async () => {
    await expect(handleGetProjectBoard({ slug: '' }, AGENT)).rejects.toThrow()
  })

  it('TC-U15-4: handles DB error from query layer', async () => {
    mockGetProjectBoard.mockRejectedValueOnce(new Error('DB error'))
    await expect(handleGetProjectBoard({ slug: 'test-project' }, AGENT)).rejects.toThrow('DB error')
  })

  it('TC-U15-5: passes agentSlug as owner_agent_slug to DB layer', async () => {
    mockGetProjectBoard.mockResolvedValueOnce(stubBoard)
    await handleGetProjectBoard({ slug: 'my-project' }, 'specific-agent')
    expect(mockGetProjectBoard).toHaveBeenCalledWith(
      expect.objectContaining({ owner_agent_slug: 'specific-agent' }),
    )
  })
})

// ---------------------------------------------------------------------------
// TC-U16: get-company-ethos (6 tests)
// ---------------------------------------------------------------------------

describe('TC-U16: get-company-ethos', () => {
  const validCompanyBlock = {
    name: 'Input Output Labs',
    mission: 'Build the future',
    three_year_picture: 'Industry leader in AI tooling',
    niche: 'AI-native software teams',
    values: ['Transparency', 'Velocity', 'Quality'],
  }

  beforeEach(() => { vi.clearAllMocks() })

  it('TC-U16-1: returns configured=true with company block when seal is active', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ payload: { company: validCompanyBlock } }] } as any)
    const result = await handleGetCompanyEthos()
    expect(result).toMatchObject({ configured: true, name: 'Input Output Labs' })
  })

  it('TC-U16-2: returns configured=false when no active seal exists', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] } as any)
    const result = await handleGetCompanyEthos()
    expect(result).toMatchObject({ configured: false })
  })

  it('TC-U16-3: returns configured=false when company block is missing from payload', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ payload: {} }] } as any)
    const result = await handleGetCompanyEthos()
    expect(result).toMatchObject({ configured: false })
  })

  it('TC-U16-4: returns configured=false when company block is missing required field', async () => {
    const incomplete = { name: 'IO Labs', mission: 'Build', three_year_picture: 'Big' }
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ payload: { company: incomplete } }] } as any)
    const result = await handleGetCompanyEthos()
    expect(result).toMatchObject({ configured: false })
  })

  it('TC-U16-5: returns all company fields when seal is valid', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ payload: { company: validCompanyBlock } }] } as any)
    const result = await handleGetCompanyEthos()
    expect(result).toMatchObject({
      configured: true,
      name: validCompanyBlock.name,
      mission: validCompanyBlock.mission,
      three_year_picture: validCompanyBlock.three_year_picture,
      values: validCompanyBlock.values,
      niche: validCompanyBlock.niche,
    })
  })

  it('TC-U16-6: handles DB error from pool query', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('DB connection failed'))
    await expect(handleGetCompanyEthos()).rejects.toThrow('DB connection failed')
  })
})

// ---------------------------------------------------------------------------
// TC-U17: report-usage (13 tests)
// ARCH-015 LLM usage ingestion via POST /internal/usage endpoint
// ---------------------------------------------------------------------------

describe('TC-U17: report-usage', () => {
  const mockFetch = vi.mocked(global.fetch)

  const validPayload = {
    session_id: 'test-agent:session-id:1234567890123',
    loop_index: 0,
    agent_slug: 'test-agent',
    model: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    prompt_tokens: 500,
    completion_tokens: 200,
    cost_usd: 39.9,
  }

  beforeEach(() => {
    mockFetch.mockClear()
  })

  it('TC-U17-1: posts valid payload successfully to squad-api', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: async () => 'Created',
    } as any)

    const result = await handleReportUsage(validPayload)
    expect(result).toMatchObject({
      success: true,
    })
    expect(result.message).toContain('successfully')
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3005/internal/usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-ingestion-token-0123456789abcdef0123456789abcdef',
      },
      body: JSON.stringify(validPayload),
    })
  })

  it('TC-U17-2: validates schema before attempting POST', async () => {
    // Schema validation happens before any network call
    const invalidPayload = { ...validPayload, session_id: 'invalid-format' }
    await expect(handleReportUsage(invalidPayload as any)).rejects.toThrow()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('TC-U17-3: rejects payload missing required cost_usd field', async () => {
    const { cost_usd, ...payloadWithoutCost } = validPayload
    await expect(handleReportUsage(payloadWithoutCost as any)).rejects.toThrow()
  })

  it('TC-U17-4: rejects payload with unknown fields (strict mode)', async () => {
    const payloadWithExtra = { ...validPayload, unknown_field: 'value' }
    await expect(handleReportUsage(payloadWithExtra as any)).rejects.toThrow()
  })

  it('TC-U17-5: includes optional cache_read_tokens when provided', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201, text: async () => 'OK' } as any)

    const payloadWithCache = {
      ...validPayload,
      cache_read_tokens: 100,
    }

    const result = await handleReportUsage(payloadWithCache)
    expect(result.success).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.stringContaining('"cache_read_tokens":100'),
      }),
    )
  })

  it('TC-U17-6: includes optional cache_creation_tokens when provided', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201, text: async () => 'OK' } as any)

    const payloadWithCache = {
      ...validPayload,
      cache_creation_tokens: 50,
    }

    const result = await handleReportUsage(payloadWithCache)
    expect(result.success).toBe(true)
  })

  it('TC-U17-7: includes optional task_id when provided', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201, text: async () => 'OK' } as any)

    const payloadWithTask = { ...validPayload, task_id: 42 }
    const result = await handleReportUsage(payloadWithTask)
    expect(result.success).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.stringContaining('"task_id":42'),
      }),
    )
  })

  it('TC-U17-8: handles 401 Unauthorized from squad-api', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    } as any)

    const result = await handleReportUsage(validPayload)
    expect(result.success).toBe(false)
    expect(result.statusCode).toBe(401)
    expect(result.message).toContain('401')
  })

  it('TC-U17-9: handles 403 Forbidden from squad-api', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    } as any)

    const result = await handleReportUsage(validPayload)
    expect(result.success).toBe(false)
    expect(result.statusCode).toBe(403)
  })

  it('TC-U17-10: handles 500 server error from squad-api', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as any)

    const result = await handleReportUsage(validPayload)
    expect(result.success).toBe(false)
    expect(result.statusCode).toBe(500)
  })

  it('TC-U17-11: handles network error (fetch fails)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network timeout'))

    const result = await handleReportUsage(validPayload)
    expect(result.success).toBe(false)
    expect(result.message).toContain('Network timeout')
  })

  it('TC-U17-12: reports cost and model in success message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: async () => 'Created',
    } as any)

    const result = await handleReportUsage(validPayload)
    expect(result.success).toBe(true)
    expect(result.message).toContain('39.9')
    expect(result.message).toContain('Claude Sonnet 4.6')
  })

  it('TC-U17-13: handles empty response body gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
    } as any)

    const result = await handleReportUsage(validPayload)
    expect(result.success).toBe(true)
  })
})
