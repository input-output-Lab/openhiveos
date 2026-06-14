/**
 * src/integrations/adapter.ts
 *
 * ARCH-024 — Provider-agnostic IntegrationAdapter interface.
 *
 * Each external task provider (ClickUp, JIRA, etc.) implements this interface.
 * The interface is provider-neutral — no ClickUp or JIRA-specific logic lives here.
 *
 * All ClickUp-specific behavior is encapsulated in src/integrations/clickup/.
 * All JIRA-specific behavior is encapsulated in src/integrations/jira/.
 *
 * This ensures that adding a new provider does not require changes to core
 * SyncWorker logic — only a new adapter implementation.
 */

/**
 * Row structure from sync_queue table.
 * Used by dispatch() to communicate what needs to be sent to the external provider.
 */
export interface SyncQueueRow {
  id: number
  task_id: number
  provider: string
  payload: Record<string, unknown>
  status: 'pending' | 'dispatched' | 'done' | 'failed'
  retry_count: number
  clickup_event_id?: string
  created_at: string
  updated_at: string
}

/**
 * Inbound webhook event from an external provider.
 * Shape varies by provider — handled by the adapter's handleWebhook() method.
 */
export type WebhookPayload = Record<string, unknown>

/**
 * Provider-agnostic integration adapter interface.
 *
 * ARCH-024 Decision: All external integrations follow this contract.
 * No provider-specific code in the core system.
 */
export interface IntegrationAdapter {
  /**
   * Provider identifier: 'clickup' | 'jira' | ...
   * Must be lowercase, no spaces.
   */
  provider: string

  /**
   * Whether this provider is enabled in the current environment.
   * Driven by {PROVIDER}_ENABLED env var.
   * When false, SyncWorker skips this adapter entirely.
   */
  enabled: boolean

  /**
   * Dispatch an outbound sync operation.
   * Called by SyncWorker when polling sync_queue.
   *
   * The adapter MUST:
   * - Call the external provider API with row.payload
   * - Return successfully if the operation completed (HTTP 2xx or idempotent)
   * - Throw if the operation failed (will trigger retry logic)
   * - Never log sensitive content (task data, API tokens, payloads)
   *
   * After successful dispatch, SyncWorker updates sync_queue.status to 'done'.
   * On exception, SyncWorker increments retry_count and reschedules.
   *
   * ARCH-024 Rationale: dispatch is async so that multiple providers can be
   * called in parallel (though currently we process sequentially).
   */
  dispatch(row: SyncQueueRow): Promise<void>

  /**
   * Handle an inbound webhook from the external provider.
   *
   * The adapter MUST:
   * - Parse the payload (shape is provider-specific)
   * - Validate HMAC signature if applicable (before any DB access)
   * - Return a structured result (task created, updated, etc.)
   * - Never log sensitive content (API keys, payloads)
   *
   * The adapter MAY throw if validation fails (caller handles 401 response).
   *
   * ARCH-024 — Inbound task landing:
   * New tasks from webhooks are created with status: 'triage' pending agent promotion.
   * This preserves the human-in-the-loop review step and prevents noise injection.
   *
   * ARCH-024 — Echo loop guard:
   * If the inbound event was triggered by the bot account itself (CLICKUP_BOT_USER_ID),
   * the adapter must drop the event and return success (deduplication via clickup_event_id).
   */
  handleWebhook(payload: WebhookPayload): Promise<void>
}
