/**
 * tests/utilities/update-task.test.ts
 *
 * S7-01: unit tests for handleUpdateTask — Model C hybrid permission field gate.
 *
 * Model C (decided 2026-05-21):
 *   - Project owner: may update ALL fields.
 *   - Assignee: may update the `status` field ONLY on tasks assigned to them.
 *
 * The handler enforces the field gate by computing allowAssigneePath=true only
 * when no owner-only fields are present in the request. The DB enforces the
 * row gate. These tests verify the handler's field gate logic in isolation.
 *
 * updateTask (DB layer) is mocked — DB integration coverage is in S7-07.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the DB query function before importing the handler.
// This intercepts the import in update-task.ts without touching the DB.
vi.mock('../../src/db/queries/tasks.js', () => ({
  updateTask: vi.fn(),
  ALLOWED_TASK_FILTERS: ['project_id', 'status', 'assignee_agent_slug'],
}))

// Import after mock is registered.
import { handleUpdateTask } from '../../src/utilities/update-task.js'
import { updateTask } from '../../src/db/queries/tasks.js'

const mockUpdateTask = vi.mocked(updateTask)

// A minimal Task-like object for mock return values (fields not under test omitted).
const stubTask = {
  id: 42,
  project_id: 1,
  title: 'Test Task',
  description: null,
  status: 'todo',
  assignee_agent_slug: null,
  github_pr_url: null,
  notes: null,
  created_at: new Date(),
  updated_at: new Date(),
}

describe('handleUpdateTask — Model C field gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateTask.mockResolvedValue(stubTask)
  })

  // -------------------------------------------------------------------------
  // allowAssigneePath = true paths (status-only requests)
  // -------------------------------------------------------------------------

  it('sets allowAssigneePath=true when only status is provided', async () => {
    await handleUpdateTask({ task_id: 1, status: 'wip' }, 'cooper')

    expect(mockUpdateTask).toHaveBeenCalledWith(
      expect.objectContaining({ allowAssigneePath: true }),
    )
  })

  it('sets allowAssigneePath=true when task_id + status only (typical assignee update)', async () => {
    await handleUpdateTask({ task_id: 99, status: 'done' }, 'silas')

    expect(mockUpdateTask).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: 99, status: 'done', allowAssigneePath: true }),
    )
  })

  // -------------------------------------------------------------------------
  // allowAssigneePath = false paths (owner-only fields present)
  // -------------------------------------------------------------------------

  it('sets allowAssigneePath=false when title is provided', async () => {
    await handleUpdateTask({ task_id: 1, title: 'New Title' }, 'murphy')

    expect(mockUpdateTask).toHaveBeenCalledWith(
      expect.objectContaining({ allowAssigneePath: false }),
    )
  })

  it('sets allowAssigneePath=false when description is provided', async () => {
    await handleUpdateTask({ task_id: 1, description: 'Updated desc' }, 'murphy')

    expect(mockUpdateTask).toHaveBeenCalledWith(
      expect.objectContaining({ allowAssigneePath: false }),
    )
  })

  it('sets allowAssigneePath=false when unassign is provided', async () => {
    await handleUpdateTask({ task_id: 1, unassign: true }, 'murphy')

    expect(mockUpdateTask).toHaveBeenCalledWith(
      expect.objectContaining({ allowAssigneePath: false }),
    )
  })

  it('sets allowAssigneePath=false when assignee_agent_slug is provided', async () => {
    // murphy is a valid agent slug per squad.manifest.json
    await handleUpdateTask({ task_id: 1, assignee_agent_slug: 'murphy' }, 'elizabeth')

    expect(mockUpdateTask).toHaveBeenCalledWith(
      expect.objectContaining({ allowAssigneePath: false }),
    )
  })

  it('sets allowAssigneePath=false when github_pr_url is provided', async () => {
    await handleUpdateTask({ task_id: 1, github_pr_url: 'https://github.com/org/repo/pull/1' }, 'murphy')

    expect(mockUpdateTask).toHaveBeenCalledWith(
      expect.objectContaining({ allowAssigneePath: false }),
    )
  })

  it('sets allowAssigneePath=false when notes is provided', async () => {
    await handleUpdateTask({ task_id: 1, notes: 'Some notes' }, 'murphy')

    expect(mockUpdateTask).toHaveBeenCalledWith(
      expect.objectContaining({ allowAssigneePath: false }),
    )
  })

  it('sets allowAssigneePath=false when status AND title are both provided', async () => {
    await handleUpdateTask({ task_id: 1, status: 'wip', title: 'New Title' }, 'murphy')

    expect(mockUpdateTask).toHaveBeenCalledWith(
      expect.objectContaining({ allowAssigneePath: false }),
    )
  })

  // -------------------------------------------------------------------------
  // Error path
  // -------------------------------------------------------------------------

  it('returns not_found_or_unauthorized when updateTask returns undefined', async () => {
    mockUpdateTask.mockResolvedValue(undefined)

    const result = await handleUpdateTask({ task_id: 1, status: 'wip' }, 'unknown-agent')

    expect(result).toEqual({
      error: 'not_found_or_unauthorized',
      message: 'Task not found or you are not authorized to update it.',
    })
  })

  it('passes the caller agentSlug as owner_agent_slug', async () => {
    await handleUpdateTask({ task_id: 5, status: 'review' }, 'locksmith')

    expect(mockUpdateTask).toHaveBeenCalledWith(
      expect.objectContaining({ owner_agent_slug: 'locksmith' }),
    )
  })
})
