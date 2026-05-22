/**
 * tests/workers/tool-dispatcher.test.ts
 *
 * Unit tests for ToolDispatcher — no database required.
 *
 * Coverage targets:
 *   TC-D1  dispatch: calls the registered handler with correct arguments
 *   TC-D2  dispatch: passes pool to the handler
 *   TC-D3  dispatch: throws for an unregistered tool name
 *   TC-D4  dispatch: re-throws handler errors to the caller
 *   TC-D5  has: returns true for a registered tool, false for unknown
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { ToolDispatcher, type ToolHandler } from '../../src/workers/tool-dispatcher.js'
import type { RegisteredToolName } from '../../src/utilities/tool-registry.js'

// Minimal Pool stub — ToolDispatcher holds a reference but handlers under
// test below don't actually use it. A real pool is not needed here.
const mockPool = {} as unknown as Pool

describe('ToolDispatcher', () => {
  let handler: ReturnType<typeof vi.fn>
  let dispatcher: ToolDispatcher

  beforeEach(() => {
    handler = vi.fn().mockResolvedValue(undefined)

    const handlers = new Map<RegisteredToolName, ToolHandler>([
      ['store_memory', handler as ToolHandler],
    ])

    dispatcher = new ToolDispatcher(mockPool, handlers)
  })

  // TC-D1 — dispatch calls the handler with the correct tool name and payload
  it('TC-D1: dispatches to the registered handler with tool name and payload', async () => {
    const payload = { content: 'hello' }

    await dispatcher.dispatch('store_memory', payload)

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith('store_memory', payload, mockPool)
  })

  // TC-D2 — null payload is forwarded unchanged
  it('TC-D2: passes null payload unchanged to the handler', async () => {
    await dispatcher.dispatch('store_memory', null)

    expect(handler).toHaveBeenCalledWith('store_memory', null, mockPool)
  })

  // TC-D3 — unregistered tool name throws immediately
  it('TC-D3: throws for an unregistered tool name', async () => {
    await expect(dispatcher.dispatch('query_crons', null)).rejects.toThrow(
      'No handler registered for tool: query_crons',
    )
  })

  // TC-D4 — handler errors are re-thrown to the caller (CronWorker catches them)
  it('TC-D4: re-throws handler errors to the caller', async () => {
    const boom = new Error('handler exploded')
    handler.mockRejectedValueOnce(boom)

    await expect(dispatcher.dispatch('store_memory', null)).rejects.toThrow('handler exploded')
  })

  // TC-D5 — has() reflects registration state
  it('TC-D5: has() returns true for registered tools and false for unknown ones', () => {
    expect(dispatcher.has('store_memory')).toBe(true)
    expect(dispatcher.has('query_crons')).toBe(false)
    expect(dispatcher.has('unknown_tool_xyz')).toBe(false)
  })
})
