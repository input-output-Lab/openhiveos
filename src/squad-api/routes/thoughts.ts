import { Router } from 'express'
import { withReaderRole } from '../db.js'

// ---------------------------------------------------------------------------
// /api/thoughts — thought roster (ARCH-019 Sprint 9, S9-BE-04)
//
// GET /api/thoughts[?agent_slug=&thought_type=&must_surface=&session_id=&limit=&offset=]
//   Returns paginated thought list. Sensitive introspection columns are excluded.
//
// Excluded from response (SEC-B1, SEC-B3):
//   - embedding         (vector column — never expose raw embeddings)
//   - raw_behavior      (SEC-B3 — internal agent behaviour log)
//   - expressed_behavior (SEC-B3 — internal agent behaviour log)
//   - disposition_snapshot (SEC-B3 — point-in-time disposition state)
//
// Filters:
//   agent_slug   — exact match against thoughts.agent_slug.
//   thought_type — must be a member of VALID_THOUGHT_TYPES (SEC-C3 named const).
//                  Unrecognised values → 400.
//   must_surface — boolean ('true' or 'false'). Only 'true' and 'false' are valid.
//   session_id   — exact match against thoughts.session_id.
//
// Pagination (ARCH-019 model):
//   limit    — integer [1, 100], default 25
//   offset   — integer >= 0, default 0
//   has_more — true when a (limit+1)th row exists (avoids COUNT(*))
//
// DB role: openhiveos_reader — SELECT-only via withReaderRole() (SEC-A5).
// ---------------------------------------------------------------------------

const router = Router()

// SEC-C3: VALID_THOUGHT_TYPES must be a named const — single audit point.
// Must stay in sync with the CHECK constraint on thoughts.thought_type in the migration.
const VALID_THOUGHT_TYPES = [
  'analysis',
  'concern',
  'decision',
  'hypothesis',
  'realization',
  'pushback',
] as const

type ValidThoughtType = typeof VALID_THOUGHT_TYPES[number]

interface ThoughtDbRow {
  id: string                    // SERIAL → string from pg
  agent_slug: string
  session_id: string | null
  task_id: string | null        // INT → string from pg
  thought: string
  thought_type: string
  confidence: number | null
  must_surface: boolean
  auto_persist_candidate: boolean
  ratified_by: string | null
  ratified_at: string | null
  auto_persisted: boolean
  counter_thought: unknown       // JSONB — null or structured object
  metadata: Record<string, unknown>
  created_at: string
}

interface ThoughtRow {
  id: number
  agent_slug: string
  session_id: string | null
  task_id: number | null
  thought: string
  thought_type: string
  confidence: number | null
  must_surface: boolean
  auto_persist_candidate: boolean
  ratified_by: string | null
  ratified_at: string | null
  auto_persisted: boolean
  counter_thought: unknown
  metadata: Record<string, unknown>
  created_at: string
}

// GET /api/thoughts
router.get('/', async (req, res) => {
  // ── Pagination ────────────────────────────────────────────────────────────
  const rawLimit  = parseInt(typeof req.query['limit']  === 'string' ? req.query['limit']  : '25', 10)
  const rawOffset = parseInt(typeof req.query['offset'] === 'string' ? req.query['offset'] : '0',  10)

  if (!Number.isInteger(rawLimit)  || rawLimit  < 1 || rawLimit  > 100) {
    res.status(400).json({ error: 'limit must be an integer between 1 and 100' })
    return
  }
  if (!Number.isInteger(rawOffset) || rawOffset < 0) {
    res.status(400).json({ error: 'offset must be a non-negative integer' })
    return
  }

  // ── Thought type filter (SEC-C3) ──────────────────────────────────────────
  const rawThoughtType = typeof req.query['thought_type'] === 'string' ? req.query['thought_type'] : undefined
  let thoughtType: ValidThoughtType | undefined

  if (rawThoughtType !== undefined) {
    const candidate = rawThoughtType
    if (!(VALID_THOUGHT_TYPES as readonly string[]).includes(candidate)) {
      res.status(400).json({
        error: `Invalid thought_type. Valid values: ${VALID_THOUGHT_TYPES.join(', ')}`,
      })
      return
    }
    thoughtType = candidate as ValidThoughtType
  }

  // ── must_surface filter ───────────────────────────────────────────────────
  const rawMustSurface = typeof req.query['must_surface'] === 'string' ? req.query['must_surface'] : undefined
  let mustSurface: boolean | undefined

  if (rawMustSurface !== undefined) {
    const candidate = rawMustSurface
    if (candidate !== 'true' && candidate !== 'false') {
      res.status(400).json({ error: 'must_surface must be "true" or "false"' })
      return
    }
    mustSurface = candidate === 'true'
  }

  // ── agent_slug filter ─────────────────────────────────────────────────────
  const agentSlug = typeof req.query['agent_slug'] === 'string' ? req.query['agent_slug'] : undefined

  // ── session_id filter ─────────────────────────────────────────────────────
  const sessionId = typeof req.query['session_id'] === 'string' ? req.query['session_id'] : undefined

  // ── Query ─────────────────────────────────────────────────────────────────
  try {
    const params: unknown[] = []
    const conditions: string[] = []

    if (agentSlug !== undefined) {
      params.push(agentSlug)
      conditions.push(`agent_slug = $${String(params.length)}`)
    }

    if (thoughtType !== undefined) {
      params.push(thoughtType)
      conditions.push(`thought_type = $${String(params.length)}`)
    }

    if (mustSurface !== undefined) {
      params.push(mustSurface)
      conditions.push(`must_surface = $${String(params.length)}`)
    }

    if (sessionId !== undefined) {
      params.push(sessionId)
      conditions.push(`session_id = $${String(params.length)}`)
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : ''

    params.push(rawLimit + 1)
    const limitParam = String(params.length)

    params.push(rawOffset)
    const offsetParam = String(params.length)

    // SEC-B1, SEC-B3: embedding, raw_behavior, expressed_behavior, and
    // disposition_snapshot are explicitly excluded from the SELECT list.
    const sql = `
      SELECT id,
             agent_slug,
             session_id,
             task_id,
             thought,
             thought_type,
             confidence,
             must_surface,
             auto_persist_candidate,
             ratified_by,
             ratified_at,
             auto_persisted,
             counter_thought,
             metadata,
             created_at
        FROM thoughts
      ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}
    `

    const thoughts = await withReaderRole(async (client) => {
      const result = await client.query<ThoughtDbRow>(sql, params)
      return result.rows
    })

    const hasMore = thoughts.length > rawLimit
    const rows = hasMore ? thoughts.slice(0, rawLimit) : thoughts

    const response: ThoughtRow[] = rows.map((row) => ({
      id: parseInt(row.id, 10),
      agent_slug: row.agent_slug,
      session_id: row.session_id,
      task_id: row.task_id !== null ? parseInt(row.task_id, 10) : null,
      thought: row.thought,
      thought_type: row.thought_type,
      confidence: row.confidence,
      must_surface: row.must_surface,
      auto_persist_candidate: row.auto_persist_candidate,
      ratified_by: row.ratified_by,
      ratified_at: row.ratified_at,
      auto_persisted: row.auto_persisted,
      counter_thought: row.counter_thought,
      metadata: row.metadata,
      created_at: row.created_at,
    }))

    res.json({
      thoughts: response,
      pagination: {
        limit: rawLimit,
        offset: rawOffset,
        has_more: hasMore,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[squad-api/thoughts] Query failed:', message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export { router as thoughtsRouter, VALID_THOUGHT_TYPES }
