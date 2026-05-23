import { Router } from 'express'
import { basename } from 'node:path'
import { withReaderRole } from '../db.js'

// ---------------------------------------------------------------------------
// /api/sops — SOP roster (ARCH-019 Sprint 9, S9-BE-03)
//
// GET /api/sops[?category=&agent=&limit=&offset=]
//   Returns paginated SOP list: id, source_path, derived display_name, category,
//   agent, 200-char instruction preview, timestamps.
//
//   Excluded from response (SEC-B1 principle):
//     - embedding (vector column — never expose raw embeddings)
//     - instruction (full text — returned as 200-char preview only)
//
// Filters:
//   category — must be a member of VALID_CATEGORIES (SEC-C7 named const).
//              Unrecognised values → 400.
//   agent    — plain text match against the `agent` column.
//
// Pagination (ARCH-019 model):
//   limit  — integer [1, 100], default 25
//   offset — integer >= 0, default 0
//   has_more — true when a (limit+1)th row exists (avoids COUNT(*))
//
// DB role: openhiveos_reader — SELECT-only, enforced via withReaderRole().
// ---------------------------------------------------------------------------

const router = Router()

// SEC-C7: VALID_CATEGORIES must be a named const — not an inline array literal.
// Changing the allowed values here is the single audit point.
const VALID_CATEGORIES = [
  'Coding',
  'DevOps',
  'QA',
  'Architecture',
  'Documentation',
  'Decision',
] as const

type ValidCategory = typeof VALID_CATEGORIES[number]

/** Derive display_name from source_path: strip directory + .md extension. */
function toDisplayName(sourcePath: string | null): string {
  if (!sourcePath) return ''
  return basename(sourcePath, '.md')
}

interface SopDbRow {
  id: number
  source_path: string | null
  category: string
  agent: string | null
  preview: string        // LEFT(instruction, 200) from DB
  created_at: string
  updated_at: string
}

interface SopRow {
  id: number
  source_path: string | null
  display_name: string
  category: string
  agent: string | null
  preview: string
  created_at: string
  updated_at: string
}

// GET /api/sops
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

  // ── Category filter (SEC-C7) ──────────────────────────────────────────────
  const rawCategory = typeof req.query['category'] === 'string' ? req.query['category'] : undefined
  let category: ValidCategory | undefined

  if (rawCategory !== undefined) {
    const candidate = rawCategory
    if (!(VALID_CATEGORIES as readonly string[]).includes(candidate)) {
      res.status(400).json({
        error: `Invalid category. Valid values: ${VALID_CATEGORIES.join(', ')}`,
      })
      return
    }
    category = candidate as ValidCategory
  }

  // ── Agent filter ──────────────────────────────────────────────────────────
  const agentFilter = typeof req.query['agent'] === 'string' ? req.query['agent'] : undefined

  // ── Query ─────────────────────────────────────────────────────────────────
  // Fetch limit+1 rows to determine has_more without COUNT(*).
  // embedding excluded (SEC-B1 principle — never expose vector data).
  // instruction truncated to 200 chars for the preview field.
  try {
    const params: unknown[] = []
    const conditions: string[] = []

    if (category !== undefined) {
      params.push(category)
      conditions.push(`category = $${String(params.length)}`)
    }

    if (agentFilter !== undefined) {
      params.push(agentFilter)
      conditions.push(`agent = $${String(params.length)}`)
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : ''

    params.push(rawLimit + 1)
    const limitParam = String(params.length)

    params.push(rawOffset)
    const offsetParam = String(params.length)

    const sql = `
      SELECT id,
             source_path,
             category,
             agent,
             LEFT(instruction, 200) AS preview,
             created_at,
             updated_at
        FROM sops
      ${whereClause}
       ORDER BY category ASC, source_path ASC
       LIMIT $${limitParam} OFFSET $${offsetParam}
    `

    const sops = await withReaderRole(async (client) => {
      const result = await client.query<SopDbRow>(sql, params)
      return result.rows
    })

    const hasMore = sops.length > rawLimit
    const rows = hasMore ? sops.slice(0, rawLimit) : sops

    const response: SopRow[] = rows.map((row) => ({
      id: row.id,
      source_path: row.source_path,
      display_name: toDisplayName(row.source_path),
      category: row.category,
      agent: row.agent,
      preview: row.preview,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))

    res.json({
      sops: response,
      pagination: {
        limit: rawLimit,
        offset: rawOffset,
        has_more: hasMore,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[squad-api/sops] Query failed:', message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export { router as sopsRouter, VALID_CATEGORIES }
