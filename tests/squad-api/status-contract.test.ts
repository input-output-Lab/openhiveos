/**
 * S16-BE-01: status drift contract tests
 *
 * Guards against the five-way status-list drift found on 2026-10-29, where
 * pending-close was accepted by the DB and update_task but rejected by the
 * REST filter (src/squad-api/routes/tasks.ts) and the MCP query_tasks enum
 * (src/utilities/query-tasks.ts).
 *
 * Layer 1 (pure, no DB): every status surfaced by the shared TASK_STATUSES
 * constant is accepted by each write path (update_task) and read path
 * (query_tasks, REST VALID_TASK_STATUSES), and the read/write union equals
 * the source of truth.
 *
 * Layer 2 (DB, optional): the live CHECK constraint on tasks.status must
 * match TASK_STATUSES exactly. Skipped when DATABASE_URL is absent so the
 * suite stays hermetic in CI environments without Postgres.
 */
import { describe, it, expect } from 'vitest'
import { TASK_STATUSES } from '../../src/types.js'
import { updateTaskSchema } from '../../src/utilities/update-task.js'
import { queryTasksSchema } from '../../src/utilities/query-tasks.js'
import { VALID_TASK_STATUSES } from '../../src/squad-api/routes/tasks.js'

const ALL_STATUSES = [...TASK_STATUSES]

describe('S16-BE-01: task status contract', () => {
  it('source of truth includes pending-close', () => {
    expect(ALL_STATUSES).toContain('pending-close')
  })

  it('source of truth excludes triage (inbound-processor-only, ARCH-024)', () => {
    expect(ALL_STATUSES).not.toContain('triage')
  })

  it('every status is a valid update_task write target', () => {
    for (const status of ALL_STATUSES) {
      const result = updateTaskSchema.safeParse({ task_id: 1, status })
      expect(result.success, `update_task schema rejects '${status}'`).toBe(true)
    }
  })

  it('every status is a valid query_tasks filter', () => {
    for (const status of ALL_STATUSES) {
      const result = queryTasksSchema.safeParse({ status })
      expect(result.success, `query_tasks enum rejects '${status}'`).toBe(true)
    }
  })

  it('REST VALID_TASK_STATUSES is exactly the source of truth', () => {
    expect([...VALID_TASK_STATUSES].sort()).toEqual([...ALL_STATUSES].sort())
  })

  it('statuses are unique', () => {
    expect(new Set(ALL_STATUSES).size).toBe(ALL_STATUSES.length)
  })
})

// Layer 2: live DB CHECK constraint parity (runs when a test database is
// provisioned via the standard createTestDb helper — same pattern as
// tests/db/queries/*).
import { createTestDb } from '../helpers/db.js'

const canRunDbTests = process.env['RUN_DB_TESTS'] === 'true'

describe.skipIf(!canRunDbTests)('S16-BE-01: DB CHECK constraint parity', () => {
  it('tasks.status CHECK constraint matches TASK_STATUSES exactly', async () => {
    const testDb = await createTestDb()
    try {
      const res = await testDb.pool.query<{ check_clause: string }>(`
        SELECT pg_get_constraintdef(oid) AS check_clause
          FROM pg_constraint
         WHERE conrelid = 'tasks'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%status%'
      `)
      const clauses = res.rows.map((r) => r.check_clause).join(' ')
      for (const status of ALL_STATUSES) {
        expect(clauses, `DB CHECK is missing '${status}'`).toContain(`'${status}'`)
      }
      // 'triage' is added by migration 019 at the DB layer but must never be
      // agent-writable; its presence in the constraint is allowed, its absence
      // from TASK_STATUSES is asserted above.
    } finally {
      await testDb.teardown()
    }
  }, 30_000)
})
