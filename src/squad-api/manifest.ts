import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Squad manifest singleton (ARCH-019 SEC-C5)
//
// squad.manifest.json is loaded once at module initialization and cached in
// memory. It is never re-read per request — a server restart picks up changes.
//
// File path is resolved from this module's location so the same resolution
// works in both source mode (tsx) and compiled mode (dist/):
//   src/squad-api/manifest.ts  →  ../../squad.manifest.json = project root ✓
//   dist/squad-api/manifest.js →  ../../squad.manifest.json = project root ✓
//
// A missing or malformed manifest.json is non-fatal: the cache is left empty
// and all agents return `manifest: null`. A warning is logged at startup.
// ---------------------------------------------------------------------------

interface ManifestAgent {
  slug: string
  name: string
  role: string
  skills: string[]
  owns: string[]
  works_with: string[]
}

interface ManifestFile {
  version: string
  squad: string
  agents: ManifestAgent[]
}

// Keyed by agent slug for O(1) lookups.
const manifestCache = new Map<string, ManifestAgent>()

try {
  const manifestPath = fileURLToPath(
    new URL('../../squad.manifest.json', import.meta.url),
  )
  const raw = readFileSync(manifestPath, 'utf-8')
  const manifest = JSON.parse(raw) as ManifestFile
  for (const agent of manifest.agents) {
    manifestCache.set(agent.slug, agent)
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  console.warn('[squad-api/manifest] Could not load squad.manifest.json:', message)
}

/**
 * Returns the manifest entry for a given slug, or null if the slug is not
 * present in squad.manifest.json (or if the manifest failed to load).
 */
export function getManifestAgent(slug: string): ManifestAgent | null {
  return manifestCache.get(slug) ?? null
}
