import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const AgentSchema = z.object({
  /** Kebab-case identifier used in all tool calls (e.g. "murphy", "silas"). */
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, 'Agent slug must be lowercase kebab-case'),
  /** Human-readable display name. */
  name: z.string().min(1),
  /** One-line role description. */
  role: z.string().min(1),
  /**
   * Manifest 1.2.0 (#2556): agent-specific approver rule. Empty = default rule
   * (elizabeth approves done; nova approves tasks assigned to elizabeth).
   * Present for agents whose approval chain deviates from the default.
   */
  approvers: z.array(z.string().min(1)).optional(),
  /**
   * Manifest 1.2.0 (#2556): MCP tools the agent may call. Informational
   * surface declaration (capability listing), not an enforcement gate —
   * enforcement remains token-based via the agents table. Empty array =
   * agent has no direct task surface (e.g. zero).
   */
  tools: z.array(z.string().min(1)).optional(),
})

export const SquadManifestSchema = z.object({
  /** Semver. Increment when the manifest format itself changes. */
  version: z.string().min(1),
  /** Identifier for the squad that owns this server instance. */
  squad: z.string().min(1),
  /** All agents authorised to interact with this server. */
  agents: z.array(AgentSchema).min(1),
})

export type SquadManifest = z.infer<typeof SquadManifestSchema>
export type Agent = z.infer<typeof AgentSchema>

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

function loadManifest(): SquadManifest {
  // Resolve path relative to this module's location so it works correctly
  // in both dev (tsx, source at src/squad/) and production (dist/squad/).
  // Both are two levels below the project root where squad.manifest.json lives.
  const moduleDir = fileURLToPath(new URL('.', import.meta.url))
  const manifestPath = join(moduleDir, '..', '..', 'squad.manifest.json')

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as unknown
  } catch (err) {
    throw new Error(
      `[squad] Cannot read squad.manifest.json at ${manifestPath}: ${String(err)}`,
    )
  }

  const result = SquadManifestSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(
      `[squad] squad.manifest.json failed schema validation:\n${result.error.message}`,
    )
  }

  return result.data
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * The parsed squad manifest. Loaded once at module init — the server fails
 * fast on startup if the manifest is missing or malformed.
 */
export const manifest: SquadManifest = loadManifest()

/** O(1) lookup set of all registered agent slugs. */
const AGENT_SLUGS: ReadonlySet<string> = new Set(manifest.agents.map((a) => a.slug))

/**
 * Returns true if `slug` is registered in squad.manifest.json.
 *
 * Use in Zod schemas: `z.string().refine(isValidAgentSlug, { message: 'Unknown agent slug' })`
 */
export function isValidAgentSlug(slug: string): boolean {
  return AGENT_SLUGS.has(slug)
}

/**
 * Returns the Agent entry for `slug`, or throws if not found.
 * Use when you need the display name or role alongside validation.
 */
export function resolveAgent(slug: string): Agent {
  const agent = manifest.agents.find((a) => a.slug === slug)
  if (!agent) {
    throw new Error(
      `[squad] Unknown agent slug "${slug}". Valid slugs: ${[...AGENT_SLUGS].join(', ')}`,
    )
  }
  return agent
}
