import { z } from 'zod'
import { querySprints } from '../db/queries/sprints.js'

// ---------------------------------------------------------------------------
// query_sprints — ARCH-011 Decision 2 (Richo, 2026-05-20): caller-scoped
//
// Returns sprint history only for projects owned by the calling agent.
// owner_agent_slug is injected server-side — never accepted from the caller.
//
// Allowed filters: project_id, sprint_number
// SEC-30 pattern: filter keys are validated against ALLOWED_SPRINT_FILTERS
// before any SQL is constructed. Unknown keys produce a Zod parse error.
// ---------------------------------------------------------------------------

export const querySprintsSchema = z.object({
  project_id:    z.number().int().positive().optional(),
  sprint_number: z.number().int().positive().optional(),
})

export type QuerySprintsInput = z.infer<typeof querySprintsSchema>

export async function handleQuerySprints(input: QuerySprintsInput, agentSlug: string) {
  const parsed = querySprintsSchema.parse(input)
  return await querySprints(
    {
      ...(parsed.project_id    !== undefined ? { project_id: parsed.project_id }       : {}),
      ...(parsed.sprint_number !== undefined ? { sprint_number: parsed.sprint_number } : {}),
    },
    agentSlug,
  )
}
