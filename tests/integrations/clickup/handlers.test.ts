import { describe, it, expect, beforeEach, vi } from 'vitest'
import { handleClickUpTaskCreated, handleClickUpTaskUpdated, handleClickUpTaskDeleted } from '../../../src/integrations/clickup/index'
import { pool } from '../../../src/db/client'
import type { WebhookPayload } from '../../../src/integrations/adapter'

// Mock the pool
vi.mock('../../../src/db/client', () => ({
  pool: {
    query: vi.fn(),
  },
}))

// Mock global fetch
global.fetch = vi.fn()

const mockClickUpTaskResponse = {
  id: '86aj2t818',
  name: 'Fix authentication bug in login flow',
  description: 'Users unable to login with OAuth. Investigate token refresh endpoint.',
  list: {
    id: '901327582339',
  },
  attachments: [
    {
      id: 'att_001',
      title: 'error-log.txt',
      url: 'https://app.clickup.com/files/...001',
    },
  ],
}

// Mock environment variables
beforeEach(() => {
  vi.stubEnv('CLICKUP_BOT_API_TOKEN', 'test-token-123')
  vi.stubEnv('CLICKUP_BOT_USER_ID', 'user-123')
})

describe('handleClickUpTaskCreated', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create task with preserved title, description, and attachments', async () => {
    const taskId = '86aj2t818'
    const payload: WebhookPayload = {
      event: 'taskCreated',
      data: {
        id: taskId,
        list_id: '901327582339',
      },
    }

    // Mock fetch for ClickUp API call
    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockClickUpTaskResponse,
    })

    // Mock dedup check: no existing link
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [],
    })

    // Mock task creation
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [{ id: 1819 }],
    })

    // Mock external_task_links creation
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [{ id: 1 }],
    })

    await handleClickUpTaskCreated(taskId, payload)

    // Verify fetch was called with correct ClickUp API URL
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v2/task/${taskId}`),
      expect.any(Object)
    )

    // Verify task creation was called
    const taskInsertCall = (pool.query as any).mock.calls.find(
      (call: any) => call[0].includes('INSERT INTO tasks')
    )
    expect(taskInsertCall).toBeDefined()
  })

  it('should skip if task already linked (dedup guard)', async () => {
    const taskId = '86aj2t818'
    const payload: WebhookPayload = {
      event: 'taskCreated',
      data: {
        id: taskId,
        list_id: '901327582339',
      },
    }

    // Mock dedup check: existing link found
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [{ task_id: 1234 }],
    })

    await handleClickUpTaskCreated(taskId, payload)

    // Verify fetch was NOT called (early return)
    expect(global.fetch).not.toHaveBeenCalled()

    // Only one query should have been made (the dedup check)
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('should throw on ClickUp API error (500)', async () => {
    const taskId = '86aj2t818'
    const payload: WebhookPayload = {
      event: 'taskCreated',
      data: {
        id: taskId,
        list_id: '901327582339',
      },
    }

    // Mock dedup check: no existing link
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [],
    })

    // Mock fetch error response
    ;(global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })

    await expect(handleClickUpTaskCreated(taskId, payload)).rejects.toThrow()
  })

  it('should handle missing attachments gracefully', async () => {
    const taskId = '86aj2t818'
    const payload: WebhookPayload = {
      event: 'taskCreated',
      data: {
        id: taskId,
        list_id: '901327582339',
      },
    }

    const responseWithoutAttachments = {
      ...mockClickUpTaskResponse,
      attachments: [],
    }

    // Mock fetch for ClickUp API call
    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => responseWithoutAttachments,
    })

    // Mock dedup check: no existing link
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [],
    })

    // Mock task creation
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [{ id: 1819 }],
    })

    // Mock external_task_links creation
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [{ id: 1 }],
    })

    await handleClickUpTaskCreated(taskId, payload)

    // Verify task was created
    const taskInsertCall = (pool.query as any).mock.calls.find(
      (call: any) => call[0].includes('INSERT INTO tasks')
    )
    expect(taskInsertCall).toBeDefined()

    // Description should not include "Attachments:" when there are none
    const description = taskInsertCall[1][2]
    expect(description).not.toContain('Attachments:')
  })

  it('should route to correct project via LIST_ID_TO_PROJECT_MAPPING', async () => {
    const taskId = '86aj2t818'
    const listId = '901327582339'
    const payload: WebhookPayload = {
      event: 'taskCreated',
      data: {
        id: taskId,
        list_id: listId,
      },
    }

    const response = {
      ...mockClickUpTaskResponse,
      list: {
        id: listId,
      },
    }

    // Mock fetch for ClickUp API call
    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => response,
    })

    // Mock dedup check: no existing link
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [],
    })

    // Mock task creation
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [{ id: 1819 }],
    })

    // Mock external_task_links creation
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [{ id: 1 }],
    })

    await handleClickUpTaskCreated(taskId, payload)

    // Verify task insert includes correct project_id based on mapping or default
    const taskInsertCall = (pool.query as any).mock.calls.find(
      (call: any) => call[0].includes('INSERT INTO tasks')
    )
    expect(taskInsertCall).toBeDefined()
  })

  it('should fallback to project 71 if list_id missing', async () => {
    const taskId = '86aj2t818'
    const payload: WebhookPayload = {
      event: 'taskCreated',
      data: {
        id: taskId,
      },
    }

    const responseWithoutList = {
      ...mockClickUpTaskResponse,
      list: undefined,
    }

    // Mock fetch for ClickUp API call
    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => responseWithoutList,
    })

    // Mock dedup check: no existing link
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [],
    })

    // Mock task creation
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [{ id: 1819 }],
    })

    // Mock external_task_links creation
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [{ id: 1 }],
    })

    await handleClickUpTaskCreated(taskId, payload)

    // Verify task insert includes default project_id of 71
    const taskInsertCall = (pool.query as any).mock.calls.find(
      (call: any) => call[0].includes('INSERT INTO tasks')
    )
    expect(taskInsertCall).toBeDefined()

    const projectId = taskInsertCall[1][0]
    expect(projectId).toBe(71)
  })

  it('should throw if CLICKUP_BOT_API_TOKEN not configured', async () => {
    const taskId = '86aj2t818'
    const payload: WebhookPayload = {
      event: 'taskCreated',
      data: {
        id: taskId,
        list_id: '901327582339',
      },
    }

    // Clear the API token env var temporarily
    const originalToken = process.env['CLICKUP_BOT_API_TOKEN']
    delete process.env['CLICKUP_BOT_API_TOKEN']

    // Mock dedup check: no existing link
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [],
    })

    try {
      await expect(handleClickUpTaskCreated(taskId, payload)).rejects.toThrow('CLICKUP_BOT_API_TOKEN')
    } finally {
      // Restore the env var
      if (originalToken) {
        process.env['CLICKUP_BOT_API_TOKEN'] = originalToken
      }
    }
  })

  it('should throw if database error on dedup check', async () => {
    const taskId = '86aj2t818'
    const payload: WebhookPayload = {
      event: 'taskCreated',
      data: {
        id: taskId,
        list_id: '901327582339',
      },
    }

    // Mock database error on dedup query
    ;(pool.query as any).mockRejectedValueOnce(new Error('Connection timeout'))

    await expect(handleClickUpTaskCreated(taskId, payload)).rejects.toThrow('Connection timeout')
  })

  it('should throw if database error on task creation', async () => {
    const taskId = '86aj2t818'
    const payload: WebhookPayload = {
      event: 'taskCreated',
      data: {
        id: taskId,
        list_id: '901327582339',
      },
    }

    // Mock fetch for ClickUp API call
    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockClickUpTaskResponse,
    })

    // Mock dedup check: no existing link
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [],
    })

    // Mock task creation failure
    ;(pool.query as any).mockRejectedValueOnce(new Error('Unique constraint violation'))

    await expect(handleClickUpTaskCreated(taskId, payload)).rejects.toThrow('Unique constraint violation')
  })
})

describe('handleClickUpTaskUpdated', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should find linked task and update status', async () => {
    const clickupTaskId = '86aj2t818'
    const payload: WebhookPayload = {
      event: 'taskUpdated',
      data: {
        id: clickupTaskId,
      },
    }

    // Mock find linked task
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [{ task_id: 1819 }],
    })

    // Mock task update
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [{ id: 1819 }],
    })

    await handleClickUpTaskUpdated(clickupTaskId, payload)

    // Verify the linked task was found
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('external_task_links'),
      [clickupTaskId, 'clickup']
    )
  })

  it('should skip if no linked task found (unhappy path)', async () => {
    const clickupTaskId = '86aj2t818'
    const payload: WebhookPayload = {
      event: 'taskUpdated',
      data: {
        id: clickupTaskId,
      },
    }

    // Mock find linked task: no rows returned
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [],
    })

    await handleClickUpTaskUpdated(clickupTaskId, payload)

    // Verify only the lookup query was made (no updates)
    expect(pool.query).toHaveBeenCalledTimes(1)
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('external_task_links'),
      [clickupTaskId, 'clickup']
    )
  })

  it('should throw if database error on external_task_links lookup', async () => {
    const clickupTaskId = '86aj2t818'
    const payload: WebhookPayload = {
      event: 'taskUpdated',
      data: {
        id: clickupTaskId,
      },
    }

    // Mock database error
    ;(pool.query as any).mockRejectedValueOnce(new Error('Connection timeout'))

    await expect(handleClickUpTaskUpdated(clickupTaskId, payload)).rejects.toThrow('Connection timeout')
  })
})

describe('handleClickUpTaskDeleted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should find linked task and mark as deleted', async () => {
    const clickupTaskId = '86aj2t818'
    const payload: WebhookPayload = {
      event: 'taskDeleted',
      data: {
        id: clickupTaskId,
      },
    }

    // Mock find linked task
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [{ task_id: 1819 }],
    })

    // Mock task delete (status update to pending-close)
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [{ id: 1819 }],
    })

    await handleClickUpTaskDeleted(clickupTaskId, payload)

    // Verify the linked task was found
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('external_task_links'),
      [clickupTaskId, 'clickup']
    )
  })

  it('should skip if no linked task found (unhappy path)', async () => {
    const clickupTaskId = '86aj2t818'
    const payload: WebhookPayload = {
      event: 'taskDeleted',
      data: {
        id: clickupTaskId,
      },
    }

    // Mock find linked task: no rows returned
    ;(pool.query as any).mockResolvedValueOnce({
      rows: [],
    })

    await handleClickUpTaskDeleted(clickupTaskId, payload)

    // Verify only the lookup query was made (no status updates)
    expect(pool.query).toHaveBeenCalledTimes(1)
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('external_task_links'),
      [clickupTaskId, 'clickup']
    )
  })

  it('should throw if database error on external_task_links lookup', async () => {
    const clickupTaskId = '86aj2t818'
    const payload: WebhookPayload = {
      event: 'taskDeleted',
      data: {
        id: clickupTaskId,
      },
    }

    // Mock database error
    ;(pool.query as any).mockRejectedValueOnce(new Error('Connection timeout'))

    await expect(handleClickUpTaskDeleted(clickupTaskId, payload)).rejects.toThrow('Connection timeout')
  })
})
