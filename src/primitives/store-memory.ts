import { z } from 'zod'
import { storeMemory } from '../db/queries/memory.js'
import { embedContent } from '../embeddings/gemini.js'

export const storeMemorySchema = z.object({
  content: z.string().min(1),
  task_id: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export type StoreMemoryInput = z.infer<typeof storeMemorySchema>

// agentSlug is resolved server-side from the bearer token — not in the input schema
export async function handleStoreMemory(input: StoreMemoryInput, agentSlug: string) {
  const parsed = storeMemorySchema.parse(input)
  const embedding = await embedContent(parsed.content)
  return await storeMemory({
    agent_slug: agentSlug,
    content: parsed.content,
    embedding,
    ...(parsed.task_id !== undefined ? { task_id: parsed.task_id } : {}),
    ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
  })
}
