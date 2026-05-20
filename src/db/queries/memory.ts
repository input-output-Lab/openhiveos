import { pool } from '../client.js'
import type { Memory } from '../../types.js'

export async function storeMemory(params: {
  agent_slug: string
  content: string
  embedding: number[]
  task_id?: number
  metadata?: Record<string, unknown>
}): Promise<{ id: number }> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO memories (agent_slug, content, embedding, task_id, metadata)
     VALUES ($1, $2, $3::vector, $4, $5)
     RETURNING id`,
    [
      params.agent_slug,
      params.content,
      JSON.stringify(params.embedding),
      params.task_id ?? null,
      JSON.stringify(params.metadata ?? {}),
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error('[db] INSERT INTO memories returned no row')
  return row
}

export async function searchMemory(params: {
  embedding: number[]
  limit: number
  metadata_filter?: Record<string, string>
}): Promise<Memory[]> {
  const conditions: string[] = []
  const values: unknown[] = [JSON.stringify(params.embedding), params.limit]
  let idx = 3

  if (params.metadata_filter) {
    for (const [key, value] of Object.entries(params.metadata_filter)) {
      conditions.push(`metadata @> $${String(idx)}::jsonb`)
      idx++
      values.push(JSON.stringify({ [key]: value }))
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const result = await pool.query<Memory & { similarity: number }>(
    `SELECT id, agent_slug, task_id, content, metadata, created_at,
            1 - (embedding <=> $1::vector) AS similarity
     FROM memories
     ${where}
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    values,
  )
  return result.rows
}
