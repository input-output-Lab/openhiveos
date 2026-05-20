import { pool } from '../client.js'
import type { Sop } from '../../types.js'

export async function searchSops(params: {
  embedding: number[]
  category?: string
  limit: number
}): Promise<Sop[]> {
  const conditions: string[] = []
  const values: unknown[] = [JSON.stringify(params.embedding), params.limit]
  let idx = 3

  if (params.category !== undefined) {
    conditions.push(`category = $${String(idx)}`)
    idx++
    values.push(params.category)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const result = await pool.query<Sop & { similarity: number }>(
    `SELECT id, category, agent, instruction, source_path, created_at, updated_at,
            1 - (embedding <=> $1::vector) AS similarity
     FROM sops
     ${where}
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    values,
  )
  return result.rows
}
