/**
 * tests/composables/useTriagePromote.test.ts
 *
 * Unit tests for useTriagePromote composable
 * Tests: API contract, error handling, state management, callbacks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useTriagePromote } from '../../src/composables/useTriagePromote'
import type { Task } from '../../src/types/api'

// Mock global fetch
global.fetch = vi.fn()

describe('useTriagePromote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('promote success (200 OK)', () => {
    it('should promote a task from triage to todo', async () => {
      const mockTask: Task = {
        id: 'task-123',
        title: 'Test Task',
        description: 'Test Description',
        status: 'todo',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockTask,
      } as Response)

      const { promote, status, error, promotedTask } = useTriagePromote()

      const result = await promote('task-123')

      expect(result).toEqual(mockTask)
      expect(status.value).toBe('success')
      expect(error.value).toBeNull()
      expect(promotedTask.value).toEqual(mockTask)
      
      // Verify endpoint was called with PATCH method
      const callArgs = vi.mocked(fetch).mock.calls[0]
      expect(callArgs[0]).toBe('/api/integrations/triage/task-123/promote')
      expect(callArgs[1]?.method).toBe('PATCH')
    })

    it('should call onSuccess callback on successful promotion', async () => {
      const onSuccess = vi.fn()
      const mockTask: Task = {
        id: 'task-123',
        title: 'Test Task',
        description: 'Test Description',
        status: 'todo',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockTask,
      } as Response)

      const { promote } = useTriagePromote({ onSuccess })

      await promote('task-123')

      expect(onSuccess).toHaveBeenCalledWith(mockTask)
    })
  })

  describe('promote error handling', () => {
    it('should handle 404 not found', async () => {
      const onError = vi.fn()
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'not_found' }),
      } as Response)

      const { promote, status, error } = useTriagePromote({ onError })

      const result = await promote('nonexistent-task')

      expect(result).toBeNull()
      expect(status.value).toBe('not-found')
      expect(error.value?.code).toBe('not-found')
      expect(error.value?.message).toContain('not found')
      expect(onError).toHaveBeenCalled()
    })

    it('should handle 409 invalid state (not in triage)', async () => {
      const onError = vi.fn()
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: 'invalid_state' }),
      } as Response)

      const { promote, status, error } = useTriagePromote({ onError })

      const result = await promote('task-123')

      expect(result).toBeNull()
      expect(status.value).toBe('invalid-state')
      expect(error.value?.code).toBe('invalid-state')
      expect(error.value?.message).toContain('not in triage')
      expect(onError).toHaveBeenCalled()
    })

    it('should handle 422 invalid target', async () => {
      const onError = vi.fn()
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ message: 'Invalid target status' }),
      } as Response)

      const { promote, status, error } = useTriagePromote({ onError })

      const result = await promote('task-123')

      expect(result).toBeNull()
      expect(status.value).toBe('error')
      expect(error.value?.code).toBe('invalid-target')
      expect(onError).toHaveBeenCalled()
    })

    it('should handle network errors', async () => {
      const onError = vi.fn()
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'))

      const { promote, status, error } = useTriagePromote({ onError })

      const result = await promote('task-123')

      expect(result).toBeNull()
      expect(status.value).toBe('error')
      expect(error.value?.code).toBe('network-error')
      expect(error.value?.statusCode).toBe(0)
      expect(onError).toHaveBeenCalled()
    })

    it('should handle malformed JSON response', async () => {
      const onError = vi.fn()
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Invalid JSON')
        },
      } as Response)

      const { promote, status, error } = useTriagePromote({ onError })

      const result = await promote('task-123')

      expect(result).toBeNull()
      expect(status.value).toBe('error')
      expect(onError).toHaveBeenCalled()
    })
  })

  describe('state management', () => {
    it('should track promoting state', async () => {
      const { promote, isPromoting, status } = useTriagePromote()

      const mockTask: Task = {
        id: 'task-123',
        title: 'Test',
        description: '',
        status: 'todo',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockTask,
      } as Response)

      expect(isPromoting.value).toBe(false)
      expect(status.value).toBe('idle')

      const promiseResult = promote('task-123')
      expect(status.value).toBe('promoting')

      await promiseResult

      expect(isPromoting.value).toBe(false)
      expect(status.value).toBe('success')
    })

    it('should reset state', async () => {
      const mockTask: Task = {
        id: 'task-123',
        title: 'Test',
        description: '',
        status: 'todo',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockTask,
      } as Response)

      const { promote, status, error, promotedTask, reset } = useTriagePromote()

      await promote('task-123')

      expect(status.value).toBe('success')
      expect(promotedTask.value).toEqual(mockTask)

      reset()

      expect(status.value).toBe('idle')
      expect(error.value).toBeNull()
      expect(promotedTask.value).toBeNull()
    })
  })

  describe('API contract verification', () => {
    it('should use correct endpoint path with task ID', async () => {
      const mockTask: Task = {
        id: 'task-456',
        title: 'Test',
        description: '',
        status: 'todo',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockTask,
      } as Response)

      const { promote } = useTriagePromote()

      await promote('task-456')

      const callArgs = vi.mocked(fetch).mock.calls[0]
      expect(callArgs[0]).toBe('/api/integrations/triage/task-456/promote')
    })

    it('should use PATCH method', async () => {
      const mockTask: Task = {
        id: 'task-123',
        title: 'Test',
        description: '',
        status: 'todo',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockTask,
      } as Response)

      const { promote } = useTriagePromote()

      await promote('task-123')

      const callArgs = vi.mocked(fetch).mock.calls[0]
      expect(callArgs[1]?.method).toBe('PATCH')
    })

    it('should include Content-Type header', async () => {
      const mockTask: Task = {
        id: 'task-123',
        title: 'Test',
        description: '',
        status: 'todo',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockTask,
      } as Response)

      const { promote } = useTriagePromote()

      await promote('task-123')

      const callArgs = vi.mocked(fetch).mock.calls[0]
      expect(callArgs[1]?.headers).toMatchObject({
        'Content-Type': 'application/json',
      })
    })
  })
})
