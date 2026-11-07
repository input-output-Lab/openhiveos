/**
 * tests/services/reports.test.ts
 *
 * S18-BE-03 (#2562): report service tests.
 *
 * Layer 1 (pure): markdown renderer against fixture payloads — section
 * headings, coverage labels on every section (AC), empty-section
 * degradation, rework-rate derivation, table shapes.
 *
 * Layer 2 (DB): the query aggregations against a real Postgres
 * (testcontainer): status mix, estimate/actual with variance, agent
 * workload rollup, portfolio summary. Skipped without TEST_DATABASE_URL.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
import { renderMarkdown, type ProjectReport, type ReportSection } from '../../src/services/reports/index.js'

// The reports query modules read via src/db/client.js's pool. Mock it to the
// testcontainer pool (holder pattern — hoisted factory sees the mutable let).
let testPool: import('pg').Pool | undefined
vi.mock(import('../../src/db/client.js'), () => ({
  get pool() {
    return testPool!
  },
  withActor: async <T>(slug: string, fn: () => Promise<T>): Promise<T> => fn(),
}))

// Import AFTER the mock is declared (vitest hoists vi.mock above imports).
const { statusMix, estimateActual, agingBuckets } = await import('../../src/db/queries/reports.js')

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function section<T>(name: string, coverageSource: string, data: T, emptyNote = 'empty'): ReportSection<T> {
  return { name, coverage: { source: coverageSource, window_days: 14, rows: Array.isArray(data) ? data.length : 1 }, data, emptyNote }
}

const FIXTURE_REPORT: ProjectReport = {
  scope: 'project',
  project_id: 70,
  period_days: 14,
  generated_at: '2026-11-06T12:00:00.000Z',
  sections: {
    status_mix: section('Status mix', 'tasks.status', [
      { status: 'done', count: 12 },
      { status: 'review', count: 3 },
      { status: 'todo', count: 9 },
    ]),
    aging: section('Aging (open tasks)', 'tasks.updated_at (open tasks)', [
      { bucket: '<7d', count: 6 },
      { bucket: '14-30d', count: 2 },
    ]),
    flow: section('Flow (velocity, rework, cycle time)', 'task_status_history', {
      done_count: 12,
      rework_events: 3,
      reviews_entered: 15,
      avg_cycle_hours: 41.5,
    }),
    estimate_vs_actual: section('Estimate vs actual hours', 'tasks + task_worklogs (billable)', [
      { task_id: 2559, title: 'PR-merge webhook', assignee: 'murphy', estimated_hours: 4, actual_hours: 3.5, variance_pct: -12.5 },
      { task_id: 2564, title: 'Usage ingestion', assignee: 'murphy', estimated_hours: 8, actual_hours: 9.25, variance_pct: 15.63 },
    ]),
    cost: section('LLM cost', 'llm_usage ⋈ tasks ⋈ projects', [
      { label: 'murphy', cost_usd: 12.5, request_count: 340 },
    ]),
    agent_workload: section('Agent workload', 'tasks + task_status_history + task_worklogs', [
      { agent_slug: 'murphy', open_tasks: 7, done_in_window: 4, logged_hours: 22.4 },
      { agent_slug: 'rocket', open_tasks: 1, done_in_window: 1, logged_hours: 2 },
    ]),
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1 — renderer
// ─────────────────────────────────────────────────────────────────────────────

describe('renderMarkdown (S18-BE-03)', () => {
  const md = renderMarkdown(FIXTURE_REPORT, 'OpenHiveOS')

  it('renders a titled document with generation metadata', () => {
    expect(md).toContain('# Project report — OpenHiveOS')
    expect(md).toContain('window: last 14 days')
  })

  it('renders every section heading', () => {
    for (const s of Object.values(FIXTURE_REPORT.sections)) {
      expect(md).toContain(`## ${s.name}`)
    }
  })

  it('labels data source + coverage on every section (AC)', () => {
    for (const s of Object.values(FIXTURE_REPORT.sections)) {
      expect(md).toContain(`source: \`${s.coverage.source}\``)
      expect(md).toContain('last 14d')
    }
  })

  it('derives rework rate from rework events / reviews entered', () => {
    // 3/15 = 20%
    expect(md).toContain('Rework rate: **20%**')
  })

  it('renders status mix table rows', () => {
    expect(md).toContain('| done | 12 |')
    expect(md).toContain('| review | 3 |')
  })

  it('renders estimate vs actual with variance', () => {
    expect(md).toContain('#2559 PR-merge webhook')
    expect(md).toContain('| 4 | 3.5 | -12.5 |')
    expect(md).toContain('| 8 | 9.25 | 15.63 |')
  })

  it('renders cost with 2dp formatting', () => {
    expect(md).toContain('| murphy | 12.50 | 340 |')
  })

  it('degrades empty sections to their emptyNote', () => {
    const emptyReport: ProjectReport = {
      ...FIXTURE_REPORT,
      sections: {
        ...FIXTURE_REPORT.sections,
        cost: section('LLM cost', 'llm_usage ⋈ tasks ⋈ projects', [], 'No usage records in the window.'),
      },
    }
    const md2 = renderMarkdown(emptyReport, 'X')
    expect(md2).toContain('_No usage records in the window._')
  })

  it('hive report title uses portfolio wording', () => {
    const md3 = renderMarkdown(
      {
        scope: 'hive',
        period_days: 7,
        generated_at: '2026-11-06T12:00:00.000Z',
        sections: {
          portfolio: section('Portfolio', 'projects + tasks', []),
          status_mix: section('Status mix (all projects)', 'tasks.status', []),
          flow: section('Flow (velocity, rework, cycle time)', 'task_status_history', { done_count: 0, rework_events: 0, reviews_entered: 0, avg_cycle_hours: null }),
          agent_workload: section('Agent workload (cross-project)', 'tasks + history + worklogs', []),
          blockers: section('Cross-project blockers (review/rework > 2d)', 'tasks', []),
          cost: section('LLM cost by agent', 'llm_usage', []),
        },
      },
      null,
    )
    expect(md3).toContain('# Hive report — full portfolio')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2 — DB aggregations
// ─────────────────────────────────────────────────────────────────────────────

const hasDb = !!process.env['TEST_DATABASE_URL']
describe.skipIf(!hasDb)('report aggregations (DB)', () => {
  let db: import('../helpers/db.js').TestDb
  let projectId: number
  let taskId: number

  beforeAll(async () => {
    const { createTestDb } = await import('../helpers/db.js')
    db = await createTestDb()
    testPool = db.pool

    await db.pool.query(
      `INSERT INTO agents (slug, display_name, token_hash, token_salt)
       VALUES ('rep-agent', 'Report Agent', $1, $2)
       ON CONFLICT (slug) DO NOTHING`,
      [require('node:crypto').createHash('sha256').update('r'.repeat(32) + 's'.repeat(64)).digest('hex'), 'r'.repeat(32)],
    )
    await db.pool.query(
      `INSERT INTO agents (slug, display_name, token_hash, token_salt)
       VALUES ('elizabeth', 'Elizabeth', $1, $2)
       ON CONFLICT (slug) DO NOTHING`,
      [require('node:crypto').createHash('sha256').update('t'.repeat(32) + 'u'.repeat(64)).digest('hex'), 't'.repeat(32)],
    )
    const proj = await db.pool.query(
      `INSERT INTO projects (slug, name, description, owner_agent_slug, status)
       VALUES ('rep-proj', 'Report Project', 'test', 'elizabeth', 'active') RETURNING id`,
    )
    projectId = proj.rows[0]!.id
    // INSERT as todo first — the 024 lifecycle trigger is AFTER UPDATE only,
    // so status history rows come from UPDATEs, not the initial INSERT.
    const task = await db.pool.query(
      `INSERT INTO tasks (title, description, project_id, status, estimated_hours, assignee_agent_slug)
       VALUES ('Report task', 'x', $1, 'todo', 4, 'rep-agent') RETURNING id`,
      [projectId],
    )
    taskId = task.rows[0]!.id
    // Walk the status transitions through UPDATEs (trigger writes history).
    await db.pool.query(
      `UPDATE tasks SET status = 'wip', updated_at = now() - interval '2 days' WHERE id = $1`,
      [taskId],
    )
    await db.pool.query(
      `UPDATE tasks SET status = 'review', updated_at = now() - interval '1 day' WHERE id = $1`,
      [taskId],
    )
    await db.pool.query(`UPDATE tasks SET status = 'done' WHERE id = $1`, [taskId])
    // Worklog: 240 billable minutes
    await db.pool.query(
      `INSERT INTO task_worklogs (task_id, agent_slug, source, minutes, worked_on, session_id)
       VALUES ($1, 'rep-agent', 'auto', 240, '2026-11-05', 'sess-rep-1')`,
      [taskId],
    )
  }, 90_000)

  afterAll(async () => {
    if (db) await db.teardown()
  })

  it('statusMix counts by status', async () => {
    const { rows, cov } = await statusMix(projectId)
    expect(rows.some((r) => r.status === 'done' && r.count === 1)).toBe(true)
    expect(cov.source).toBe('tasks.status')
  })

  it('estimateActual computes variance from billable worklogs', async () => {
    const { rows } = await estimateActual(projectId)
    const row = rows.find((r) => r.task_id === taskId)
    expect(row).toBeDefined()
    expect(row!.estimated_hours).toBe(4)
    expect(row!.actual_hours).toBe(4)
    expect(row!.variance_pct).toBe(0)
  })

  it('agingBuckets bucketizes open tasks only', async () => {
    const { rows } = await agingBuckets(projectId)
    // The only task is done → no open tasks
    expect(rows).toHaveLength(0)
  })

  it('estimateActual excludes todo tasks from the estimate table', async () => {
    await db.pool.query(
      `INSERT INTO tasks (title, description, project_id, status, estimated_hours)
       VALUES ('Still todo', 'x', $1, 'todo', 2)`,
      [projectId],
    )
    const { rows } = await estimateActual(projectId)
    expect(rows.some((r) => r.title === 'Still todo')).toBe(false)
  })
})
