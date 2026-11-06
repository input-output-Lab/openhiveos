/**
 * tests/squad-api/budget.test.ts
 *
 * S18-BE-05 (#2560): internal budget view — estimate vs actual hours
 * vs LLM cost per task/project.
 *
 * Layer 1 (pure, no DB): hoursVariancePct math — null-safety, div-by-zero
 * guard, rounding.
 *
 * Layer 2 (DB via supertest + testcontainer, same harness as app.test.ts):
 *   - 401 without auth (budget is behind authMiddleware like all /api)
 *   - 200 envelope shape with seeded task/worklog/usage rows
 *   - actual-hours split (auto vs human) and billable=false exclusion
 *   - project rollup consistency
 *   - project_id/status filters
 *
 * Skips when TEST_DATABASE_URL is absent (hermetic CI, same as app.test.ts).
 */
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHash } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import request from 'supertest'
import { createTestDb, type TestDb } from '../helpers/db.js'
import { hoursVariancePct } from '../../src/squad-api/routes/budget.js'

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1 — variance math
// ─────────────────────────────────────────────────────────────────────────────

describe('hoursVariancePct', () => {
  it('computes positive variance (over estimate)', () => {
    // 480 min = 8h actual vs 6h estimate → +33.33%
    expect(hoursVariancePct('480', '6')).toBe(33.33)
  })

  it('computes negative variance (under estimate)', () => {
    // 120 min = 2h actual vs 4h estimate → -50%
    expect(hoursVariancePct('120', '4')).toBe(-50)
  })

  it('returns 0 when actual equals estimate', () => {
    expect(hoursVariancePct('300', '5')).toBe(0)
  })

  it('returns null when estimate is NULL', () => {
    expect(hoursVariancePct('300', null)).toBeNull()
  })

  it('returns null when estimate is zero (div-by-zero guard)', () => {
    expect(hoursVariancePct('300', '0')).toBeNull()
  })

  it('reports -100% variance when there is an estimate but no worklogs yet', () => {
    // 0h actual vs 5h estimated → -100%: honest signal that nothing is logged
    expect(hoursVariancePct(null, '5')).toBe(-100)
  })

  it('rounds to 2 decimal places', () => {
    // 7 min = 0.1167h vs 3h → (0.1167-3)/3 = -96.11%
    expect(hoursVariancePct('7', '3')).toBe(-96.11)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2 — endpoint integration (needs DB)
// ─────────────────────────────────────────────────────────────────────────────

const INGESTION_TOKEN = 'a'.repeat(64)
const SALT = 'a'.repeat(32)
const SECRET = 'b'.repeat(64)
const VALID_TOKEN = `${SALT}.${SECRET}`
const VALID_HASH = createHash('sha256').update(SALT + SECRET).digest('hex')

let clientPool: Pool | undefined
const hasDb = !!process.env['TEST_DATABASE_URL']

// Mock factories are hoisted above the const declarations — use literals
// inside them (temporal dead zone; same pattern as app.test.ts).
vi.mock(import('../../src/squad-api/config.js'), () => ({
  squadApiConfig: {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test', // allowlisted placeholder
    SQUAD_API_PORT: 3005,
    OPENHIVEOS_INGESTION_TOKEN: 'a'.repeat(64),
  },
}))

vi.mock(import('../../src/squad-api/db.js'), () => ({
  get squadApiPool() {
    return clientPool
  },
  withReaderRole: async <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> => {
    const client = await clientPool!.connect()
    try {
      return await fn(client)
    } finally {
      client.release()
    }
  },
}))

// Static import — sees the mocks above.
import { createSquadApiApp } from '../../src/squad-api/server.js'

describe.skipIf(!hasDb)('GET /api/budget (S18-BE-05)', () => {
  let db: TestDb
  let projectId: number
  let taskId: number

  beforeAll(async () => {
    db = await createTestDb()
    clientPool = db.pool

    await db.pool.query(
      `INSERT INTO agents (slug, display_name, token_hash, token_salt)
       VALUES ('budget-test-agent', 'Budget Test Agent', $1, $2)
       ON CONFLICT (slug) DO UPDATE SET token_hash = $1, token_salt = $2`,
      [VALID_HASH, SALT],
    )

    // Seed project + task. Migration chain in tests/helpers/db.ts guarantees
    // 024/025 columns (estimated_hours, billing_low/high) exist.
    // Seed project owner first (projects.owner_agent_slug FK → agents.slug)
    await db.pool.query(
      `INSERT INTO agents (slug, display_name, token_hash, token_salt)
       VALUES ('elizabeth', 'Elizabeth', $1, $2)
       ON CONFLICT (slug) DO NOTHING`,
      [createHash('sha256').update('x'.repeat(32) + 'y'.repeat(64)).digest('hex'), 'x'.repeat(32)],
    )
    const proj = await db.pool.query(
      `INSERT INTO projects (slug, name, description, owner_agent_slug) VALUES ('budget-proj', 'Budget Project', 's18-be-05 test', 'elizabeth')
       RETURNING id`,
    )
    projectId = proj.rows[0]!.id

    const task = await db.pool.query(
      `INSERT INTO tasks (title, description, project_id, status, estimated_hours, billing_low, billing_high)
       VALUES ('Budget task', 'test', $1, 'done', 6, 5, 8)
       RETURNING id`,
      [projectId],
    )
    taskId = task.rows[0]!.id

    // Actuals: 480 min billable (300 auto + 180 human) + 60 min non-billable (excluded)
    // Constraints (028): auto ⇒ session_id set, actor_type/category NULL;
    //                    human ⇒ session_id NULL, actor_type + category required.
    await db.pool.query(
      `INSERT INTO task_worklogs (task_id, agent_slug, source, minutes, worked_on, session_id)
       VALUES ($1, 'murphy', 'auto', 300, '2026-11-05', 'sess-budget-1')`,
      [taskId],
    )
    await db.pool.query(
      `INSERT INTO task_worklogs (task_id, agent_slug, source, minutes, worked_on, session_id, actor_type, category)
       VALUES ($1, 'elizabeth', 'human', 180, '2026-11-05', NULL, 'human', 'PM')`,
      [taskId],
    )
    await db.pool.query(
      `INSERT INTO task_worklogs (task_id, agent_slug, source, minutes, worked_on, session_id, billable)
       VALUES ($1, 'murphy', 'auto', 60, '2026-11-06', 'sess-budget-2', false)`,
      [taskId],
    )

    // LLM usage for the task (feeds v_cost_by_task). Required: session_id,
    // loop_index, agent_slug, model, provider, cost_usd.
    await db.pool.query(
      `INSERT INTO llm_usage (session_id, loop_index, agent_slug, model, provider, prompt_tokens, completion_tokens, cost_usd, recorded_at, task_id)
       VALUES ('vscode:murphy:budget-test', 0, 'murphy', 'test-model', 'test-provider', 1000, 500, 0.25, now(), $1)`,
      [taskId],
    )
  }, 90_000)

  afterAll(async () => {
    await db.teardown()
  })

  it('returns 401 without credentials (auth gate, like all /api)', async () => {
    const res = await request(createSquadApiApp()).get('/api/budget')
    expect(res.status).toBe(401)
  })

  it('returns 200 with task rows + project rollups', async () => {
    const res = await request(createSquadApiApp())
      .get('/api/budget')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(200)
    expect(res.body.internal_only).toBe(true)
    expect(Array.isArray(res.body.data.tasks)).toBe(true)
    expect(Array.isArray(res.body.data.projects)).toBe(true)

    const row = res.body.data.tasks.find((t: { task_id: number }) => t.task_id === taskId)
    expect(row).toBeDefined()
    expect(row.estimated_hours).toBe(6)
    expect(row.billing_low).toBe(5)
    expect(row.billing_high).toBe(8)
    // 480 billable minutes = 8.00h; non-billable 60min excluded
    expect(row.actual_hours).toBe(8)
    expect(row.actual_hours_split).toEqual({ auto: 5, human: 3 })
    // (8 - 6) / 6 = +33.33%
    expect(row.hours_variance_pct).toBe(33.33)
    expect(row.llm_cost_usd).toBeCloseTo(0.25, 4)
    expect(row.llm_request_count).toBe(1)
  })

  it('project rollup aggregates estimates, actuals and cost', async () => {
    const res = await request(createSquadApiApp())
      .get('/api/budget')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    const proj = res.body.data.projects.find((p: { project_id: number }) => p.project_id === projectId)
    expect(proj).toBeDefined()
    expect(proj.task_count).toBe(1)
    expect(proj.estimated_hours).toBe(6)
    expect(proj.actual_hours).toBe(8)
    expect(proj.llm_cost_usd).toBeCloseTo(0.25, 4)
  })

  it('filters by project_id', async () => {
    const res = await request(createSquadApiApp())
      .get(`/api/budget?project_id=${projectId}`)
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(200)
    expect(res.body.data.tasks.every((t: { project_id: number }) => t.project_id === projectId)).toBe(true)
    expect(res.body.data.projects).toHaveLength(1)
  })

  it('filters by status', async () => {
    const ok = await request(createSquadApiApp())
      .get('/api/budget?status=done')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(ok.status).toBe(200)
    expect(ok.body.data.tasks.some((t: { task_id: number }) => t.task_id === taskId)).toBe(true)

    const empty = await request(createSquadApiApp())
      .get('/api/budget?status=todo')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(empty.status).toBe(200)
    expect(empty.body.data.tasks).toHaveLength(0)
  })

  it('rejects invalid project_id with 400', async () => {
    const res = await request(createSquadApiApp())
      .get('/api/budget?project_id=notanumber')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(400)
  })

  it('includes tasks with no worklogs and no usage (NULL-safe join)', async () => {
    const t = await db.pool.query(
      `INSERT INTO tasks (title, description, project_id, status) VALUES ('No actuals', 'test', $1, 'todo') RETURNING id`,
      [projectId],
    )
    const bareId = t.rows[0]!.id
    const res = await request(createSquadApiApp())
      .get('/api/budget')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    const row = res.body.data.tasks.find((x: { task_id: number }) => x.task_id === bareId)
    expect(row).toBeDefined()
    expect(row.actual_hours).toBe(0)
    expect(row.hours_variance_pct).toBeNull() // no estimate AND no actuals
    expect(row.llm_cost_usd).toBe(0)
  })
})
