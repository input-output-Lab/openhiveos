import { pool } from '../client.js'
import { embedContent } from '../../embeddings/gemini.js'
import type { AgentThought, DispositionProfile, ThoughtType } from '../../types.js'

// ---------------------------------------------------------------------------
// Thought flag thresholds
// ---------------------------------------------------------------------------

// Tier 1 — must_surface: confidence > 0.75, triggering types
// Agent must express this thought; it cannot be suppressed by operator config.
const MUST_SURFACE_THRESHOLD = 0.75
const MUST_SURFACE_TYPES: ThoughtType[] = ['concern', 'pushback', 'realization']

// Tier 2 — auto_persist_candidate: confidence > 0.95, realization only
// Proposes the thought for peer ratification into memory.
// No agent self-ratifies. The Zero (block intensity) can suspend it.
const AUTO_PERSIST_THRESHOLD = 0.95

export function computeThoughtFlags(
  thought_type: ThoughtType,
  confidence: number | undefined,
): { must_surface: boolean; auto_persist_candidate: boolean } {
  if (confidence === undefined) {
    return { must_surface: false, auto_persist_candidate: false }
  }
  const must_surface =
    MUST_SURFACE_TYPES.includes(thought_type) && confidence > MUST_SURFACE_THRESHOLD
  const auto_persist_candidate =
    thought_type === 'realization' && confidence > AUTO_PERSIST_THRESHOLD
  return { must_surface, auto_persist_candidate }
}

// ---------------------------------------------------------------------------
// Thought writes
// ---------------------------------------------------------------------------

export async function insertThought(params: {
  agent_slug: string
  session_id?: string
  task_id?: number
  thought: string
  thought_type: ThoughtType
  confidence?: number
  raw_behavior?: string
  expressed_behavior?: string
  disposition_snapshot?: Record<string, unknown>
  must_surface: boolean
  auto_persist_candidate: boolean
  counter_thought?: Record<string, unknown>
  metadata?: Record<string, unknown>
}): Promise<{ id: number }> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO thoughts
       (agent_slug, session_id, task_id, thought, thought_type, confidence,
        raw_behavior, expressed_behavior, disposition_snapshot, must_surface,
        auto_persist_candidate, counter_thought, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      params.agent_slug,
      params.session_id ?? null,
      params.task_id ?? null,
      params.thought,
      params.thought_type,
      params.confidence ?? null,
      params.raw_behavior ?? null,
      params.expressed_behavior ?? null,
      params.disposition_snapshot ? JSON.stringify(params.disposition_snapshot) : null,
      params.must_surface,
      params.auto_persist_candidate,
      params.counter_thought ? JSON.stringify(params.counter_thought) : null,
      JSON.stringify(params.metadata ?? {}),
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error('[db] INSERT INTO thoughts returned no row')
  return row
}

export async function updateThoughtEmbedding(params: {
  id: number
  embedding: number[]
}): Promise<void> {
  await pool.query(`UPDATE thoughts SET embedding = $2::vector WHERE id = $1`, [
    params.id,
    JSON.stringify(params.embedding),
  ])
}

// ---------------------------------------------------------------------------
// Ratification
// ---------------------------------------------------------------------------

// Row shape returned by SELECT * FROM thoughts
type ThoughtRow = AgentThought & {
  counter_thought: Record<string, unknown> | null
}

export async function ratifyThought(params: {
  thought_id: number
  ratifying_agent: string
}): Promise<AgentThought & { memory_id: number }> {
  const candidateResult = await pool.query<ThoughtRow>(
    `SELECT * FROM thoughts WHERE id = $1`,
    [params.thought_id],
  )

  if ((candidateResult.rowCount ?? 0) === 0) {
    throw new Error(`Thought ${String(params.thought_id)} not found`)
  }

  const row = candidateResult.rows[0]
  if (!row) throw new Error(`Thought ${String(params.thought_id)} not found`)

  if (!row.auto_persist_candidate) {
    throw new Error(`Thought ${String(params.thought_id)} is not an auto_persist_candidate`)
  }
  if (row.auto_persisted) {
    throw new Error(`Thought ${String(params.thought_id)} has already been ratified`)
  }
  if (row.agent_slug === params.ratifying_agent) {
    throw new Error('Self-ratification is prohibited. An agent cannot ratify its own thought.')
  }

  // The Zero's veto: block-intensity counter_thought suspends ratification
  const ct = row.counter_thought
  if (ct && ct['intensity'] === 'block') {
    const challenge = typeof ct['challenge'] === 'string' ? ct['challenge'] : 'unspecified'
    throw new Error(
      `Ratification suspended: The Zero has flagged this thought with a block-intensity ` +
        `counter_thought. Challenge: ${challenge}`,
    )
  }

  // Write to memories (with embedding so the row is searchable)
  const memContent = `[Ratified Realization — ${row.agent_slug}] ${row.thought}`
  const embedding = await embedContent(memContent)
  const memResult = await pool.query<{ id: number }>(
    `INSERT INTO memories (agent_slug, content, embedding, metadata)
     VALUES ($1, $2, $3::vector, $4)
     RETURNING id`,
    [
      row.agent_slug,
      memContent,
      JSON.stringify(embedding),
      JSON.stringify({
        type: 'ratified_realization',
        agent: row.agent_slug,
        thought_id: params.thought_id,
        ratified_by: params.ratifying_agent,
        confidence: row.confidence,
      }),
    ],
  )
  const memRow = memResult.rows[0]
  if (!memRow) throw new Error('[db] INSERT INTO memories returned no row')
  const memory_id = memRow.id

  // Mark the thought row as ratified
  const updated = await pool.query<AgentThought>(
    `UPDATE thoughts
     SET auto_persisted = TRUE,
         ratified_by    = $2,
         ratified_at    = NOW()
     WHERE id = $1
     RETURNING *`,
    [params.thought_id, params.ratifying_agent],
  )
  const updatedRow = updated.rows[0]
  if (!updatedRow) throw new Error('[db] UPDATE thoughts returned no row')

  return { ...updatedRow, memory_id }
}

// ---------------------------------------------------------------------------
// Disposition
// ---------------------------------------------------------------------------

export async function getDisposition(agentSlug: string): Promise<DispositionProfile | null> {
  const result = await pool.query<DispositionProfile>(
    `SELECT * FROM dispositions WHERE agent_slug = $1`,
    [agentSlug],
  )
  return result.rows[0] ?? null
}

export async function setDisposition(params: {
  agent_slug: string
  assertiveness?: number
  energy?: number
  patience?: number
  formality?: number
  candor_floor?: number
  updated_by?: string
}): Promise<DispositionProfile> {
  const fields: string[] = []
  const values: unknown[] = [params.agent_slug]
  let idx = 2

  if (params.assertiveness !== undefined) {
    fields.push(`assertiveness = $${String(idx)}`)
    idx++
    values.push(params.assertiveness)
  }
  if (params.energy !== undefined) {
    fields.push(`energy = $${String(idx)}`)
    idx++
    values.push(params.energy)
  }
  if (params.patience !== undefined) {
    fields.push(`patience = $${String(idx)}`)
    idx++
    values.push(params.patience)
  }
  if (params.formality !== undefined) {
    fields.push(`formality = $${String(idx)}`)
    idx++
    values.push(params.formality)
  }
  if (params.candor_floor !== undefined) {
    fields.push(`candor_floor = $${String(idx)}`)
    idx++
    values.push(params.candor_floor)
  }
  if (params.updated_by !== undefined) {
    fields.push(`updated_by = $${String(idx)}`)
    idx++
    values.push(params.updated_by)
  }

  if (fields.length === 0) {
    throw new Error('set_disposition requires at least one field to update')
  }

  const result = await pool.query<DispositionProfile>(
    `UPDATE dispositions
     SET ${fields.join(', ')}
     WHERE agent_slug = $1
     RETURNING *`,
    values,
  )

  if ((result.rowCount ?? 0) === 0) {
    throw new Error(`No disposition profile found for agent: ${params.agent_slug}`)
  }
  const row = result.rows[0]
  if (!row) throw new Error('[db] UPDATE dispositions returned no row')
  return row
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export async function queryThoughts(params: {
  agent_slug?: string
  session_id?: string
  thought_type?: ThoughtType
  must_surface?: boolean
  auto_persist_candidate?: boolean
  pending_ratification?: boolean
  from?: string
  to?: string
  limit?: number
}): Promise<AgentThought[]> {
  const conditions: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (params.agent_slug !== undefined) {
    conditions.push(`agent_slug = $${String(idx)}`)
    idx++
    values.push(params.agent_slug)
  }
  if (params.session_id !== undefined) {
    conditions.push(`session_id = $${String(idx)}`)
    idx++
    values.push(params.session_id)
  }
  if (params.thought_type !== undefined) {
    conditions.push(`thought_type = $${String(idx)}`)
    idx++
    values.push(params.thought_type)
  }
  if (params.must_surface !== undefined) {
    conditions.push(`must_surface = $${String(idx)}`)
    idx++
    values.push(params.must_surface)
  }
  if (params.auto_persist_candidate !== undefined) {
    conditions.push(`auto_persist_candidate = $${String(idx)}`)
    idx++
    values.push(params.auto_persist_candidate)
  }
  // pending_ratification: candidates not yet ratified (the approval queue)
  if (params.pending_ratification === true) {
    conditions.push(
      `auto_persist_candidate = TRUE AND auto_persisted = FALSE AND ratified_by IS NULL`,
    )
  }
  if (params.from !== undefined) {
    conditions.push(`created_at >= $${String(idx)}`)
    idx++
    values.push(params.from)
  }
  if (params.to !== undefined) {
    conditions.push(`created_at <= $${String(idx)}`)
    idx++
    values.push(params.to)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = params.limit ?? 50
  values.push(limit)

  const result = await pool.query<AgentThought>(
    `SELECT id, agent_slug, session_id, task_id, thought, thought_type, confidence,
            raw_behavior, expressed_behavior, disposition_snapshot, must_surface,
            auto_persist_candidate, ratified_by, ratified_at, auto_persisted,
            counter_thought, metadata, created_at
     FROM thoughts
     ${where}
     ORDER BY created_at DESC
     LIMIT $${String(idx)}`,
    values,
  )
  return result.rows
}
