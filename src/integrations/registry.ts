/**
 * src/integrations/registry.ts
 *
 * ARCH-024 — Provider-agnostic integration registry.
 *
 * Bootstraps all available providers and exposes getEnabledAdapters() as the
 * single entry point for querying which providers are active.
 *
 * Design principles (ARCH-024):
 * - Providers are opt-in via {PROVIDER}_ENABLED env var.
 * - A provider with enabled=false is silently skipped (no errors, no logs).
 * - The system operates normally with zero providers enabled.
 * - Adding a new provider requires no changes to SyncWorker or webhook routing.
 */

import { z } from 'zod'
import type { IntegrationAdapter } from './adapter.js'
import { clickupAdapter, validateClickUpConfig } from './clickup/index.js'
import { jiraAdapter, validateJiraConfig } from './jira/index.js'

/**
 * All available adapters (order matters for iteration).
 * Added: ClickUp (enabled in this sprint), JIRA (stub for future sprint).
 */
const allAdapters: IntegrationAdapter[] = [clickupAdapter, jiraAdapter]

/**
 * Integration registry configuration.
 * Validated once at boot — fail fast if any required config is missing.
 */
const IntegrationRegistryConfigSchema = z.object({
  // ClickUp provider config
  clickup: z.any().optional(), // validated separately, just gates the parsing
  // JIRA provider config
  jira: z.any().optional(), // validated separately, just gates the parsing
})

/**
 * Validate all provider configurations at registry boot.
 *
 * Called once during application startup by src/index.ts (or wherever the
 * integration system is initialized). If validation fails, the process exits
 * with a clear error message — fail fast, don't continue with a partially
 * configured system.
 *
 * Each provider's validateFoo() function is responsible for:
 * - Parsing its env vars with Zod
 * - Throwing if enabled but required vars are missing
 * - Returning safely if disabled
 */
export function validateIntegrationRegistry(): void {
  // Validate ClickUp config (will throw if ENABLED=true but missing required vars)
  validateClickUpConfig()

  // Validate JIRA config (will throw if ENABLED=true but missing required vars)
  validateJiraConfig()

  // Schema parse (currently a no-op since we validate per-provider above).
  // Kept here for consistency and to support future registry-level rules.
  IntegrationRegistryConfigSchema.parse({})
}

/**
 * Get all enabled integration adapters.
 *
 * Called by:
 * - SyncWorker (main loop) — iterates to find providers that need polling
 * - Webhook router (one per provider) — checks if provider is enabled before mounting
 * - Dashboard integrations panel — shows registry status
 *
 * Returns only adapters where enabled === true.
 * Empty array if no providers are enabled (system operates normally).
 *
 * ARCH-024 Rationale: Provider registry is provider-neutral.
 * No provider-specific code lives in core SyncWorker or webhook logic.
 * Adding a new provider is a matter of: (1) create new adapter file,
 * (2) add it to allAdapters here, (3) mount webhook route if needed.
 * Core orchestration logic is unchanged.
 */
export function getEnabledAdapters(): IntegrationAdapter[] {
  return allAdapters.filter((adapter) => adapter.enabled)
}

/**
 * Get a specific adapter by provider name.
 * Used by webhook routes to dispatch inbound events to the correct provider.
 *
 * Returns the adapter if it exists (regardless of enabled state).
 * Webhook route is responsible for checking adapter.enabled before calling handleWebhook().
 *
 * Returns undefined if provider name is not registered.
 */
export function getAdapter(provider: string): IntegrationAdapter | undefined {
  return allAdapters.find((adapter) => adapter.provider === provider)
}

/**
 * Get all registered providers (enabled and disabled).
 * Used by the dashboard integrations panel to display the full registry status.
 */
export function getAllAdapters(): IntegrationAdapter[] {
  return allAdapters
}
