import { Router } from 'express'
import { withReaderRole } from '../db.js'

// ---------------------------------------------------------------------------
// /api/tasks — task roster (ARCH-019 Sprint 9, S9-BE-01)
//
// GET /api/tasks[?status=&assignee=&project_id=&limit=&offset=]
//   Returns paginated task list. Each row includes project_slug from a LEFT
//   JOIN on projects — allows the dashboard InboxView to link to the project
//   without a second round-trip.
//
// Filters:
//   status     — must be a member of VALID_TASK_STATUSES (SEC-C3 named const).
//               Unrecognised values → 400.
//   assignee   — matches tasks.assignee_agent_slug exactly.
//   project_id — positive integer; tasks filtered to a single project.
//
// Pagination (ARCH-019 model):
//   limit    — integer [1, 100], default 25
//   offset   — integer >= 0, default 0
//   has_more — true when a (limit+1)th row exists (avoids COUNT(*))
//
// DB role: openhiveos_reader — SELECT-only via withReaderRole() (SEC-A5).
// ---------------------------------------------------------------------------

const router = Router()

// SEC-C3: VALID_TASK_STATUSES must be a named const — single audit point.
// Must stay in sync with the CHECK constraint on tasks.status in the migration.
const VALID_TASK_STATUSES = ['todo', 'wip', 'review', 'done', 'rework'] as const

type ValidTaskStatus = typeof VALID_TASK_STATUSES[number]

interface TaskDbRow {
  id: string             // BIGSERIAL → string from pg
  project_id: string
  project_slug: string | null
  title: string
  description: string | null
  status: string
  assignee_agent_slug: string | null
  github_pr_url: string | null
  notes: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

interface TaskRow {
  id: number
  project_id: number
  project_slug: string | null
  title: string
  description: string | null
  status: string
  assignee_agent_slug: string | null
  github_pr_url: string | null
  notes: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

// GET /api/tasks
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

  // ── Status filter (SEC-C3) ────────────────────────────────────────────────
  const rawStatus = typeof req.query['status'] === 'string' ? req.query['status'] : undefined
  let status: ValidTaskStatus | undefined

  if (rawStatus !== undefined) {
    const candidate = rawStatus
    if (!(VALID_TASK_STATUSES as readonly string[]).includes(candidate)) {
      res.status(400).json({
        error: `Invalid status. Valid values: ${VALID_TASK_STATUSES.join(', ')}`,
      })
      return
    }
    status = candidate as ValidTaskStatus
  }

  // ── Assignee filter ───────────────────────────────────────────────────────
  const assignee = typeof req.query['assignee'] === 'string' ? req.query['assignee'] : undefined

  // ── Project filter ────────────────────────────────────────────────────────
  const rawProjectId = typeof req.query['project_id'] === 'string' ? req.query['project_id'] : undefined
  let projectId: number | undefined

  if (rawProjectId !== undefined) {
    const parsed = parseInt(rawProjectId, 10)
    if (!Number.isInteger(parsed) || parsed < 1) {
      res.status(400).json({ error: 'project_id must be a positive integer' })
      return
    }
    projectId = parsed
  }
  // ── Metadata filter ─────────────────────────────────────────────────────────────────────────────────
  const rawMetadata = typeof req.query['metadata'] === 'string' ? req.query['metadata'] : undefined
  let metadataFilter: Record<string, unknown> | undefined

  if (rawMetadata !== undefined) {
    try {
      const parsed = JSON.parse(rawMetadata) as unknown
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        res.status(400).json({ error: 'metadata must be a JSON object' })
        return
      }
      metadataFilter = parsed as Record<string, unknown>
    } catch {
      res.status(400).json({ error: 'metadata must be valid JSON' })
      return
    }
  }
  // ── Query ─────────────────────────────────────────────────────────────────
  // LEFT JOIN projects for project_slug — tasks cannot be deleted while
  // project exists (RESTRICT FK), but the slug is still nullable in the join
  // result type in case of edge cases.
  try {
    const params: unknown[] = []
    const conditions: string[] = []

    if (status !== undefined) {
      params.push(status)
      conditions.push(`t.status = $${String(params.length)}`)
    }

    if (assignee !== undefined) {
      params.push(assignee)
      conditions.push(`t.assignee_agent_slug = $${String(params.length)}`)
    }

    if (projectId !== undefined) {
      params.push(projectId)
      conditions.push(`t.project_id = $${String(params.length)}`)
    }

    if (metadataFilter !== undefined) {
      for (const [key, value] of Object.entries(metadataFilter)) {
        params.push(JSON.stringify({ [key]: value }))
        conditions.push(`t.metadata @> $${String(params.length)}::jsonb`)
      }
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : ''

    params.push(rawLimit + 1)
    const limitParam = String(params.length)

    params.push(rawOffset)
    const offsetParam = String(params.length)

    const sql = `
      SELECT t.id,
             t.project_id,
             p.slug AS project_slug,
             t.title,
             t.description,
             t.status,
             t.assignee_agent_slug,
             t.github_pr_url,
             t.notes,
             t.metadata,
             t.created_at,
             t.updated_at
        FROM tasks t
        LEFT JOIN projects p ON p.id = t.project_id
      ${whereClause}
       ORDER BY t.updated_at DESC, t.id DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}
    `

    const tasks = await withReaderRole(async (client) => {
      const result = await client.query<TaskDbRow>(sql, params)
      return result.rows
    })

    const hasMore = tasks.length > rawLimit
    const rows = hasMore ? tasks.slice(0, rawLimit) : tasks

    const response: TaskRow[] = rows.map((row) => ({
      id: parseInt(row.id, 10),
      project_id: parseInt(row.project_id, 10),
      project_slug: row.project_slug,
      title: row.title,
      description: row.description,
      status: row.status,
      assignee_agent_slug: row.assignee_agent_slug,
      github_pr_url: row.github_pr_url,
      notes: row.notes,
      metadata: row.metadata,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))

    res.json({
      tasks: response,
      pagination: {
        limit: rawLimit,
        offset: rawOffset,
        has_more: hasMore,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[squad-api/tasks] Query failed:', message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/tasks/:id  (S10-BE-04)
// Returns a single task by primary key.
// 400 on non-positive-integer id.
// 404 (opaque) if the id does not exist.
// ---------------------------------------------------------------------------

router.get('/:id', async (req, res) => {
  const rawId = req.params.id
  const id = parseInt(rawId, 10)

  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: 'id must be a positive integer' })
    return
  }

  try {
    const result = await withReaderRole(async (client) => {
      return client.query<TaskDbRow>(
        `SELECT t.id,
                t.project_id,
                p.slug AS project_slug,
                t.title,
                t.description,
                t.status,
                t.assignee_agent_slug,
                t.github_pr_url,
                t.notes,
                t.metadata,
                t.created_at,
                t.updated_at
           FROM tasks t
           LEFT JOIN projects p ON p.id = t.project_id
          WHERE t.id = $1`,
        [id],
      )
    })

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Task not found' })
      return
    }

    const row = result.rows[0] as TaskDbRow

    res.json({
      task: {
        id: parseInt(row.id, 10),
        project_id: parseInt(row.project_id, 10),
        project_slug: row.project_slug,
        title: row.title,
        description: row.description,
        status: row.status,
        assignee_agent_slug: row.assignee_agent_slug,
        github_pr_url: row.github_pr_url,
        notes: row.notes,
        metadata: row.metadata,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    })
  } catch (err) {
    let message = 'Unknown error'
    if (err instanceof Error) {
      message = err.message
    }
    console.error('[squad-api/tasks] Detail query failed:', message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export { router as tasksRouter, VALID_TASK_STATUSES }
