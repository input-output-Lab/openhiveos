import { z } from 'zod'
import {
  insertThought,
  updateThoughtEmbedding,
  computeThoughtFlags,
} from '../db/queries/thoughts.js'
import { embedContent } from '../embeddings/gemini.js'

export const storeThoughtSchema = z.object({
  // agent_slug intentionally absent — identity is resolved server-side from bearer token
  session_id: z.string().optional(),
  task_id: z.number().int().positive().optional(),
  thought: z.string().min(1),
  thought_type: z
    .enum(['analysis', 'concern', 'decision', 'hypothesis', 'realization', 'pushback'])
    .default('analysis'),
  confidence: z.number().min(0).max(1).optional(),
  raw_behavior: z.string().optional(),
  expressed_behavior: z.string().optional(),
  disposition_snapshot: z.record(z.string(), z.unknown()).optional(),
  counter_thought: z
    .object({
      primary_thought_summary: z.string(),
      challenge: z.string(),
      basis: z.string(),
      must_surface: z.boolean(),
      intensity: z.enum(['signal', 'caution', 'block']),
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type StoreThoughtInput = z.infer<typeof storeThoughtSchema>

export async function handleStoreThought(input: StoreThoughtInput, agentSlug: string) {
  const parsed = storeThoughtSchema.parse(input)

  const { must_surface, auto_persist_candidate } = computeThoughtFlags(
    parsed.thought_type,
    parsed.confidence,
  )

  // Insert row immediately — do not await embedding so agent is not blocked
  const { id } = await insertThought({
    agent_slug: agentSlug,
    ...(parsed.session_id !== undefined ? { session_id: parsed.session_id } : {}),
    ...(parsed.task_id !== undefined ? { task_id: parsed.task_id } : {}),
    thought: parsed.thought,
    thought_type: parsed.thought_type,
    ...(parsed.confidence !== undefined ? { confidence: parsed.confidence } : {}),
    ...(parsed.raw_behavior !== undefined ? { raw_behavior: parsed.raw_behavior } : {}),
    ...(parsed.expressed_behavior !== undefined
      ? { expressed_behavior: parsed.expressed_behavior }
      : {}),
    ...(parsed.disposition_snapshot !== undefined
      ? { disposition_snapshot: parsed.disposition_snapshot }
      : {}),
    must_surface,
    auto_persist_candidate,
    ...(parsed.counter_thought !== undefined
      ? { counter_thought: parsed.counter_thought }
      : {}),
    ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
  })

  // Embed asynchronously — agent receives the ID immediately
  embedContent(parsed.thought)
    .then((embedding) => updateThoughtEmbedding({ id, embedding }))
    .catch((err: unknown) => {
      console.warn(`[store-thought] Async embedding failed for thought ${String(id)}:`, err)
    })

  return { id, must_surface, auto_persist_candidate }
}
