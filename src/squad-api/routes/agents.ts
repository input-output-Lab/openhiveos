import { Router } from 'express'
import { withReaderRole } from '../db.js'
import { getManifestAgent } from '../manifest.js'

// ---------------------------------------------------------------------------
// /api/agents — agent roster routes (ARCH-014 C7, ARCH-019 Sprint 9)
//
// GET /api/agents
//   Returns all provisioned agents with runtime state + active task count.
//   Token columns excluded (SEC-A6). active_task_count via LEFT JOIN (SEC-C6).
//
// GET /api/agents/:slug
//   Returns a single agent composited with manifest role (ARCH-019 A2).
//   Manifest loaded once at startup — no per-request file I/O (SEC-C5).
//   Returns 404 when slug is not found in agents table (no existence leak).
//
// DB role: openhiveos_reader — SELECT-only, enforced via withReaderRole().
// ---------------------------------------------------------------------------

const router = Router()

// Active task statuses counted toward an agent's workload (SEC-C6).
// Matches the FILTER clause in AGENTS_SQL and AGENT_BY_SLUG_SQL below.
const ACTIVE_TASK_STATUSES = ['todo', 'wip', 'review', 'rework'] as const

// Column selection excludes all token columns (SEC-A6).
// active_task_count: LEFT JOIN so zero-task agents return 0, never null (SEC-C6).
// SEC-S9-01: The FILTER clause IN-list below must mirror ACTIVE_TASK_STATUSES exactly.
//   TypeScript cannot interpolate a const into a SQL string — keep both in sync manually.
//   If ACTIVE_TASK_STATUSES changes, update both AGENTS_SQL and AGENT_BY_SLUG_SQL.
const AGENTS_SQL = `
  SELECT a.slug,
         a.display_name,
         a.active,
         a.updated_at,
         a.last_used_at,
         COALESCE(COUNT(t.id) FILTER (
             WHERE t.status IN ('todo', 'wip', 'review', 'rework')
         ), 0)::int AS active_task_count
    FROM agents a
    LEFT JOIN tasks t ON t.assignee_agent_slug = a.slug
   GROUP BY a.slug, a.display_name, a.active, a.updated_at, a.last_used_at
   ORDER BY a.active DESC, a.slug ASC
`

const AGENT_BY_SLUG_SQL = `
  SELECT a.slug,
         a.display_name,
         a.active,
         a.updated_at,
         a.last_used_at,
         COALESCE(COUNT(t.id) FILTER (
             WHERE t.status IN ('todo', 'wip', 'review', 'rework')
         ), 0)::int AS active_task_count
    FROM agents a
    LEFT JOIN tasks t ON t.assignee_agent_slug = a.slug
   WHERE a.slug = $1
   GROUP BY a.slug, a.display_name, a.active, a.updated_at, a.last_used_at
`

interface AgentRow {
  slug: string
  display_name: string
  active: boolean
  updated_at: string
  last_used_at: string | null
  active_task_count: number
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

// GET /api/agents/:slug
router.get('/:slug', async (req, res) => {
  const { slug } = req.params

  try {
    const result = await withReaderRole(async (client) => {
      return client.query<AgentRow>(AGENT_BY_SLUG_SQL, [slug])
    })

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }

    const agentRow = result.rows[0]
    const manifestEntry = getManifestAgent(slug)

    res.json({
      agent: {
        ...agentRow,
        manifest: manifestEntry
          ? {
              role: manifestEntry.role,
              skills: manifestEntry.skills,
              owns: manifestEntry.owns,
              works_with: manifestEntry.works_with,
            }
          : null,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[squad-api/agents] Query failed:', message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Re-export the ACTIVE_TASK_STATUSES const so tests can assert against it
// without duplicating the allowlist.
export { router as agentsRouter, ACTIVE_TASK_STATUSES }
