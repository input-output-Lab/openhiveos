import { z } from 'zod'
import { updateProject } from '../db/queries/projects.js'

export const updateProjectSchema = z.object({
  project_id: z.number().int().positive(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['active', 'archived']).optional(),
})

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>

// SEC-21: owner_agent_slug is server-injected. The DB query returns undefined
// if the agent does not own the project — this handler surfaces that as a
// structured error rather than allowing it to surface as an uncaught exception.
export async function handleUpdateProject(input: UpdateProjectInput, agentSlug: string) {
  const parsed = updateProjectSchema.parse(input)
  const result = await updateProject({
    project_id: parsed.project_id,
    owner_agent_slug: agentSlug,
    ...(parsed.name !== undefined ? { name: parsed.name } : {}),
    ...(parsed.description !== undefined ? { description: parsed.description } : {}),
    ...(parsed.status !== undefined ? { status: parsed.status } : {}),
  })
  if (!result) {
    return {
      error: 'not_found_or_unauthorized',
      message: 'Project not found or you do not own it.',
    }
  }
  return result
}
