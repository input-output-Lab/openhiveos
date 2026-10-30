// ---------------------------------------------------------------------------
// Model alias normalization — S17-DB-01 (#2553)
//
// Canonical form: raw vendor slug, e.g. 'z-ai/glm-5.3-flashx',
// 'anthropic/claude-opus-5.5'. The DB registry (llm_models + llm_model_aliases,
// migration 022) is the source of truth for alias → canonical resolution at
// query time; this module provides the same mapping for emitters (collector,
// MCP tooling) BEFORE a row reaches the DB, so new rows land pre-normalized.
//
// Known lossy form (Silas warning 3, design ruling #1095):
// 'openrouter/OpenRouter/<vendor>/<model>' — the collector's normalizeModelId
// strips to '<vendor>/<model>'. Alias seeds in migration 022 map BOTH the
// OpenRouter forms and the raw form to the same canonical row, so per-model
// cost rollups never silently split.
// ---------------------------------------------------------------------------

const PROVIDER_PREFIXES: { pattern: RegExp; provider: string }[] = [
  { pattern: /^openrouter\/OpenRouter\//, provider: 'openrouter' },
  { pattern: /^openrouter\//, provider: 'openrouter' },
  { pattern: /^copilot\//, provider: 'github-copilot' },
  { pattern: /^copilotcli\//, provider: 'github-copilot-cli' },
]

export interface NormalizedModel {
  /** Observed surface provider (who served the request) */
  surfaceProvider: string | null
  /** Canonical vendor/model slug, e.g. 'z-ai/glm-5.3-flashx' */
  canonicalModel: string
}

export function normalizeModelId(modelId: string): NormalizedModel {
  for (const { pattern, provider } of PROVIDER_PREFIXES) {
    if (pattern.test(modelId)) {
      return { surfaceProvider: provider, canonicalModel: modelId.replace(pattern, '') }
    }
  }
  const slash = modelId.indexOf('/')
  if (slash > 0) {
    return { surfaceProvider: modelId.slice(0, slash), canonicalModel: modelId }
  }
  return { surfaceProvider: null, canonicalModel: modelId }
}
