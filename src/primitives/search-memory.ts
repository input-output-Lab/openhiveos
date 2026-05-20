import { z } from 'zod'
import { searchMemory } from '../db/queries/memory.js'
import { embedContent } from '../embeddings/gemini.js'
import { sanitizeQuery } from '../search/sanitizer.js'
import { hybridRank } from '../search/bm25.js'

export const searchMemorySchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(20).default(5),
  metadata_filter: z.record(z.string()).optional(),
})

export type SearchMemoryInput = z.infer<typeof searchMemorySchema>

export async function handleSearchMemory(input: SearchMemoryInput) {
  const parsed = searchMemorySchema.parse(input)

  // Step 1: Sanitize — strip system prompt contamination before embedding
  const sanitized = sanitizeQuery(parsed.query)

  // Step 2: Embed the clean query
  const embedding = await embedContent(sanitized.clean_query)

  // Step 3: Vector retrieval — fetch more candidates than requested for BM25 to rerank
  const fetchLimit = Math.min(parsed.limit * 3, 20)
  const candidates = await searchMemory({
    embedding,
    limit: fetchLimit,
    ...(parsed.metadata_filter !== undefined
      ? { metadata_filter: parsed.metadata_filter }
      : {}),
  })

  // Step 4: BM25 hybrid rerank, then trim to requested limit
  const reranked = hybridRank(candidates, sanitized.clean_query).slice(0, parsed.limit)

  // Surface sanitization metadata so agents know when their query was contaminated
  return {
    results: reranked,
    query_meta: {
      was_sanitized: sanitized.was_sanitized,
      method: sanitized.method,
      original_length: sanitized.original_length,
      clean_length: sanitized.clean_length,
    },
  }
}
