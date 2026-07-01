/**
 * src/workers/handlers/trigger-workflow.ts
 *
 * Cron handler for 'trigger_workflow'.
 *
 * Forwards the cron payload to the squad-runner HTTP server
 * (http://127.0.0.1:3010) via POST /run.
 *
 * Expected payload shape:
 *   { type: "triage" | "sprint", project_id?: number, issue_title?: string, issue_body?: string }
 *
 * Returns 202 on success, 409 if a workflow is already running.
 * A 409 is not an error — the CronWorker logs it and retries on the next tick.
 */
import type { Pool } from 'pg'
import type { RegisteredToolName } from '../../utilities/tool-registry.js'

const RUNNER_URL = 'http://127.0.0.1:3010/run'

export async function triggerWorkflowHandler(
  _toolName: RegisteredToolName,
  payload: Record<string, unknown> | null,
  _pool: Pool,
): Promise<void> {
  const body = JSON.stringify(payload ?? {})

  const res = await fetch(RUNNER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })

  if (res.status === 409) {
    // Workflow already running — not an error; cron will retry on next tick
    console.warn(`[trigger-workflow] runner busy (409) — will retry on next cron tick`)
    return
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[trigger-workflow] runner returned ${res.status}: ${text}`)
  }

  const data = await res.json().catch(() => ({}))
  console.log(`[trigger-workflow] dispatched — runner accepted:`, data)
}
