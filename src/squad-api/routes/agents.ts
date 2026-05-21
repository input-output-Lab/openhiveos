import { Router } from 'express'
import { withReaderRole } from '../db.js'

// ---------------------------------------------------------------------------
// GET /api/agents — ARCH-014 C7 (#1374)
//
// Returns all provisioned agents from the agents table.
// Exposes only non-sensitive columns — token_hash, token_salt, and all
// previous_token_* columns are explicitly excluded (SEC-A6).
//
// DB role: openhiveos_reader — SELECT-only, enforced via withReaderRole()
//
// Response: { agents: AgentRow[] }
//   AgentRow: { slug, display_name, active, updated_at, last_used_at }
//
// Ordered: active agents first, then by slug alphabetically.
// ---------------------------------------------------------------------------

const router = Router()

// Column selection intentionally excludes all token columns (SEC-A6).
const AGENTS_SQL = `
  SELECT slug,
         display_name,
         active,
         updated_at,
         last_used_at
    FROM agents
   ORDER BY active DESC, slug ASC
`

interface AgentRow {
  slug: string
  display_name: string
  active: boolean
  updated_at: string
  last_used_at: string | null
}

// GET /api/agents
router.get('/', async (_req, res) => {
  try {
    const agents = await withReaderRole(async (client) => {
      const result = await client.query<AgentRow>(AGENTS_SQL)
      return result.rows
    })

    res.json({ agents })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[squad-api/agents] Query failed:', message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export { router as agentsRouter }
