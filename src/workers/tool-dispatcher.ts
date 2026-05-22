/**
 * src/workers/tool-dispatcher.ts
 *
 * Cron tool dispatcher — ARCH-011 G2.
 *
 * Holds a typed handler map (RegisteredToolName → ToolHandler) and dispatches
 * cron executions to the correct handler.
 *
 * Design constraints:
 *   - Pool is injected at construction — the worker is testable in isolation.
 *   - Handlers are injected at construction — test doubles can replace them.
 *   - Unknown tool_name throws immediately (fail loud — no silent swallow).
 *   - tool_name is validated at cron creation (SEC-26, REGISTERED_TOOL_NAMES).
 *     The guard here is a defence-in-depth check against stale registrations.
 */
import type { Pool } from 'pg'
import type { RegisteredToolName } from '../utilities/tool-registry.js'

/**
 * A handler for a registered tool.
 *
 * Receives the tool name (for logging), the cron's stored payload (may be null
 * for zero-argument tools), and the injected pool for any DB operations the
 * handler needs to perform.
 */
export type ToolHandler = (
  toolName: RegisteredToolName,
  payload: Record<string, unknown> | null,
  pool: Pool,
) => Promise<void>

export class ToolDispatcher {
  private readonly handlers: Map<RegisteredToolName, ToolHandler>
  private readonly pool: Pool

  constructor(pool: Pool, handlers: Map<RegisteredToolName, ToolHandler>) {
    this.pool = pool
    this.handlers = handlers
  }

  /**
   * Dispatch a cron execution to the registered handler.
   *
   * Throws if no handler is registered for the given tool name.
   * Callers (CronWorker) must catch and log — dispatch failures do not
   * un-fire the cron or affect next_fire_at.
   */
  async dispatch(toolName: string, payload: Record<string, unknown> | null): Promise<void> {
    const handler = this.handlers.get(toolName as RegisteredToolName)
    if (handler === undefined) {
      throw new Error(`[dispatcher] No handler registered for tool: ${toolName}`)
    }
    await handler(toolName as RegisteredToolName, payload, this.pool)
  }

  /** Returns true if a handler is registered for the given tool name. */
  has(toolName: string): boolean {
    return this.handlers.has(toolName as RegisteredToolName)
  }
}
