import { pool } from '../client.js'
import type { Sprint } from '../../types.js'

// ---------------------------------------------------------------------------
// ARCH-011 query contracts — Sprints
//
// query_sprints: caller-scoped (ARCH-011 Decision 2, Richo 2026-05-20)
// Returns sprint rows only for projects owned by the calling agent.
// Open-read (any agent querying any project's sprints) is explicitly rejected.
//
// SEC-25 pattern: ALLOWED_SPRINT_FILTERS whitelist prevents SQL injection
// via column name substitution — parameterised values alone do not protect
// against injected column identifiers.
// ---------------------------------------------------------------------------

// Named constant — Locksmith auditability requirement (SEC-30 pattern)
export const ALLOWED_SPRINT_FILTERS = ['project_id', 'sprint_number'] as const
type SprintFilterKey = (typeof ALLOWED_SPRINT_FILTERS)[number]

// ---------------------------------------------------------------------------
// querySprints
//
// Returns sprints for all projects owned by the calling agent, optionally
// filtered by project_id and/or sprint_number.
//
// Authorization: the JOIN to projects with owner_agent_slug = $1 is the
// primary security predicate and is always present — it cannot be removed
// or bypassed by caller-supplied filters.
// ---------------------------------------------------------------------------

export async function querySprints(
  filters: Partial<Record<SprintFilterKey, number>>,
  ownerAgentSlug: string,
): Promise<Sprint[]> {
  const conditions: string[] = [
    // Primary authorization predicate — always present (ARCH-011 Decision 2)
    `p.owner_agent_slug = $1`,
  ]
  const values: unknown[] = [ownerAgentSlug]
  let idx = 2

  for (const key of ALLOWED_SPRINT_FILTERS) {
    if (filters[key] !== undefined) {
      // Fully qualify sprint columns to avoid ambiguity in the JOIN
      conditions.push(`s.${key} = $${String(idx++)}`)
      values.push(filters[key])
    }
  }

  const result = await pool.query<Sprint>(
    `SELECT s.id, s.project_id, s.sprint_number, s.sprint_goal, s.started_at, s.created_at
     FROM sprints s
     JOIN projects p ON p.id = s.project_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY s.project_id ASC, s.sprint_number ASC`,
    values,
  )
  return result.rows
}
