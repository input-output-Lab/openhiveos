import { z } from 'zod'
import { queryThoughts } from '../db/queries/thoughts.js'
import { isValidAgentSlug } from '../squad/manifest.js'

export const queryThoughtsSchema = z.object({
  agent_slug: z
    .string()
    .refine(isValidAgentSlug, { message: 'Unknown agent slug' })
    .optional(),
  session_id: z.string().optional(),
  thought_type: z
    .enum(['analysis', 'concern', 'decision', 'hypothesis', 'realization', 'pushback'])
    .optional(),
  must_surface: z.boolean().optional(),
  auto_persist_candidate: z.boolean().optional(),
  pending_ratification: z.boolean().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().positive().max(100).default(50),
})

export type QueryThoughtsInput = z.infer<typeof queryThoughtsSchema>

// Read operation — no agentSlug param; any authenticated agent may query
export async function handleQueryThoughts(input: QueryThoughtsInput) {
  const parsed = queryThoughtsSchema.parse(input)
  return await queryThoughts({
    ...(parsed.agent_slug !== undefined ? { agent_slug: parsed.agent_slug } : {}),
    ...(parsed.session_id !== undefined ? { session_id: parsed.session_id } : {}),
    ...(parsed.thought_type !== undefined ? { thought_type: parsed.thought_type } : {}),
    ...(parsed.must_surface !== undefined ? { must_surface: parsed.must_surface } : {}),
    ...(parsed.auto_persist_candidate !== undefined
      ? { auto_persist_candidate: parsed.auto_persist_candidate }
      : {}),
    ...(parsed.pending_ratification !== undefined
      ? { pending_ratification: parsed.pending_ratification }
      : {}),
    ...(parsed.from !== undefined ? { from: parsed.from } : {}),
    ...(parsed.to !== undefined ? { to: parsed.to } : {}),
    limit: parsed.limit,
  })
}
