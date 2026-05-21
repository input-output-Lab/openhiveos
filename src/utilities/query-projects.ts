import { z } from 'zod'
import { queryProjects } from '../db/queries/projects.js'

// SEC-ACCEPTED-F2 (Locksmith, 2026-05-20): queryProjects permits cross-agent
// project enumeration. Any authenticated agent may pass owner_agent_slug to
// read another agent's project list. This is intentional for squad coordination
// (e.g. Elizabeth reading all project statuses). Contrast with queryTasks which
// implicitly scopes to the calling agent's projects. If project metadata becomes
// sensitive, add agentSlug scoping here matching the queryTasks pattern.
// Risk accepted: Low. Callers are authenticated agents within the same Squad instance.

export const queryProjectsSchema = z.object({
  status: z.enum(['active', 'archived']).optional(),
  owner_agent_slug: z.string().optional(),
})

export type QueryProjectsInput = z.infer<typeof queryProjectsSchema>

export async function handleQueryProjects(input: QueryProjectsInput) {
  const parsed = queryProjectsSchema.parse(input)
  return await queryProjects({
    ...(parsed.status !== undefined ? { status: parsed.status } : {}),
    ...(parsed.owner_agent_slug !== undefined ? { owner_agent_slug: parsed.owner_agent_slug } : {}),
  })
}
