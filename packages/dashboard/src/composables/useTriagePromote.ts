/**
 * packages/dashboard/src/composables/useTriagePromote.ts
 *
 * API integration composable for promoting tasks from triage → todo status.
 * Handles: request state, success/error handling, retry logic.
 * See: ARCH-024 (triage inbox promotion workflow)
 */

import { ref, computed } from 'vue'
import type { Task } from '../types/api'

export type PromoteStatus = 'idle' | 'promoting' | 'success' | 'error' | 'not-found' | 'invalid-state'

export interface UseTriagePromoteOptions {
  onSuccess?: (task: Task) => void
  onError?: (error: PromoteError) => void
}

export interface PromoteError {
  code: 'not-found' | 'invalid-state' | 'invalid-target' | 'server-error' | 'network-error'
  statusCode: number
  message: string
}

/**
 * useTriagePromote — promote a triage task to todo status.
 *
 * Usage:
 *   const { promote, isPromoting, error, promotedTask } = useTriagePromote()
 *   await promote(taskId) → Task on success, null on error
 */
export function useTriagePromote(options?: UseTriagePromoteOptions) {
  // ── State ────────────────────────────────────────────────────────────────
  const status = ref<PromoteStatus>('idle')
  const error = ref<PromoteError | null>(null)
  const promotedTask = ref<Task | null>(null)
  const isPromoting = computed(() => status.value === 'promoting')

  // ── Promote action ───────────────────────────────────────────────────────
  async function promote(taskId: string): Promise<Task | null> {
    status.value = 'promoting'
    error.value = null
    promotedTask.value = null

    const token = import.meta.env['VITE_DASHBOARD_AGENT_TOKEN'] as string | undefined

    try {
      // Call backend endpoint: PATCH /api/integrations/triage/:id/promote
      const response = await fetch(`/api/integrations/triage/${encodeURIComponent(taskId)}/promote`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })

      let responseBody: unknown

      try {
        responseBody = await response.json()
      } catch {
        throw new Error(`Unexpected response from API (HTTP ${response.status})`)
      }

      // Handle HTTP errors
      if (!response.ok) {
        const errBody = responseBody as { error?: string; message?: string }
        let promoteError: PromoteError

        switch (response.status) {
          case 404:
            promoteError = {
              code: 'not-found',
              statusCode: 404,
              message: `Task #${taskId} not found.`,
            }
            break

          case 409:
            promoteError = {
              code: 'invalid-state',
              statusCode: 409,
              message: `Task is not in triage status. Current status cannot be promoted.`,
            }
            break

          case 422:
            promoteError = {
              code: 'invalid-target',
              statusCode: 422,
              message: errBody?.message || 'Invalid target status supplied.',
            }
            break

          default:
            promoteError = {
              code: 'server-error',
              statusCode: response.status,
              message: errBody?.message || `Server error: ${response.status}`,
            }
        }

        error.value = promoteError
        status.value = promoteError.code === 'not-found' ? 'not-found' : promoteError.code === 'invalid-state' ? 'invalid-state' : 'error'

        // Callback hook
        options?.onError?.(promoteError)

        return null
      }

      // Success: extract promoted task
      const task = responseBody as Task
      promotedTask.value = task
      status.value = 'success'

      // Callback hook
      options?.onSuccess?.(task)

      return task
    } catch (err: unknown) {
      // Network error (fetch threw)
      const promoteError: PromoteError = {
        code: 'network-error',
        statusCode: 0,
        message: err instanceof Error ? err.message : 'Network error. Check your connection and try again.',
      }

      error.value = promoteError
      status.value = 'error'

      // Callback hook
      options?.onError?.(promoteError)

      return null
    }
  }

  // ── Reset for reuse ──────────────────────────────────────────────────────
  function reset() {
    status.value = 'idle'
    error.value = null
    promotedTask.value = null
  }

  return {
    // State
    status,
    isPromoting,
    error,
    promotedTask,

    // Actions
    promote,
    reset,
  }
}
