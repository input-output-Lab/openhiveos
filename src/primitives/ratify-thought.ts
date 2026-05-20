import { z } from 'zod'
import { ratifyThought } from '../db/queries/thoughts.js'

export const ratifyThoughtSchema = z.object({
  thought_id: z.number().int().positive(),
  // ratifying_agent intentionally absent — identity is resolved server-side from bearer token
})

export type RatifyThoughtInput = z.infer<typeof ratifyThoughtSchema>

export async function handleRatifyThought(input: RatifyThoughtInput, agentSlug: string) {
  const parsed = ratifyThoughtSchema.parse(input)
  return await ratifyThought({
    thought_id: parsed.thought_id,
    ratifying_agent: agentSlug,
  })
}
