/**
 * src/integrations/index.ts
 *
 * Barrel export for the integrations module.
 * Exposes the public API: adapter types and registry utilities.
 *
 * Consumers should import from 'src/integrations' not from sub-modules.
 * This keeps internal structure flexible — we can refactor without breaking imports.
 */

export type { IntegrationAdapter, SyncQueueRow, WebhookPayload } from './adapter.js'
export { validateIntegrationRegistry, getEnabledAdapters, getAdapter, getAllAdapters } from './registry.js'
