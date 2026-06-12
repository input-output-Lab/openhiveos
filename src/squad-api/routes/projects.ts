import { Router } from 'express'
import { z } from 'zod'
import { withReaderRole, squadApiPool } from '../db.js'

// ---------------------------------------------------------------------------
// /api/projects — project roster (ARCH-019 Sprint 10, S10-BE-01/02/03)
//
// GET /api/projects[?status=&owner=&limit=&offset=]
//   Returns paginated project list.
//   Filters:
//     status — must be a member of VALID_PROJECT_STATUSES (SEC-C3). Default: 'active'.
//     owner  — matches projects.owner_agent_slug exactly.
//   Pagination: limit [1,100] default 25, offset >= 0, has_more via limit+1 probe.
//
// GET /api/projects/:slug
//   Returns a single project with open_task_count and current_sprint composite.
//   open_task_count: tasks in active statuses (SEC-C6 allowlist, not raw SQL string).
//   current_sprint: latest sprint by sprint_number, null if none exist.
//   404 if slug not found — opaque, does not enumerate valid slugs (SEC-A6 principle).
//
// GET /api/projects/:slug/sprints
//   Returns paginated sprint history for a project, ordered by sprint_number DESC.
//   404 if project slug not found (same opaque contract as detail route).
//
// DB role: openhiveos_reader via withReaderRole() on all queries (SEC-A5).
// ---------------------------------------------------------------------------

const router = Router()

// SEC-C3: VALID_PROJECT_STATUSES — single named const, single audit point.
// Must stay in sync with CHECK constraint on projects.status in the migration.
const VALID_PROJECT_STATUSES = ['active', 'archived'] as const

type ValidProjectStatus = typeof VALID_PROJECT_STATUSES[number]

// SEC-C6: OPEN_TASK_STATUSES named allowlist — same principle as ACTIVE_TASK_STATUSES
// in agents.ts. Never build this as an inline SQL string.
const OPEN_TASK_STATUSES = ['todo', 'wip', 'review', 'rework'] as const

interface ProjectDbRow {
  id: string
  slug: string
  name: string
  description: string | null
  status: string
  owner_agent_slug: string | null
  business_value: number | null
  strategic_fit: number | null
  effort: number | null
  risk_index: number
  roi_score: number | null
  created_at: string
  updated_at: string
}

interface ProjectRow {
  id: number
  slug: string
  name: string
  description: string | null
  status: string
  owner_agent_slug: string | null
  business_value: number | null
  strategic_fit: number | null
  effort: number | null
  risk_index: number
  roi_score: number | null
  created_at: string
  updated_at: string
}

interface ProjectDetailDbRow extends ProjectDbRow {
  open_task_count: string
}

interface SprintDbRow {
  sprint_number: string
  sprint_goal: string | null
  started_at: string | null
}

// ---------------------------------------------------------------------------
// GET /api/projects
// ---------------------------------------------------------------------------

router.get('/', async (req, res) => {
  // ── Pagination ─────────────────────────────────────────────────────────────
  const rawLimit  = parseInt(typeof req.query['limit']  === 'string' ? req.query['limit']  : '25', 10)
  const rawOffset = parseInt(typeof req.query['offset'] === 'string' ? req.query['offset'] : '0',  10)

  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
    res.status(400).json({ error: 'limit must be an integer between 1 and 100' })
    return
  }
  if (!Number.isInteger(rawOffset) || rawOffset < 0) {
    res.status(400).json({ error: 'offset must be a non-negative integer' })
    return
  }

  // ── Status filter (SEC-C3) ─────────────────────────────────────────────────
  // Default: 'active' (dashboard shows active projects by default).
  const rawStatus = typeof req.query['status'] === 'string' ? req.query['status'] : 'active'
  if (!(VALID_PROJECT_STATUSES as readonly string[]).includes(rawStatus)) {
    res.status(400).json({
      error: `Invalid status. Valid values: ${VALID_PROJECT_STATUSES.join(', ')}`,
    })
    return
  }
  const status = rawStatus as ValidProjectStatus

  // ── Owner filter ───────────────────────────────────────────────────────────
  const owner = typeof req.query['owner'] === 'string' ? req.query['owner'] : undefined

  // ── Query ──────────────────────────────────────────────────────────────────
  try {
    const params: unknown[] = []
    const conditions: string[] = []

    params.push(status)
    conditions.push(`p.status = $${String(params.length)}`)

    if (owner !== undefined) {
      params.push(owner)
      conditions.push(`p.owner_agent_slug = $${String(params.length)}`)
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`

    params.push(rawLimit + 1)
    const limitParam = String(params.length)

    params.push(rawOffset)
    const offsetParam = String(params.length)

    const sql = `
      SELECT p.id,
             p.slug,
             p.name,
             p.description,
             p.status,
             p.owner_agent_slug,
             p.business_value,
             p.strategic_fit,
             p.effort,
             p.risk_index,
             CASE WHEN p.effort IS NULL OR p.effort = 0 THEN NULL ELSE (p.business_value * p.strategic_fit)::FLOAT / p.effort END AS roi_score,
             p.created_at,
             p.updated_at
        FROM projects p
      ${whereClause}
       ORDER BY p.status ASC, p.name ASC
       LIMIT $${limitParam} OFFSET $${offsetParam}
    `

    const projects = await withReaderRole(async (client) => {
      const result = await client.query<ProjectDbRow>(sql, params)
      return result.rows
    })

    const hasMore = projects.length > rawLimit
    const rows = hasMore ? projects.slice(0, rawLimit) : projects

    const response: ProjectRow[] = rows.map((row) => ({
      id: parseInt(row.id, 10),
      slug: row.slug,
      name: row.name,
      description: row.description,
      status: row.status,
      owner_agent_slug: row.owner_agent_slug,
      business_value: row.business_value,
      strategic_fit: row.strategic_fit,
      effort: row.effort,
      risk_index: row.risk_index,
      roi_score: row.roi_score ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))

    res.json({
      data: response,
      meta: {
        limit: rawLimit,
        offset: rawOffset,
        has_more: hasMore,
      },
    })
  } catch (err) {
    let message = 'Unknown error'
    if (err instanceof Error) {
      message = err.message
    }
    console.error('[squad-api/projects] List query failed:', message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/projects/:slug
// ---------------------------------------------------------------------------

router.get('/:slug', async (req, res) => {
  const { slug } = req.params

  // Express guarantees slug is a string here — guard for empty path segment
  if (!slug || slug.trim() === '') {
    res.status(400).json({ error: 'Invalid project slug' })
    return
  }

  try {
    // Two queries inside a single reader connection: avoids two round-trips
    // while keeping the SQL readable (vs. a complex GROUP BY + LATERAL join).
    const { project, sprint } = await withReaderRole(async (client) => {
      // Query 1: project row + open task count
      // OPEN_TASK_STATUSES allowlist is used as a named const (SEC-C6 principle).
      // The allowlist is injected as a parameterized array — not string interpolation.
      const projectResult = await client.query<ProjectDetailDbRow>(
        `SELECT p.id,
                p.slug,
                p.name,
                p.description,
                p.status,
                p.owner_agent_slug,
                p.business_value,
                p.strategic_fit,
                p.effort,
                p.risk_index,
                CASE WHEN p.effort IS NULL OR p.effort = 0 THEN NULL ELSE (p.business_value * p.strategic_fit)::FLOAT / p.effort END AS roi_score,
                p.created_at,
                p.updated_at,
                COALESCE(
                  COUNT(t.id) FILTER (WHERE t.status = ANY($2::text[])),
                  0
                ) AS open_task_count
           FROM projects p
           LEFT JOIN tasks t ON t.project_id = p.id
          WHERE p.slug = $1
          GROUP BY p.id`,
        [slug, OPEN_TASK_STATUSES],
      )

      if (projectResult.rows.length === 0) {
        return { project: null, sprint: null }
      }

      const projectRow = projectResult.rows[0] as ProjectDetailDbRow

      // Query 2: latest sprint for this project (null if none)
      const sprintResult = await client.query<SprintDbRow>(
        `SELECT sprint_number,
                sprint_goal,
                started_at
           FROM sprints
          WHERE project_id = $1
          ORDER BY sprint_number DESC
          LIMIT 1`,
        [projectRow.id],
      )

      return {
        project: projectRow,
        sprint: sprintResult.rows[0] ?? null,
      }
    })

    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }

    res.json({
      project: {
        id: parseInt(project.id, 10),
        slug: project.slug,
        name: project.name,
        description: project.description,
        status: project.status,
        owner_agent_slug: project.owner_agent_slug,
        business_value: project.business_value,
        strategic_fit: project.strategic_fit,
        effort: project.effort,
        risk_index: project.risk_index,
        roi_score: project.roi_score ?? null,
        open_task_count: parseInt(project.open_task_count, 10),
        current_sprint: sprint != null
          ? {
              sprint_number: parseInt(sprint.sprint_number, 10),
              sprint_goal: sprint.sprint_goal,
              started_at: sprint.started_at,
            }
          : null,
        created_at: project.created_at,
        updated_at: project.updated_at,
      },
    })
  } catch (err) {
    let message = 'Unknown error'
    if (err instanceof Error) {
      message = err.message
    }
    console.error('[squad-api/projects] Detail query failed:', message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/projects/:slug/sprints
// ---------------------------------------------------------------------------

router.get('/:slug/sprints', async (req, res) => {
  const { slug } = req.params

  if (!slug || slug.trim() === '') {
    res.status(400).json({ error: 'Invalid project slug' })
    return
  }

  // ── Pagination ─────────────────────────────────────────────────────────────
  const rawLimit  = parseInt(typeof req.query['limit']  === 'string' ? req.query['limit']  : '25', 10)
  const rawOffset = parseInt(typeof req.query['offset'] === 'string' ? req.query['offset'] : '0',  10)

  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
    res.status(400).json({ error: 'limit must be an integer between 1 and 100' })
    return
  }
  if (!Number.isInteger(rawOffset) || rawOffset < 0) {
    res.status(400).json({ error: 'offset must be a non-negative integer' })
    return
  }

  try {
    // Resolve project id from slug — opaque 404 if not found (SEC-A6 principle)
    const projectResult = await withReaderRole(async (client) => {
      return client.query<{ id: string }>(
        `SELECT id FROM projects WHERE slug = $1`,
        [slug],
      )
    })

    if (projectResult.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' })
      return
    }

    const projectId = (projectResult.rows[0] as ProjectDbRow).id

    // Fetch paginated sprint history
    const sprintRows = await withReaderRole(async (client) => {
      const result = await client.query<SprintDbRow>(
        `SELECT sprint_number,
                sprint_goal,
                started_at
           FROM sprints
          WHERE project_id = $1
          ORDER BY sprint_number DESC
          LIMIT $2 OFFSET $3`,
        [projectId, rawLimit + 1, rawOffset],
      )
      return result.rows
    })

    const hasMore = sprintRows.length > rawLimit
    const rows = hasMore ? sprintRows.slice(0, rawLimit) : sprintRows

    res.json({
      data: rows.map((row) => ({
        sprint_number: parseInt(row.sprint_number, 10),
        sprint_goal: row.sprint_goal,
        started_at: row.started_at,
      })),
      meta: {
        limit: rawLimit,
        offset: rawOffset,
        has_more: hasMore,
      },
    })
  } catch (err) {
    let message = 'Unknown error'
    if (err instanceof Error) {
      message = err.message
    }
    console.error('[squad-api/projects] Sprints query failed:', message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ---------------------------------------------------------------------------
// PATCH /api/projects/:slug — Portfolio matrix update (S11-BE-00, ARCH-021)
//
// Updates portfolio matrix fields (business_value, strategic_fit, effort, risk_index)
// on a project. Any authenticated agent may call this endpoint — no ownership
// restriction. Tool-assignment is the access gate.
//
// Path:   :slug (string, project identifier)
// Body:   JSON object with optional portfolio matrix fields (1|3|5|null)
//         Must include at least one field. Others omitted = no change.
//
// Returns: 200 with updated project row including computed roi_score
//          400 if validation fails (field value not in 1|3|5, etc.)
//          404 if project slug not found (opaque, no enumeration — SEC-A6)
//          422 if no fields provided (Unprocessable Entity)
//
// SEC-31: Field allowlist — only portfolio matrix fields may be updated.
// Mass assignment is impossible.
// ---------------------------------------------------------------------------

const PatchProjectBodySchema = z.object({
  business_value: z
    .union([z.literal(1), z.literal(3), z.literal(5)])
    .nullable()
    .optional(),
  strategic_fit: z
    .union([z.literal(1), z.literal(3), z.literal(5)])
    .nullable()
    .optional(),
  effort: z
    .union([z.literal(1), z.literal(3), z.literal(5)])
    .nullable()
    .optional(),
  risk_index: z
    .union([z.literal(1), z.literal(3), z.literal(5)])
    .nullable()
    .optional(),
}).strict()

router.patch('/:slug', async (req, res) => {
  try {
    const slug = req.params['slug']
    const parsed = PatchProjectBodySchema.parse(req.body)

    // SEC-31: Field allowlist via .strict() + validate at least one field is provided
    const hasUpdate = Object.values(parsed).some((v) => v !== undefined)
    if (!hasUpdate) {
      res.status(422).json({ error: 'At least one portfolio matrix field must be provided' })
      return
    }

    const client = await squadApiPool.connect()
    try {
      await client.query('BEGIN')

      // Lookup project by slug
      const projectResult = await client.query<{ id: string }>(
        'SELECT id FROM projects WHERE slug = $1',
        [slug],
      )

      const projectRow = projectResult.rows[0]
      if (!projectRow) {
        res.status(404).json({ error: 'Project not found' })
        return
      }

      const projectId = parseInt(projectRow.id, 10)

      // Build the UPDATE statement — only update fields that were provided
      const updates: string[] = []
      const values: unknown[] = [projectId]
      let idx = 2

      if (parsed.business_value !== undefined) {
        updates.push(`business_value = $${String(idx++)}`)
        values.push(parsed.business_value)
      }
      if (parsed.strategic_fit !== undefined) {
        updates.push(`strategic_fit = $${String(idx++)}`)
        values.push(parsed.strategic_fit)
      }
      if (parsed.effort !== undefined) {
        updates.push(`effort = $${String(idx++)}`)
        values.push(parsed.effort)
      }
      if (parsed.risk_index !== undefined) {
        updates.push(`risk_index = $${String(idx++)}`)
        values.push(parsed.risk_index)
      }

      const updateResult = await client.query<ProjectDbRow>(
        `UPDATE projects
         SET ${updates.join(', ')}
         WHERE id = $1
         RETURNING id, slug, name, description, status, owner_agent_slug,
                   business_value, strategic_fit, effort, risk_index,
                   CASE WHEN effort IS NULL OR effort = 0 THEN NULL ELSE (business_value * strategic_fit)::FLOAT / effort END AS roi_score,
                   created_at, updated_at`,
        values,
      )

      await client.query('COMMIT')

      const updatedProject = updateResult.rows[0]
      if (!updatedProject) {
        res.status(500).json({ error: 'Update failed — project not found after UPDATE' })
        return
      }

      res.json({
        data: {
          id: parseInt(updatedProject.id, 10),
          slug: updatedProject.slug,
          name: updatedProject.name,
          description: updatedProject.description,
          status: updatedProject.status,
          owner_agent_slug: updatedProject.owner_agent_slug,
          business_value: updatedProject.business_value,
          strategic_fit: updatedProject.strategic_fit,
          effort: updatedProject.effort,
          risk_index: updatedProject.risk_index,
          roi_score: updatedProject.roi_score ?? null,
          created_at: updatedProject.created_at,
          updated_at: updatedProject.updated_at,
        },
      })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      const fieldErrors = err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }))
      res.status(400).json({ error: 'Validation failed', fields: fieldErrors })
      return
    }

    let message = 'Unknown error'
    if (err instanceof Error) {
      message = err.message
    }
    console.error('[squad-api/projects] PATCH failed:', message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export { router as projectsRouter, VALID_PROJECT_STATUSES }
