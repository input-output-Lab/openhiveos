import type { PoolClient } from 'pg'

// ---------------------------------------------------------------------------
// worklogs.ts — S17-BE-03 (#2557) DB layer for manual time entries.
//
// Writes source='human' rows only. Auto rows are owned by worklog-derive.ts
// (#2552) and are never touched here.
//
// Caller must wrap in withActor(callerSlug, ...) so the audit trigger
// (migration 028) attributes the INSERT to the human/agent who logged it.
// ---------------------------------------------------------------------------

export const WORKLOG_CATEGORIES = ['DA', 'UX', 'FE', 'BE', 'QA', 'DO', 'RI', 'PM'] as const
export type WorklogCategory = (typeof WORKLOG_CATEGORIES)[number]
export type WorklogActorType = 'agent' | 'human'

export interface HumanWorklogInsert {
  task_id: number
  agent_slug: string
  actor_type: WorklogActorType
  minutes: number
  worked_on: string // YYYY-MM-DD
  category: WorklogCategory
  billable: boolean
  note: string | null
}

export interface WorklogRow {
  id: number
  task_id: number
  agent_slug: string
  source: 'auto' | 'human'
  actor_type: WorklogActorType | null
  minutes: string // NUMERIC comes back as string from pg
  worked_on: string
  category: WorklogCategory | null
  billable: boolean
  note: string | null
  created_at: Date
  updated_at: Date
}

/**
 * insertHumanWorklog — append one manual time entry.
 * Caller wraps in withActor(agentSlug, ...). Never called with source='auto'.
 */
export async function insertHumanWorklog(
  tx: PoolClient,
  row: HumanWorklogInsert,
): Promise<WorklogRow> {
  const result = await tx.query<WorklogRow>(
    `INSERT INTO task_worklogs
       (task_id, agent_slug, source, actor_type, minutes, worked_on,
        category, billable, note)
     VALUES ($1, $2, 'human', $3, $4, $5::date, $6, $7, $8)
     RETURNING id, task_id, agent_slug, source, actor_type,
               minutes::text AS minutes,
               TO_CHAR(worked_on, 'YYYY-MM-DD') AS worked_on,
               category, billable, note, created_at, updated_at`,
    [
      row.task_id,
      row.agent_slug,
      row.actor_type,
      row.minutes,
      row.worked_on,
      row.category,
      row.billable,
      row.note,
    ],
  )
  const inserted = result.rows[0]
  if (!inserted) throw new Error('insertHumanWorklog: INSERT returned no row')
  return inserted
}
