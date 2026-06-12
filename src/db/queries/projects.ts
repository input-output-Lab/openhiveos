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
  business_value?: number
  strategic_fit?: number
  effort?: number
  risk_index?: number
}): Promise<Project> {
  const result = await pool.query<Project>(
    `INSERT INTO projects (slug, name, description, owner_agent_slug, business_value, strategic_fit, effort, risk_index)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, slug, name, description, status, owner_agent_slug, business_value, strategic_fit, effort, risk_index, created_at, updated_at`,
    [
      params.slug, 
      params.name, 
      params.description ?? null, 
      params.owner_agent_slug,
      params.business_value ?? null,
      params.strategic_fit ?? null,
      params.effort ?? null,
      params.risk_index ?? 1
    ],
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
  business_value?: number
  strategic_fit?: number
  effort?: number
  risk_index?: number
}): Promise<Project | undefined> {
  const result = await pool.query<Project>(
    `UPDATE projects
     SET name           = COALESCE($3, name),
         description    = COALESCE($4, description),
         status         = COALESCE($5, status),
         business_value = COALESCE($6, business_value),
         strategic_fit  = COALESCE($7, strategic_fit),
         effort         = COALESCE($8, effort),
         risk_index     = COALESCE($9, risk_index)
     WHERE id = $1 AND owner_agent_slug = $2
     RETURNING id, slug, name, description, status, owner_agent_slug, business_value, strategic_fit, effort, risk_index, created_at, updated_at`,
    [
      params.project_id,
      params.owner_agent_slug,
      params.name ?? null,
      params.description ?? null,
      params.status ?? null,
      params.business_value ?? null,
      params.strategic_fit ?? null,
      params.effort ?? null,
      params.risk_index ?? null,
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
    `SELECT id, slug, name, description, status, owner_agent_slug, 
            business_value, strategic_fit, effort, risk_index,
            (business_value * strategic_fit)::FLOAT / effort AS roi_score,
            created_at, updated_at
     FROM projects
     ${where}
     ORDER BY (business_value * strategic_fit)::FLOAT / effort DESC NULLS LAST, created_at DESC`,
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
       p.business_value, p.strategic_fit, p.effort, p.risk_index,
       (p.business_value * p.strategic_fit)::FLOAT / p.effort AS roi_score,
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

// ---------------------------------------------------------------------------
// applyPortfolioUpdate — S11-BE-03/S11-BE-00 shared function
//
// ARCH-021: Portfolio Matrix Value Domain (1/3/5 categorical)
//
// Updates portfolio matrix fields (business_value, strategic_fit, effort, risk_index)
// on any project. NO OWNERSHIP RESTRICTION — tool-assignment is the access gate.
//
// Returns the updated project row with computed roi_score.
// Throws if the project does not exist.
//
// ROI score computed on read: (business_value × strategic_fit) / effort
// Returns null if any component is null or effort = 0.
//
// SEC-31: Field allowlist — only portfolio matrix fields may be updated.
// Mass assignment is impossible.
// ---------------------------------------------------------------------------

export async function applyPortfolioUpdate(params: {
  project_id: number
  business_value?: (1 | 3 | 5) | null
  strategic_fit?: (1 | 3 | 5) | null
  effort?: (1 | 3 | 5) | null
  risk_index?: (1 | 3 | 5) | null
}): Promise<Project> {
  // Prepare the UPDATE statement — only set fields that were explicitly passed
  const updates: string[] = []
  const values: unknown[] = [params.project_id]
  let idx = 2

  if (params.business_value !== undefined) {
    updates.push(`business_value = $${String(idx++)}`)
    values.push(params.business_value)
  }
  if (params.strategic_fit !== undefined) {
    updates.push(`strategic_fit = $${String(idx++)}`)
    values.push(params.strategic_fit)
  }
  if (params.effort !== undefined) {
    updates.push(`effort = $${String(idx++)}`)
    values.push(params.effort)
  }
  if (params.risk_index !== undefined) {
    updates.push(`risk_index = $${String(idx++)}`)
    values.push(params.risk_index)
  }

  if (updates.length === 0) {
    // No fields to update — fetch and return the current row unchanged
    const result = await pool.query<Project>(
      `SELECT id, slug, name, description, status, owner_agent_slug,
              business_value, strategic_fit, effort, risk_index,
              (business_value * strategic_fit)::FLOAT / NULLIF(effort, 0) AS roi_score,
              created_at, updated_at
       FROM projects
       WHERE id = $1`,
      [params.project_id],
    )
    const row = result.rows[0]
    if (!row) throw new Error(`[db] Project ${String(params.project_id)} not found`)
    return row
  }

  // UPDATE with computed ROI score on return
  const result = await pool.query<Project>(
    `UPDATE projects
     SET ${updates.join(', ')}
     WHERE id = $1
     RETURNING id, slug, name, description, status, owner_agent_slug,
               business_value, strategic_fit, effort, risk_index,
               (business_value * strategic_fit)::FLOAT / NULLIF(effort, 0) AS roi_score,
               created_at, updated_at`,
    values,
  )

  const row = result.rows[0]
  if (!row) throw new Error(`[db] Project ${String(params.project_id)} not found (UPDATE returned no rows)`)
  return row
}
