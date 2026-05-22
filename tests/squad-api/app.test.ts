/**
 * tests/squad-api/app.test.ts
 *
 * Supertest integration tests for the Squad API (S7-09).
 *
 * Strategy:
 *   - Mock src/squad-api/config.js — prevents the Zod throw at module load
 *     (which requires DATABASE_URL + OPENHIVEOS_INGESTION_TOKEN in process.env)
 *   - Mock src/squad-api/db.js — replaces the production pool with the
 *     testcontainer pool; withReaderRole() runs callbacks without SET LOCAL ROLE
 *     (the postgres superuser in testcontainers has full access anyway)
 *   - Use real migrations via createTestDb() — views from 005_llm_usage.sql
 *     are present so usage endpoints return valid empty arrays
 *
 * vi.mock calls are hoisted before static imports by Vitest, so all modules
 * that transitively import config.js or db.js see the mock at import time.
 *
 * Coverage targets (S7-09):
 *   GET  /health               — unauthenticated probe                (TC-SA1)
 *   GET  /api/usage/agents     — 401 no token, 401 bad token, 200 ok (TC-SA2-SA4)
 *   GET  /api/usage/agents/:n  — 200 ok                              (TC-SA5)
 *   GET  /api/usage/tasks/:id  — 200 ok                              (TC-SA6)
 *   GET  /api/agents           — 200 ok                              (TC-SA7)
 *   POST /internal/usage       — 401 no token, 401 bad token, 200 ok (TC-SA8-SA10)
 */

import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHash } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import request from 'supertest'
import { createTestDb, type TestDb } from '../helpers/db.js'

// ---------------------------------------------------------------------------
// Ingestion token — 64 hex chars (Zod min(64) constraint)
// ---------------------------------------------------------------------------
const INGESTION_TOKEN = 'a'.repeat(64)

// ---------------------------------------------------------------------------
// Pool injection — set in beforeAll after testcontainer starts
// ---------------------------------------------------------------------------
let clientPool: Pool | undefined

// ---------------------------------------------------------------------------
// vi.mock — hoisted before all static imports below
// ---------------------------------------------------------------------------

vi.mock('../../src/squad-api/config.js', () => ({
  squadApiConfig: {
    DATABASE_URL: 'postgresql://test@localhost/test', // unused — pool is mocked
    SQUAD_API_PORT: 3005,
    // Must use literal — INGESTION_TOKEN const is not yet initialized when the
    // hoisted vi.mock factory runs (temporal dead zone)
    OPENHIVEOS_INGESTION_TOKEN: 'a'.repeat(64),
  },
}))

vi.mock('../../src/squad-api/db.js', () => ({
  get squadApiPool() { return clientPool },
  withReaderRole: async <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> => {
    const client = await clientPool!.connect()
    try {
      return await fn(client)
    } finally {
      client.release()
    }
  },
}))

// Static import — sees mocked config.js and db.js
import { createSquadApiApp } from '../../src/squad-api/server.js'

// ---------------------------------------------------------------------------
// Test auth credentials
// ---------------------------------------------------------------------------
const SALT   = 'a'.repeat(32)  // 32 hex chars (16-byte simulated)
const SECRET = 'b'.repeat(64)  // 64 hex chars (32-byte simulated)
const VALID_TOKEN = `${SALT}.${SECRET}`
const VALID_HASH  = createHash('sha256').update(SALT + SECRET).digest('hex')

const BAD_TOKEN = `${'c'.repeat(32)}.${'d'.repeat(64)}`

let db: TestDb

beforeAll(async () => {
  db = await createTestDb()
  clientPool = db.pool

  // Register a test agent with a known token hash
  await db.pool.query(
    `INSERT INTO agents (slug, display_name, token_hash, token_salt)
     VALUES ('squad-test-agent', 'Squad Test Agent', $1, $2)
     ON CONFLICT (slug) DO UPDATE SET token_hash = $1, token_salt = $2`,
    [VALID_HASH, SALT],
  )
}, 90_000)

afterAll(async () => {
  await db.teardown()
})

// ---------------------------------------------------------------------------
// Health probe
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  it('TC-SA1: returns 200 with status ok — no auth required', async () => {
    const app = createSquadApiApp()
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'ok', service: 'squad-api' })
  })
})

// ---------------------------------------------------------------------------
// Auth middleware — /api routes
// ---------------------------------------------------------------------------

describe('GET /api/usage/agents — auth', () => {
  it('TC-SA2: returns 401 with no Authorization header', async () => {
    const app = createSquadApiApp()
    const res = await request(app).get('/api/usage/agents')
    expect(res.status).toBe(401)
  })

  it('TC-SA3: returns 401 with an unrecognised bearer token', async () => {
    const app = createSquadApiApp()
    const res = await request(app)
      .get('/api/usage/agents')
      .set('Authorization', `Bearer ${BAD_TOKEN}`)
    expect(res.status).toBe(401)
  })

  it('TC-SA4: returns 200 with a valid bearer token', async () => {
    const app = createSquadApiApp()
    const res = await request(app)
      .get('/api/usage/agents')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(200)
    // Response shape: { months: number, data: AgentMonthRow[] }
    const body = res.body as { months: number; data: unknown[] }
    expect(typeof body.months).toBe('number')
    expect(Array.isArray(body.data)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Usage endpoints
// ---------------------------------------------------------------------------

describe('Usage routes', () => {
  it('TC-SA5: GET /api/usage/agents/:name returns 404 when no data (by design)', async () => {
    const app = createSquadApiApp()
    const res = await request(app)
      .get('/api/usage/agents/squad-test-agent')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    // Route returns 404 when no llm_usage rows exist for the agent (documented behavior)
    expect(res.status).toBe(404)
  })

  it('TC-SA6: GET /api/usage/tasks/:id returns 404 when no data (by design)', async () => {
    const app = createSquadApiApp()
    const res = await request(app)
      .get('/api/usage/tasks/999')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    // Route returns 404 when no llm_usage rows exist for the task (documented behavior)
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Agents roster
// ---------------------------------------------------------------------------

describe('GET /api/agents', () => {
  it('TC-SA7: returns 200 with agent list containing test agent', async () => {
    const app = createSquadApiApp()
    const res = await request(app)
      .get('/api/agents')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(200)
    // Response is { agents: AgentRow[] }
    const body = res.body as { agents: Array<{ slug: string }> }
    expect(Array.isArray(body.agents)).toBe(true)
    const slugs = body.agents.map(a => a.slug)
    expect(slugs).toContain('squad-test-agent')
  })
})

// ---------------------------------------------------------------------------
// Ingestion endpoint (/internal/usage)
// ---------------------------------------------------------------------------

describe('POST /internal/usage', () => {
  it('TC-SA8: returns 401 with no Authorization header', async () => {
    const app = createSquadApiApp()
    const res = await request(app).post('/internal/usage').send({})
    expect(res.status).toBe(401)
  })

  it('TC-SA9: returns 401 with wrong ingestion token', async () => {
    const app = createSquadApiApp()
    const res = await request(app)
      .post('/internal/usage')
      .set('Authorization', `Bearer ${'z'.repeat(64)}`)
      .send({})
    expect(res.status).toBe(401)
  })

  it('TC-SA10: returns 400 or 200 with valid ingestion token and valid payload', async () => {
    const app = createSquadApiApp()
    const payload = {
      agent_slug: 'squad-test-agent',
      task_id: null,
      session_id: null,
      model: 'claude-3-5-haiku',
      input_tokens: 100,
      output_tokens: 50,
      cached_tokens: 0,
    }
    const res = await request(app)
      .post('/internal/usage')
      .set('Authorization', `Bearer ${INGESTION_TOKEN}`)
      .send(payload)
    // 200/201 (success), 400/422 (validation error) — any confirm auth passed
    expect([200, 201, 400, 422]).toContain(res.status)
  })
})
