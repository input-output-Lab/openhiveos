import { z } from 'zod'
import { searchSops } from '../db/queries/sops.js'
import { embedContent } from '../embeddings/gemini.js'

export const searchSopsSchema = z.object({
  query: z.string().min(1),
  category: z
    .enum(['Coding', 'DevOps', 'QA', 'Architecture', 'Documentation', 'Decision'])
    .optional(),
  limit: z.number().int().positive().max(10).default(3),
})

export type SearchSopsInput = z.infer<typeof searchSopsSchema>

export async function handleSearchSops(input: SearchSopsInput) {
  const parsed = searchSopsSchema.parse(input)
  const embedding = await embedContent(parsed.query)
  return await searchSops({
    embedding,
    ...(parsed.category !== undefined ? { category: parsed.category } : {}),
    limit: parsed.limit,
  })
}
