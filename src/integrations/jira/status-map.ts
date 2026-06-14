/**
 * src/integrations/jira/status-map.ts
 *
 * ARCH-024 — Bidirectional status mapping between OpenHiveOS and JIRA (Sprint N+2 stub).
 *
 * Maps task statuses from OpenHiveOS state machine to JIRA custom field values.
 * Also provides reverse mapping for inbound webhooks.
 *
 * OpenHiveOS statuses: 'todo', 'wip', 'review', 'done', 'rework'
 * JIRA statuses (planned mapping, not implemented):
 *   OpenHiveOS → JIRA: todo→Open, wip→In Progress, review→In Review, done→Done, rework→Reopened
 *   JIRA → OpenHiveOS: reverse mapping
 *
 * Design rationale (planned):
 * - JIRA's native status system is workflow-specific
 * - We use a custom field instead (provider-agnostic, portable across issue types)
 * - Unknown states map to 'Open' for safety (revert to safe default)
 * - All values are strings, not enums (future-proof for field API changes)
 *
 * STUB: All mappings are defined but serve as documentation.
 * Actual implementation deferred to Sprint N+2.
 */

/**
 * JIRA status for a given OpenHiveOS status.
 *
 * Used by syncToJira() to map the task's current status to the status value
 * that should be written to JIRA.
 *
 * STUB mapping (defined for reference, not actively used):
 * - todo → "Open"
 * - wip → "In Progress"
 * - review → "In Review"
 * - done → "Done"
 * - rework → "Reopened"
 */
export function mapOpenHiveOSStatusToJira(status: string): string {
  switch (status) {
    case 'todo':
      return 'Open'
    case 'wip':
      return 'In Progress'
    case 'review':
      return 'In Review'
    case 'done':
      return 'Done'
    case 'rework':
      return 'Reopened'
    default:
      // Safe default: unknown states revert to 'Open'
      // This prevents accidentally closing issues for states we don't recognize
      return 'Open'
  }
}

/**
 * OpenHiveOS status for a given JIRA status.
 *
 * Used by handleWebhook() (Task #TBD, Sprint N+2) to map inbound events back to OpenHiveOS status.
 * Returns 'todo' as safe default for unknown JIRA statuses.
 *
 * STUB mapping (defined for reference, not actively used):
 * - "Open" → "todo"
 * - "In Progress" → "wip"
 * - "In Review" → "review"
 * - "Done" → "done"
 * - "Reopened" → "rework"
 */
export function mapJiraStatusToOpenHiveOS(jiraStatus: string): string {
  switch (jiraStatus) {
    case 'Open':
      return 'todo'
    case 'In Progress':
      return 'wip'
    case 'In Review':
      return 'review'
    case 'Done':
      return 'done'
    case 'Reopened':
      return 'rework'
    default:
      // Safe default: unknown states revert to 'todo'
      return 'todo'
  }
}
