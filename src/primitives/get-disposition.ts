import { z } from 'zod'
import { getDisposition } from '../db/queries/thoughts.js'
import { isValidAgentSlug } from '../squad/manifest.js'

export const getDispositionSchema = z.object({
  agent_slug: z.string().refine(isValidAgentSlug, { message: 'Unknown agent slug' }),
})

export type GetDispositionInput = z.infer<typeof getDispositionSchema>

// Read operation — any authenticated agent may query any disposition
export async function handleGetDisposition(input: GetDispositionInput) {
  const parsed = getDispositionSchema.parse(input)
  const profile = await getDisposition(parsed.agent_slug)
  if (!profile) {
    throw new Error(`No disposition profile found for agent: ${parsed.agent_slug}`)
  }
  return profile
}
