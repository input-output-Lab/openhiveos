/**
 * src/services/integrations-triage.ts
 *
 * Triage inbox query for external integration tasks.
 * Returns all tasks with status='triage' awaiting agent promotion (ARCH-024).
 * Used by GET /api/integrations/triage endpoint.
 *
 * Triage workflow:
 *   1. ClickUp webhook receives external event → stores in inbound_events
 *   2. Inbound processor creates task with status='triage' (not yet active)
 *   3. Operator reviews via dashboard triage inbox (this endpoint)
 *   4. Operator promotes task to backlog (status='todo' or other)
 *   5. Task becomes active and visible in normal workflows
 */

import { PoolClient } from 'pg'

/**
 * External link information for a task in triage.
 */
export interface TriageTaskExternalLink {
  provider: string
  external_id: string
  external_url?: string | null
  sync_state: 'in_sync' | 'drift' | 'error'
  last_synced_at?: string | null
}

/**
 * Task summary in triage inbox.
 */
export interface TriageTask {
  id: string // bigint as string
  title: string
  description: string | null
  external_links: TriageTaskExternalLink[]
  created_at: string // ISO 8601
}

/**
 * Triage inbox response.
 */
export interface TriageInboxResponse {
  count: number
  tasks: TriageTask[]
}

/**
 * Query result type for triage tasks.
 */
interface TriageTaskRow {
  id: string
  title: string
  description: string | null
  created_at: string
  external_links: TriageTaskExternalLink[]
}

/**
 * Fetch all tasks in triage status with their external links.
 *
 * Query joins tasks → external_task_links to show provider context.
 * Ordered by created_at DESC (newest first).
 * No pagination (intended for operator review, low volume expected).
 *
 * @param client PostgreSQL client (read-only role)
 * @returns {Promise<TriageInboxResponse>} Triage inbox with count and task list
 */
export async function getTriageInbox(client: PoolClient): Promise<TriageInboxResponse> {
  // ======================================================================
  // Main query: Tasks in triage with external links
  // ======================================================================
  // Aggregates external_task_links for each task into a JSON array.
  // If a task has no external links (shouldn't happen in practice for triage tasks,
  // but included for completeness), external_links is an empty array.
  const query = `
    SELECT
      t.id::text,
      t.title,
      t.description,
      t.created_at::timestamptz AT TIME ZONE 'UTC' AS created_at,
      COALESCE(
        json_agg(
          json_build_object(
            'provider', etl.provider,
            'external_id', etl.external_id,
            'external_url', etl.external_url,
            'sync_state', etl.sync_state,
            'last_synced_at', etl.last_synced_at::text
          ) ORDER BY etl.created_at ASC
        ) FILTER (WHERE etl.id IS NOT NULL),
        '[]'::json
      ) AS external_links
    FROM tasks t
    LEFT JOIN external_task_links etl ON t.id = etl.task_id
    WHERE t.status = 'triage'
    GROUP BY t.id, t.title, t.description, t.created_at
    ORDER BY t.created_at DESC
  `

  const result = await client.query<TriageTaskRow>(query)

  // ======================================================================
  // Transform rows into TriageTask type
  // ======================================================================
  const tasks: TriageTask[] = result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    external_links: row.external_links,
    created_at: row.created_at,
  }))

  return {
    count: tasks.length,
    tasks,
  }
}
