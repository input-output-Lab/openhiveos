import { z } from 'zod'
import { getProjectBoard } from '../db/queries/projects.js'

export const getProjectBoardSchema = z.object({
  slug: z.string().min(1),
})

export type GetProjectBoardInput = z.infer<typeof getProjectBoardSchema>

// SEC-24: owner_agent_slug is server-injected — callers cannot view boards for
// projects they do not own, even if they know the slug.
export async function handleGetProjectBoard(input: GetProjectBoardInput, agentSlug: string) {
  const parsed = getProjectBoardSchema.parse(input)
  const result = await getProjectBoard({
    slug: parsed.slug,
    owner_agent_slug: agentSlug,
  })
  if (!result) {
    return {
      error: 'not_found_or_unauthorized',
      message: 'Project not found or you do not own it.',
    }
  }
  return result
}
