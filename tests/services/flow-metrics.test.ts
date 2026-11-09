/**
 * tests/services/flow-metrics.test.ts
 *
 * S18-BE-06 (#2565): flow metrics — cycle time per status, lead time,
 * velocity, burndown, rendered as flow_detail sections.
 *
 * AC: metrics match hand-computed fixtures. Every test seeds task_status_history
 * with DETERMINISTIC timestamps, then asserts against values computed BY HAND
 * in the comments (not by re-running the query logic).
 *
 * Seeds walk UPDATEs (the 024 trigger is AFTER UPDATE only — INSERTs of
 * pre-statused tasks write no history).
 *
 * Skipped without TEST_DATABASE_URL (hermetic CI).
 */
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHash } from 'node:crypto'

let testPool: import('pg').Pool | undefined
vi.mock(import('../../src/db/client.js'), () => ({
  get pool() {
    return testPool!
  },
  withActor: async <T>(slug: string, fn: () => Promise<T>): Promise<T> => fn(),
}))

const { cycleTimePerStatus, leadTime, velocity, burndown } = await import(
  '../../src/db/queries/reports.js'
)

const hasDb = !!process.env['TEST_DATABASE_URL']
describe.skipIf(!hasDb)('flow metrics (S18-BE-06, hand-computed fixtures)', () => {
  let db: import('../helpers/db.js').TestDb
  let projectId: number
  let taskA: number
  let taskB: number

  beforeAll(async () => {
    const { createTestDb } = await import('../helpers/db.js')
    db = await createTestDb()
    testPool = db.pool

    await db.pool.query(
      `INSERT INTO agents (slug, display_name, token_hash, token_salt)
       VALUES ('fm-agent', 'FM Agent', $1, $2) ON CONFLICT (slug) DO NOTHING`,
      [createHash('sha256').update('f'.repeat(32) + 'g'.repeat(64)).digest('hex'), 'f'.repeat(32)],
    )
    const proj = await db.pool.query(
      `INSERT INTO projects (slug, name, owner_agent_slug) VALUES ('fm-proj', 'Flow Metrics Project', 'fm-agent') RETURNING id`,
    )
    projectId = proj.rows[0]!.id

    // ── HAND-COMPUTED FIXTURE ────────────────────────────────────────────
    // taskA: todo t-10d → wip t-8d → review t-5d → done t-2d
    //   spans: todo→wip 48h, wip→review 72h, review→done 72h
    // taskB: todo t-6d → wip t-4d → review t-1d (still open — NOT done)
    //   spans: todo→wip 48h, wip→review 72h
    //
    // Hand-computed (48h window = transitions in last 2 days only... use 30d
    // window so all transitions count):
    //   cycleTimePerStatus (30d):
    //     todo:    (48 + 48) / 2 = 48.0h  (2 samples)
    //     wip:     (72 + 72) / 2 = 72.0h  (2 samples)
    //     review:  taskA 72h only; taskB's review is the LAST transition
    //              (no next_at) → excluded → 72.0h (1 sample)
    //   leadTime (30d): only taskA finished.
    //     taskA lead = 10d = 240h. avg = 240.0h (1 sample)
    const mkTask = async (title: string): Promise<number> => {
      const t = await db!.pool.query(
        `INSERT INTO tasks (title, description, project_id, status, assignee_agent_slug)
         VALUES ($1, 'fixture', $2, 'triage', 'fm-agent') RETURNING id`,
        [title, projectId],
      )
      return t.rows[0]!.id
    }
    taskA = await mkTask('Flow fixture A')
    taskB = await mkTask('Flow fixture B')

    const walk = async (taskId: number, steps: Array<[string, string]>): Promise<void> => {
      for (const [status, interval] of steps) {
        await db!.pool.query(
          `UPDATE tasks SET status = $2, updated_at = now() - $3::interval WHERE id = $1`,
          [taskId, status, interval],
        )
      }
    }
    // Seed by setting updated_at alongside each UPDATE so history rows get
    // deterministic changed_at values from the trigger (trigger copies now(),
    // so we override history timestamps after walking).
    await walk(taskA, [
      ['todo', '10 days'],
      ['wip', '8 days'],
      ['review', '5 days'],
      ['done', '2 days'],
    ])
    await walk(taskB, [
      ['todo', '6 days'],
      ['wip', '4 days'],
      ['review', '1 day'],
    ])

    // Rewrite history timestamps to the fixture values (trigger used now()).
    const setHist = async (taskId: number, status: string, since: string): Promise<void> => {
      await db!.pool.query(
        `UPDATE task_status_history SET changed_at = now() - $2::interval
          WHERE task_id = $1 AND to_status = $3`,
        [taskId, since, status],
      )
    }
    await setHist(taskA, 'todo', '10 days')
    await setHist(taskA, 'wip', '8 days')
    await setHist(taskA, 'review', '5 days')
    await setHist(taskA, 'done', '2 days')
    await setHist(taskB, 'todo', '6 days')
    await setHist(taskB, 'wip', '4 days')
    await setHist(taskB, 'review', '1 day')
  }, 90_000)

  afterAll(async () => {
    if (db) await db.teardown()
  })

  it('cycle time per status matches hand-computed fixture (30d window)', async () => {
    const { rows } = await cycleTimePerStatus(projectId, 30)
    const todo = rows.find((r) => r.to_status === 'todo')
    const wip = rows.find((r) => r.to_status === 'wip')
    const review = rows.find((r) => r.to_status === 'review')
    // Hand-computed: todo 48h/2 samples, wip 72h/2, review 72h/1
    expect(todo).toMatchObject({ avg_hours: 48, samples: 2 })
    expect(wip).toMatchObject({ avg_hours: 72, samples: 2 })
    expect(review).toMatchObject({ avg_hours: 72, samples: 1 })
  })

  it('lead time matches hand-computed fixture (only finished task counts)', async () => {
    const { avg_lead_hours, samples } = await leadTime(projectId, 30)
    // Hand-computed: taskA todo@-10d → done@-2d = 8d = 192h. 1 sample.
    expect(avg_lead_hours).toBe(192)
    expect(samples).toBe(1)
  })

  it('velocity buckets done-count by sprint window', async () => {
    const { rows } = await velocity(projectId, 30, 15)
    // Hand-computed: generate_series over 30d with 15d steps yields 3 bucket
    // endpoints (t-30, t-15, t-0). taskA done 2d ago → last bucket. Total
    // done across buckets = 1.
    expect(rows).toHaveLength(3)
    const total = rows.reduce((sum, r) => sum + r.done_count, 0)
    expect(total).toBe(1)
    const current = rows[rows.length - 1]!
    expect(current.done_count).toBe(1)
  })

  it('burndown open-count declines when the task completes', async () => {
    const { rows } = await burndown(projectId, 30)
    // Hand-computed: A enters todo @-10d, B @-6d. A finishes @-2d.
    //   first row (t-30): 0 open (nothing entered yet — window starts before
    //                     any todo; rows only exist for days with open tasks)
    //   t-10..t-7: 1 open (A)
    //   t-6..t-3:  2 open (A + B)
    //   t-2..now:  1 open (B only)
    expect(rows.length).toBeGreaterThan(0)
    const peak = Math.max(...rows.map((r) => r.remaining))
    const last = rows[rows.length - 1]!.remaining
    expect(peak).toBe(2)
    expect(last).toBe(1)
  })

  it('windows exclude old transitions (7d window keeps only recent spans)', async () => {
    // Hand-computed 7d window (now-7d cutoff): taskA todo@-10d OUT, wip@-8d OUT,
    // review@-5d IN (span review→done = 72h), done@-2d IN. taskB todo@-6d IN
    // (span todo→wip = 48h), wip@-4d IN (span wip→review = 72h), review@-1d IN
    // (no next → excluded). So: todo 48h/1, wip 72h/1, review 72h/1.
    const { rows } = await cycleTimePerStatus(projectId, 7)
    const review = rows.find((r) => r.to_status === 'review')
    const wip = rows.find((r) => r.to_status === 'wip')
    const todo = rows.find((r) => r.to_status === 'todo')
    expect(review).toMatchObject({ avg_hours: 72, samples: 1 })
    expect(wip).toMatchObject({ avg_hours: 72, samples: 1 })
    expect(todo).toMatchObject({ avg_hours: 48, samples: 1 })
  })
})
