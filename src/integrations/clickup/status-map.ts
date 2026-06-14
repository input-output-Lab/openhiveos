/**
 * src/integrations/clickup/status-map.ts
 *
 * ARCH-024 — Bidirectional status mapping between OpenHiveOS and ClickUp.
 *
 * Maps task statuses from OpenHiveOS state machine to ClickUp custom field values.
 * Also provides reverse mapping for inbound webhooks (Task #1764).
 *
 * OpenHiveOS statuses: 'todo', 'wip', 'review', 'done', 'rework'
 * ClickUp statuses (custom field): 'open', 'in_progress', 'in_review', 'closed'
 *
 * Design rationale:
 * - ClickUp's native status system is task-template-specific
 * - We use a custom field instead (provider-agnostic, portable across task types)
 * - Unknown states map to 'open' for safety (revert to safe default)
 */

/**
 * ClickUp custom field value for a given OpenHiveOS status.
 *
 * Used by syncToClickUp() to map the task's current status to the custom field value
 * that should be written to ClickUp.
 */
export function mapOpenHiveOSStatusToClickUp(status: string): string {
  switch (status) {
    case 'todo':
      return 'open'
    case 'wip':
      return 'in_progress'
    case 'review':
      return 'in_review'
    case 'done':
      return 'closed'
    case 'rework':
      return 'open' // reopen the task
    default:
      // Safe default: unknown states revert to 'open'
      // This prevents accidentally closing tasks for states we don't recognize
      return 'open'
  }
}

/**
 * OpenHiveOS status for a given ClickUp custom field value.
 *
 * Used by handleWebhook() (Task #1764) to map inbound events back to OpenHiveOS status.
 * Returns 'todo' as safe default for unknown ClickUp statuses.
 */
export function mapClickUpStatusToOpenHiveOS(clickupStatus: string): string {
  switch (clickupStatus) {
    case 'open':
      return 'todo'
    case 'in_progress':
      return 'wip'
    case 'in_review':
      return 'review'
    case 'closed':
      return 'done'
    default:
      // Safe default: unknown statuses become 'todo'
      return 'todo'
  }
}
