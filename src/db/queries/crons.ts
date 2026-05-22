import { pool } from '../client.js'
import type { PoolClient } from 'pg'
import type { Cron, CronStatus } from '../../types.js'

// ---------------------------------------------------------------------------
// ARCH-011 query contracts — Cron Utilities
//
// SEC-26: tool_name validated against REGISTERED_TOOL_NAMES before reaching here
// SEC-27: payload size/nesting validated at Zod layer before reaching here
// SEC-28: schedule validated via cron-parser at Zod layer before reaching here
// SEC-29: ownership enforced in WHERE owner_agent_slug = $callerSlug on all
//         writes; not-found and not-owned both surface as not_found_or_unauthorized
// SEC-30: ALLOWED_CRON_FILTERS whitelist prevents SQL injection via column name
//         substitution — parameterised values alone do not protect column identifiers
// ---------------------------------------------------------------------------

// Named constant — Locksmith auditability requirement (SEC-30)
export const ALLOWED_CRON_FILTERS = ['project_id', 'status', 'owner_agent_slug'] as const

// Runtime value types per filter key
type CronFilterValues = {
  project_id?: number
  status?: CronStatus
  owner_agent_slug?: string
}

// ---------------------------------------------------------------------------
// DeleteCronResult — discriminated union (ARCH-011)
//
// Three outcomes are possible:
//   not_found_or_unauthorized — no row matched (cron absent OR not owned by caller)
//   already_deleted           — row exists and is owned, but status is already 'deleted'
//   success                   — row soft-deleted; returns the final row state
//
// Both not-found and not-owned return the same variant (SEC-29 — no existence leak).
// ---------------------------------------------------------------------------

export type DeleteCronResult =
  | { kind: 'not_found_or_unauthorized' }
  | { kind: 'already_deleted' }
  | { kind: 'success'; cron: Cron }

// ---------------------------------------------------------------------------
// UpdateCronResult — discriminated union (SEC-29)
//
// not_found_or_unauthorized covers both missing cron and wrong owner.
// ---------------------------------------------------------------------------

export type UpdateCronResult = { kind: 'not_found_or_unauthorized' } | { kind: 'success'; cron: Cron }

// ---------------------------------------------------------------------------
// createCron
//
// Pre-flight SELECT verifies the calling agent owns the target project before
// any INSERT. This is intentional (same pattern as createTask) — an inline
// subquery is not auditable by Locksmith.
//
// owner_agent_slug is always the server-resolved caller slug (ARCH-001).
// ---------------------------------------------------------------------------

export async function createCron(params: {
  project_id: number
  owner_agent_slug: string
  name: string
  description?: string
  schedule: string
  tool_name: string
  payload?: Record<string, unknown>
}): Promise<{ authorized: false } | { authorized: true; cron: Cron }> {
  // Pre-flight: verify the requesting agent owns this project (SEC-29 pattern)
  const ownership = await pool.query<{ id: number }>(
    `SELECT id FROM projects WHERE id = $1 AND owner_agent_slug = $2`,
    [params.project_id, params.owner_agent_slug],
  )
  if (ownership.rowCount === 0) {
    return { authorized: false }
  }

  const result = await pool.query<Cron>(
    `INSERT INTO crons (project_id, owner_agent_slug, name, description, schedule, tool_name, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, project_id, owner_agent_slug, name, description, schedule,
               tool_name, payload, status, last_run_at, created_at, updated_at`,
    [
      params.project_id,
      params.owner_agent_slug,
      params.name,
      params.description ?? null,
      params.schedule,
      params.tool_name,
      params.payload !== undefined ? JSON.stringify(params.payload) : null,
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error('[db] INSERT INTO crons returned no row')
  return { authorized: true, cron: row }
}

// ---------------------------------------------------------------------------
// queryCrons
//
// Soft-delete default: deleted crons are hidden unless status='deleted' is
// explicitly passed. This mirrors the convention in query_tasks (status filter).
//
// SEC-30: ALLOWED_CRON_FILTERS as const — only whitelisted column names can
// reach the SQL template. All values are parameterised ($N). Unknown filter
// keys are rejected at the Zod layer before this function is called.
//
// Cross-agent enumeration gap: query_crons does not enforce caller-scoping.
// An agent may query any agent's crons by passing owner_agent_slug explicitly.
// This gap is documented in ARCH-011 Tech Debt #2 and deferred to post-v0.1.
// ---------------------------------------------------------------------------

export async function queryCrons(filters: CronFilterValues): Promise<Cron[]> {
  const conditions: string[] = []
  const values: unknown[] = []
  let idx = 1

  for (const key of ALLOWED_CRON_FILTERS) {
    if (filters[key] !== undefined) {
      conditions.push(`${key} = $${String(idx++)}`)
      values.push(filters[key])
    }
  }

  // Soft-delete default: hide deleted rows unless status was explicitly passed (SEC-29 D1)
  if (filters.status === undefined) {
    conditions.push(`status != $${String(idx++)}`)
    values.push('deleted')
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const result = await pool.query<Cron>(
    `SELECT id, project_id, owner_agent_slug, name, description, schedule,
            tool_name, payload, status, last_run_at, created_at, updated_at
     FROM crons
     ${where}
     ORDER BY project_id ASC, id ASC`,
    values,
  )
  return result.rows
}

// ---------------------------------------------------------------------------
// updateCron
//
// SEC-29: ownership gate — WHERE owner_agent_slug = $callerSlug ensures the
// UPDATE affects rows owned by the caller only. Not-found and not-owned both
// return { kind: 'not_found_or_unauthorized' } — no existence information leaks.
//
// Deleted crons cannot be updated (status != 'deleted' in WHERE).
// status field accepts 'active' | 'paused' only — 'deleted' routes through deleteCron.
// ---------------------------------------------------------------------------

export async function updateCron(params: {
  id: number
  owner_agent_slug: string
  name?: string
  description?: string
  schedule?: string
  tool_name?: string
  payload?: Record<string, unknown> | null
  status?: 'active' | 'paused'
}): Promise<UpdateCronResult> {
  const result = await pool.query<Cron>(
    `UPDATE crons
     SET name        = COALESCE($3, name),
         description = COALESCE($4, description),
         schedule    = COALESCE($5, schedule),
         tool_name   = COALESCE($6, tool_name),
         payload     = CASE WHEN $7::boolean THEN $8 ELSE payload END,
         status      = COALESCE($9, status)
     WHERE id = $1
       AND owner_agent_slug = $2
       AND status != 'deleted'
     RETURNING id, project_id, owner_agent_slug, name, description, schedule,
               tool_name, payload, status, last_run_at, created_at, updated_at`,
    [
      params.id,
      params.owner_agent_slug,
      params.name ?? null,
      params.description ?? null,
      params.schedule ?? null,
      params.tool_name ?? null,
      // $7: boolean flag — true if payload field was explicitly passed (including null to clear)
      params.payload !== undefined,
      // $8: the payload value itself (null clears it)
      params.payload !== undefined ? (params.payload !== null ? JSON.stringify(params.payload) : null) : null,
      params.status ?? null,
    ],
  )
  if (result.rowCount === 0) {
    return { kind: 'not_found_or_unauthorized' }
  }
  const row = result.rows[0]
  if (!row) throw new Error('[db] UPDATE crons returned no row despite rowCount > 0')
  return { kind: 'success', cron: row }
}

// ---------------------------------------------------------------------------
// deleteCron
//
// Soft delete — sets status='deleted'. Never issues a hard DELETE.
//
// Pre-flight SELECT before UPDATE (ARCH-011 requirement, same rationale as
// createTask): makes the ownership check and the already-deleted check both
// visible and separately auditable.
//
// SEC-29: not-found and not-owned both return { kind: 'not_found_or_unauthorized' }.
// ---------------------------------------------------------------------------

export async function deleteCron(params: {
  id: number
  owner_agent_slug: string
}): Promise<DeleteCronResult> {
  // Pre-flight: check existence and ownership in a single read
  const preflight = await pool.query<{ status: CronStatus }>(
    `SELECT status FROM crons WHERE id = $1 AND owner_agent_slug = $2`,
    [params.id, params.owner_agent_slug],
  )

  if (preflight.rowCount === 0) {
    // Row not found or not owned — return the same variant (SEC-29)
    return { kind: 'not_found_or_unauthorized' }
  }

  const existing = preflight.rows[0]
  if (!existing) throw new Error('[db] SELECT crons preflight returned no row despite rowCount > 0')

  if (existing.status === 'deleted') {
    return { kind: 'already_deleted' }
  }

  const result = await pool.query<Cron>(
    `UPDATE crons
     SET status = 'deleted'
     WHERE id = $1 AND owner_agent_slug = $2
     RETURNING id, project_id, owner_agent_slug, name, description, schedule,
               tool_name, payload, status, last_run_at, created_at, updated_at`,
    [params.id, params.owner_agent_slug],
  )
  const row = result.rows[0]
  if (!row) throw new Error('[db] UPDATE crons (delete) returned no row')
  return { kind: 'success', cron: row }
}

// ---------------------------------------------------------------------------
// Cron Worker query contracts (ARCH-011 G1/G2 — Sprint 6)
//
// These functions are distinct from the registration-layer queries above:
//   - They accept injected pool/client so the cron worker is testable in
//     isolation against a testcontainers Postgres instance.
//   - getDueCrons runs in autocommit — it returns candidates, not a durable lock.
//   - markCronFired accepts a PoolClient already inside a BEGIN transaction.
//     The caller (CronWorker.fire) holds the FOR UPDATE SKIP LOCKED row lock
//     and commits after this call succeeds.
//
// Column name: last_run_at (NOT last_fired_at — Silas correction, 2026-05-21)
// ---------------------------------------------------------------------------

/**
 * The minimal shape returned by getDueCrons. The worker only needs these fields.
 * Keeping it narrow reduces SELECT surface and makes test fixtures smaller.
 */
export interface DueCron {
  id: number
  schedule: string
  tool_name: string
  payload: Record<string, unknown> | null
}

/**
 * getDueCrons — returns active crons whose next_fire_at is in the past.
 *
 * Runs in autocommit. Returns candidates for the poll cycle.
 * Does NOT hold a row lock — the per-cron lock is acquired inside markCronFired.
 *
 * Requires pool parameter (injected) for testability with testcontainers.
 *
 * Migration gate: next_fire_at column must exist (migration 006_cron_next_fire_at.sql).
 */
export async function getDueCrons(injectedPool: typeof pool): Promise<DueCron[]> {
  const result = await injectedPool.query<DueCron>(
    `SELECT id, schedule, tool_name, payload
     FROM crons
     WHERE status = 'active'
       AND next_fire_at <= NOW()`,
  )
  return result.rows
}

/**
 * markCronFired — updates last_run_at and next_fire_at inside a transaction.
 *
 * MUST be called inside an open transaction. The caller holds a
 * FOR UPDATE SKIP LOCKED lock on this row. This function does not BEGIN,
 * COMMIT, or ROLLBACK — that is the caller's responsibility.
 *
 * @param client  - PoolClient with an open transaction (BEGIN already called)
 * @param id      - cron row ID (row is already locked by the caller)
 * @param nextFireAt - pre-computed next tick via cron-parser (UTC)
 */
export async function markCronFired(
  client: PoolClient,
  id: number,
  nextFireAt: Date,
): Promise<void> {
  await client.query(
    `UPDATE crons
     SET last_run_at  = NOW(),
         next_fire_at = $2
     WHERE id = $1`,
    [id, nextFireAt],
  )
}
