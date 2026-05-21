import { pool } from '../client.js'
import type { Project, ProjectBoard, TaskSummary } from '../../types.js'

// ---------------------------------------------------------------------------
// ARCH-010 query contracts — Projects
// SEC-21: owner_agent_slug always injected from bearer token, never from input
// SEC-25: dynamic filter columns validated against ALLOWED_PROJECT_FILTERS
// ---------------------------------------------------------------------------

// Named constant — Locksmith auditability requirement (SEC-25)
export const ALLOWED_PROJECT_FILTERS = ['status', 'owner_agent_slug'] as const
type ProjectFilterKey = (typeof ALLOWED_PROJECT_FILTERS)[number]

// ---------------------------------------------------------------------------
// createProject
// ---------------------------------------------------------------------------

export async function createProject(params: {
  slug: string
  name: string
  description?: string
  owner_agent_slug: string
}): Promise<Project> {
  const result = await pool.query<Project>(
    `INSERT INTO projects (slug, name, description, owner_agent_slug)
     VALUES ($1, $2, $3, $4)
     RETURNING id, slug, name, description, status, owner_agent_slug, created_at, updated_at`,
    [params.slug, params.name, params.description ?? null, params.owner_agent_slug],
  )
  const row = result.rows[0]
  if (!row) throw new Error('[db] INSERT INTO projects returned no row')
  return row
}

// ---------------------------------------------------------------------------
// updateProject
// SEC-21: WHERE clause includes owner_agent_slug — returns undefined if the
// caller does not own the project (treated as 403 by the handler, not 500).
// ---------------------------------------------------------------------------

export async function updateProject(params: {
  project_id: number
  owner_agent_slug: string
  name?: string
  description?: string
  status?: string
}): Promise<Project | undefined> {
  const result = await pool.query<Project>(
    `UPDATE projects
     SET name        = COALESCE($3, name),
         description = COALESCE($4, description),
         status      = COALESCE($5, status)
     WHERE id = $1 AND owner_agent_slug = $2
     RETURNING id, slug, name, description, status, owner_agent_slug, created_at, updated_at`,
    [
      params.project_id,
      params.owner_agent_slug,
      params.name ?? null,
      params.description ?? null,
      params.status ?? null,
    ],
  )
  return result.rows[0]
}

// ---------------------------------------------------------------------------
// queryProjects
// SEC-25: only ALLOWED_PROJECT_FILTERS keys are accepted — whitelist is the
// named constant above, not an inline array.
// ---------------------------------------------------------------------------

export async function queryProjects(
  filters: Partial<Record<ProjectFilterKey, string>>,
): Promise<Project[]> {
  const conditions: string[] = []
  const values: unknown[] = []
  let idx = 1

  for (const key of ALLOWED_PROJECT_FILTERS) {
    if (filters[key] !== undefined) {
      conditions.push(`${key} = $${String(idx++)}`)
      values.push(filters[key])
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const result = await pool.query<Project>(
    `SELECT id, slug, name, description, status, owner_agent_slug, created_at, updated_at
     FROM projects
     ${where}
     ORDER BY created_at DESC`,
    values,
  )
  return result.rows
}

// ---------------------------------------------------------------------------
// getProjectBoard
// SEC-24: owner_agent_slug is always server-injected — caller supplies only slug.
// Returns undefined if the project does not exist or the agent does not own it.
// ---------------------------------------------------------------------------

export async function getProjectBoard(params: {
  slug: string
  owner_agent_slug: string
}): Promise<ProjectBoard | undefined> {
  const result = await pool.query<
    Project & {
      todo_count: string
      wip_count: string
      review_count: string
      done_count: string
      rework_count: string
      tasks: TaskSummary[]
    }
  >(
    `SELECT
       p.id, p.slug, p.name, p.description, p.status, p.owner_agent_slug,
       p.created_at, p.updated_at,
       COUNT(t.id) FILTER (WHERE t.status = 'todo')   AS todo_count,
       COUNT(t.id) FILTER (WHERE t.status = 'wip')    AS wip_count,
       COUNT(t.id) FILTER (WHERE t.status = 'review') AS review_count,
       COUNT(t.id) FILTER (WHERE t.status = 'done')   AS done_count,
       COUNT(t.id) FILTER (WHERE t.status = 'rework') AS rework_count,
       COALESCE(
         json_agg(
           json_build_object(
             'id',                  t.id,
             'title',               t.title,
             'status',              t.status,
             'assignee_agent_slug', t.assignee_agent_slug,
             'github_pr_url',       t.github_pr_url,
             'notes',               t.notes,
             'created_at',          t.created_at,
             'updated_at',          t.updated_at
           ) ORDER BY t.created_at
         ) FILTER (WHERE t.id IS NOT NULL),
         '[]'::json
       ) AS tasks
     FROM projects p
     LEFT JOIN tasks t ON t.project_id = p.id
     WHERE p.slug = $1 AND p.owner_agent_slug = $2
     GROUP BY p.id`,
    [params.slug, params.owner_agent_slug],
  )

  const row = result.rows[0]
  if (!row) return undefined

  return {
    ...row,
    todo_count: parseInt(row.todo_count, 10),
    wip_count: parseInt(row.wip_count, 10),
    review_count: parseInt(row.review_count, 10),
    done_count: parseInt(row.done_count, 10),
    rework_count: parseInt(row.rework_count, 10),
  }
}
