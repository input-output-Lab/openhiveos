import { pool } from '../db/client.js'
import { Task } from '../types.js'

/**
 * Promote a triage task to todo status.
 *
 * ARCH-024: Triage is an inbound-only status created by the ClickUp webhook
 * processor. The only valid transition OUT of triage is via promotion to todo.
 *
 * The promote action is a pure status UPDATE with a WHERE guard on the current
 * status. This ensures:
 *   - 404 if task does not exist
 *   - 409 if task is not in triage status (already promoted)
 *   - 200 on success (returns the promoted task object)
 *
 * Audit trail: logs the promoting agent's slug and task ID to stdout.
 * No new schema required — fully reversible at the data level.
 *
 * @param taskId — the task ID to promote
 * @param agentSlug — the agent slug of the caller (for audit logging)
 * @param targetStatus — target status after promotion (default: 'todo')
 * @returns the promoted task object on success, or an error object
 */
export async function promoteTriageTask(params: {
  taskId: number
  agentSlug: string
  targetStatus?: 'todo' // only valid target for now
}): Promise<Task | { error: string; message: string }> {
  const { taskId, agentSlug, targetStatus = 'todo' } = params

  try {
    // Validate target status is allowed
    if (!['todo'].includes(targetStatus)) {
      return {
        error: 'invalid_target_status',
        message: `Target status '${targetStatus}' is not valid. Only 'todo' is allowed from 'triage'.`,
      }
    }

    // UPDATE tasks SET status='todo' WHERE id=$1 AND status='triage' RETURNING *
    const result = await pool.query<Task>(
      `UPDATE tasks
       SET status = $2, updated_at = NOW()
       WHERE id = $1 AND status = 'triage'
       RETURNING id, project_id, title, description, status, assignee_agent_slug,
                 github_pr_url, notes, created_at, updated_at`,
      [taskId, targetStatus],
    )

    // No rows returned — task either doesn't exist or is not in triage status
    if (result.rows.length === 0) {
      // Disambiguate: check if task exists at all
      const checkResult = await pool.query<{ status: string }>(
        `SELECT status FROM tasks WHERE id = $1`,
        [taskId],
      )

      if (checkResult.rows.length === 0 || !checkResult.rows[0]) {
        return {
          error: 'not_found',
          message: `Task #${String(taskId)} not found.`,
        }
      }

      const currentStatus = checkResult.rows[0].status
      return {
        error: 'invalid_state_transition',
        message: `Task #${String(taskId)} is in status '${currentStatus}', not 'triage'. Cannot promote.`,
      }
    }

    // Audit logging: structured output for observability
    console.log('[integrations/promote] promoted by:', agentSlug, 'task:', taskId, '→', targetStatus)

    const promotedTask = result.rows[0]
    if (!promotedTask) {
      return {
        error: 'internal_error',
        message: 'Failed to retrieve promoted task.',
      }
    }

    return promotedTask
  } catch (err) {
    console.error('[integrations/promote] error:', err)
    return {
      error: 'internal_error',
      message: 'An error occurred while promoting the task.',
    }
  }
}
