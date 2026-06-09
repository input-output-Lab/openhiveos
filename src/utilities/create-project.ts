import { z } from 'zod'
import { createProject } from '../db/queries/projects.js'

// SEC-22: slug pattern mirrors the DB CHECK constraint — Zod guard runs before
// the query reaches PostgreSQL, giving the caller a structured validation error
// rather than a raw DB constraint violation.
export const createProjectSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'slug must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  business_value: z.number().int().optional(),
  strategic_fit: z.number().int().optional(),
  effort: z.number().int().optional(),
  risk_index: z.number().int().optional(),
})

export type CreateProjectInput = z.infer<typeof createProjectSchema>

// owner_agent_slug is resolved server-side from the bearer token — not in the input schema
export async function handleCreateProject(input: CreateProjectInput, agentSlug: string) {
  const parsed = createProjectSchema.parse(input)
  return await createProject({
    slug: parsed.slug,
    name: parsed.name,
    owner_agent_slug: agentSlug,
    ...(parsed.description !== undefined ? { description: parsed.description } : {}),
    ...(parsed.business_value !== undefined ? { business_value: parsed.business_value } : {}),
    ...(parsed.strategic_fit !== undefined ? { strategic_fit: parsed.strategic_fit } : {}),
    ...(parsed.effort !== undefined ? { effort: parsed.effort } : {}),
    ...(parsed.risk_index !== undefined ? { risk_index: parsed.risk_index } : {}),
  })
}
