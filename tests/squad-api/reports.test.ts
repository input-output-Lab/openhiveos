/**
 * tests/squad-api/reports.test.ts
 *
 * S18-BE-04 (#2566): REST /api/reports endpoints over the report service.
 *
 * AC: supertest coverage + same output as MCP JSON.
 *   - 401 without credentials (auth gate, like all /api)
 *   - 200 envelope = the exact ReportPayload the service produces
 *   - SAME-OUTPUT guarantee: REST body deep-equals handleGenerateReport's
 *     JSON text for the same scope/period (structural: one code path)
 *   - ?period validation (400 on 0 / 91 / garbage)
 *   - 400 on non-numeric project id
 *
 * Harness matches app.test.ts: config + db mocks, testcontainer pool.
 * Skipped without TEST_DATABASE_URL.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHash } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import request from 'supertest'

let clientPool: Pool | undefined

vi.mock(import('../../src/squad-api/config.js'), () => ({
  squadApiConfig: {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
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

vi.mock(import('../../src/db/client.js'), () => ({
  get pool() {
    return clientPool!
  },
  withActor: async <T>(slug: string, fn: () => Promise<T>): Promise<T> => fn(),
}))

// Static imports — see the mocks above.
import { createSquadApiApp } from '../../src/squad-api/server.js'
import { handleGenerateReport } from '../../src/utilities/generate-report.js'

const SALT = 'a'.repeat(32)
const SECRET = 'b'.repeat(64)
const VALID_TOKEN = `${SALT}.${SECRET}`
const VALID_HASH = createHash('sha256').update(SALT + SECRET).digest('hex')

const hasDb = !!process.env['TEST_DATABASE_URL']
describe.skipIf(!hasDb)('GET /api/reports (S18-BE-04)', () => {
  let db: import('../helpers/db.js').TestDb
  let projectId: number

  beforeAll(async () => {
    const { createTestDb } = await import('../helpers/db.js')
    db = await createTestDb()
    clientPool = db.pool

    await db.pool.query(
      `INSERT INTO agents (slug, display_name, token_hash, token_salt)
       VALUES ('rest-agent', 'REST Agent', $1, $2)
       ON CONFLICT (slug) DO NOTHING`,
      [VALID_HASH, SALT],
    )
    const proj = await db.pool.query(
      `INSERT INTO projects (slug, name, owner_agent_slug) VALUES ('rest-proj', 'REST Project', 'rest-agent') RETURNING id`,
    )
    // pg returns bigint as string — coerce for URL building + comparisons.
    projectId = Number(proj.rows[0]!.id)
  }, 90_000)

  afterAll(async () => {
    await db.teardown()
  })

  it('returns 401 without credentials', async () => {
    const res = await request(createSquadApiApp()).get('/api/reports/hive')
    expect(res.status).toBe(401)
  })

  it('GET /api/reports/hive returns the service payload (shape + scope)', async () => {
    const res = await request(createSquadApiApp())
      .get('/api/reports/hive')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(200)
    expect(res.body.scope).toBe('hive')
    expect(res.body.period_days).toBe(14)
    expect(res.body.sections.portfolio).toBeDefined()
    expect(res.body.sections.flow_detail).toBeDefined()
    expect(res.body.sections.portfolio.coverage).toHaveProperty('source')
  })

  it('GET /api/reports/projects/:id returns a project-scoped payload', async () => {
    const res = await request(createSquadApiApp())
      .get(`/api/reports/projects/${projectId}?period=7`)
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(200)
    expect(res.body.scope).toBe('project')
    expect(res.body.project_id).toBe(projectId)
    expect(res.body.period_days).toBe(7)
  })

  it('SAME OUTPUT AS MCP JSON: REST body equals handleGenerateReport JSON (AC)', async () => {
    // generated_at is a wall-clock stamp taken per call — compare everything
    // EXCEPT it (deep-equality on the full payload with the stamp normalized),
    // which still guarantees sections/data/filters are byte-identical.
    const stripStamp = (r: { generated_at: string } & Record<string, unknown>) => {
      const { generated_at: _ignored, ...rest } = r
      return rest
    }

    // Hive
    const rest = await request(createSquadApiApp())
      .get('/api/reports/hive?period=30')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    const mcp = await handleGenerateReport({ scope: 'hive', period: 30, format: 'json' })
    const mcpPayload = JSON.parse(mcp.content[0]!.text as string)
    expect(rest.status).toBe(200)
    expect(stripStamp(rest.body)).toEqual(stripStamp(mcpPayload))

    // Project
    const restP = await request(createSquadApiApp())
      .get(`/api/reports/projects/${projectId}?period=30`)
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    const mcpP = await handleGenerateReport({ scope: 'project', project_id: projectId, period: 30, format: 'json' })
    const mcpPPayload = JSON.parse(mcpP.content[0]!.text as string)
    expect(restP.status).toBe(200)
    expect(stripStamp(restP.body)).toEqual(stripStamp(mcpPPayload))
  })

  it('rejects invalid period values with 400', async () => {
    const app = createSquadApiApp()
    for (const period of ['0', '91', 'abc']) {
      const res = await request(app)
        .get(`/api/reports/hive?period=${period}`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
      expect(res.status).toBe(400)
    }
  })

  it('rejects non-numeric project id with 400', async () => {
    const res = await request(createSquadApiApp())
      .get('/api/reports/projects/notanumber')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(400)
  })
})
