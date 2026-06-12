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
 * Coverage targets (S7-09, S10-BE-01-04):
 *   GET  /health               — unauthenticated probe                (TC-SA1)
 *   GET  /api/usage/agents     — 401 no token, 401 bad token, 200 ok (TC-SA2-SA4)
 *   GET  /api/usage/agents/:n  — 200 ok                              (TC-SA5)
 *   GET  /api/usage/tasks/:id  — 200 ok                              (TC-SA6)
 *   GET  /api/agents           — 200 ok                              (TC-SA7)
 *   POST /internal/usage       — 401 no token, 401 bad token, 200 ok (TC-SA8-SA10)
 *   GET  /api/agents/:slug     — 200 ok, 404 not found               (TC-SA11-SA12)
 *   GET  /api/sops             — 200 ok, filters, pagination          (TC-SA13-SA16)
 *   GET  /api/tasks            — shape, filters, pagination           (TC-SA17-SA20)
 *   GET  /api/thoughts         — shape, filters, pagination           (TC-SA21-SA24)
 *   GET  /api/projects         — shape, status filter, pagination     (TC-SA25-SA27)
 *   GET  /api/projects/:slug   — detail, 404                         (TC-SA28-SA29)
 *   GET  /api/projects/:s/sprints — empty list, 404                  (TC-SA30)
 *   GET  /api/tasks/:id        — detail, 400, 404                    (TC-SA31)
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
  it('TC-SA1: returns 200 with status ok and full health shape — no auth required', async () => {
    const app = createSquadApiApp()
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      status: 'ok',
      service: 'squad-api',
      db: 'connected',
      schema: 'ok',
    })
    // missing_tables must not be present when schema is ok
    expect(res.body.missing_tables).toBeUndefined()
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

  it('TC-SA7b: returns active_task_count (integer, not null) for each agent', async () => {
    const app = createSquadApiApp()
    const res = await request(app)
      .get('/api/agents')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(200)
    const body = res.body as { agents: Array<{ slug: string; active_task_count: number }> }
    const testAgent = body.agents.find(a => a.slug === 'squad-test-agent')
    expect(testAgent).toBeDefined()
    // SEC-C6: active_task_count must be an integer, never null
    expect(typeof testAgent!.active_task_count).toBe('number')
    expect(Number.isInteger(testAgent!.active_task_count)).toBe(true)
    expect(testAgent!.active_task_count).toBe(0) // no tasks in test DB
  })
})

// ---------------------------------------------------------------------------
// Agent detail — GET /api/agents/:slug
// ---------------------------------------------------------------------------

describe('GET /api/agents/:slug', () => {
  it('TC-SA11: returns 200 with agent row and manifest null for unknown manifest slug', async () => {
    const app = createSquadApiApp()
    const res = await request(app)
      .get('/api/agents/squad-test-agent')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(200)
    const body = res.body as {
      agent: { slug: string; active_task_count: number; manifest: unknown }
    }
    expect(body.agent.slug).toBe('squad-test-agent')
    // SEC-C6: active_task_count is integer, never null
    expect(typeof body.agent.active_task_count).toBe('number')
    expect(body.agent.active_task_count).toBe(0)
    // squad-test-agent is not in squad.manifest.json — manifest must be null
    expect(body.agent.manifest).toBeNull()
  })

  it('TC-SA11b: manifest agent returns role + skills + owns + works_with (OQ-2 / ARCH-020)', async () => {
    // Seed murphy into the test DB — slug is present in squad.manifest.json
    await db.pool.query(
      `INSERT INTO agents (slug, display_name, token_hash, token_salt)
       VALUES ('murphy', 'Murphy', $1, $2)
       ON CONFLICT (slug) DO NOTHING`,
      [createHash('sha256').update('manifest-test-salt' + 'a'.repeat(64)).digest('hex'), 'manifest-test-salt'],
    )

    const app = createSquadApiApp()
    const res = await request(app)
      .get('/api/agents/murphy')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(200)

    const manifest = res.body.agent.manifest as {
      role: string
      skills: string[]
      owns: string[]
      works_with: string[]
    }
    expect(manifest).not.toBeNull()
    expect(typeof manifest.role).toBe('string')
    expect(manifest.role).toBe('Senior Backend Developer')
    // OQ-2: skills, owns, works_with must be string arrays
    expect(Array.isArray(manifest.skills)).toBe(true)
    expect(manifest.skills.length).toBeGreaterThan(0)
    expect(manifest.skills).toContain('api-design')
    expect(Array.isArray(manifest.owns)).toBe(true)
    expect(manifest.owns.length).toBeGreaterThan(0)
    expect(manifest.owns).toContain('feature-delivery')
    expect(Array.isArray(manifest.works_with)).toBe(true)
    expect(manifest.works_with.length).toBeGreaterThan(0)
    expect(manifest.works_with).toContain('silas')
  })

  it('TC-SA12: returns 404 for a slug not in the agents table', async () => {
    const app = createSquadApiApp()
    const res = await request(app)
      .get('/api/agents/nonexistent-agent-xyz')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ error: 'Agent not found' })
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

// ---------------------------------------------------------------------------
// GET /api/sops
// ---------------------------------------------------------------------------

describe('GET /api/sops', () => {
  it('TC-SA13: returns 200 with sops array and pagination envelope', async () => {
    const app = createSquadApiApp()
    const res = await request(app)
      .get('/api/sops')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.sops)).toBe(true)
    expect(res.body.pagination).toBeDefined()
    expect(typeof res.body.pagination.limit).toBe('number')
    expect(typeof res.body.pagination.offset).toBe('number')
    expect(typeof res.body.pagination.has_more).toBe('boolean')
  })

  it('TC-SA14: each sop row has display_name, preview, no instruction, no embedding', async () => {
    // Seed one SOP row
    await db.pool.query(
      `INSERT INTO sops (category, agent, instruction, source_path)
       VALUES ('Coding', 'squad-test-agent', 'This is the full instruction text that is longer than the preview limit.', '/sops/test-sop.md')
       ON CONFLICT (source_path) WHERE source_path IS NOT NULL DO NOTHING`,
    )

    const app = createSquadApiApp()
    const res = await request(app)
      .get('/api/sops')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(200)

    if (res.body.sops.length > 0) {
      const sop = res.body.sops[0] as Record<string, unknown>
      expect(typeof sop['display_name']).toBe('string')
      expect(typeof sop['preview']).toBe('string')
      expect(sop['instruction']).toBeUndefined()
      expect(sop['embedding']).toBeUndefined()
      // preview must not exceed 200 chars
      expect((sop['preview'] as string).length).toBeLessThanOrEqual(200)
    }
  })

  it('TC-SA15: category filter — valid category returns 200, invalid returns 400', async () => {
    const app = createSquadApiApp()

    const goodRes = await request(app)
      .get('/api/sops?category=Coding')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(goodRes.status).toBe(200)

    const badRes = await request(app)
      .get('/api/sops?category=InvalidCategory')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(badRes.status).toBe(400)
    expect(badRes.body.error).toMatch(/Invalid category/)
  })

  it('TC-SA16: pagination — limit and offset are validated (400 on out-of-range)', async () => {
    const app = createSquadApiApp()

    const badLimit = await request(app)
      .get('/api/sops?limit=200')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(badLimit.status).toBe(400)

    const badOffset = await request(app)
      .get('/api/sops?offset=-1')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(badOffset.status).toBe(400)

    const goodRes = await request(app)
      .get('/api/sops?limit=10&offset=0')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(goodRes.status).toBe(200)
    expect(goodRes.body.pagination.limit).toBe(10)
    expect(goodRes.body.pagination.offset).toBe(0)
  })
})

// =============================================================================
// GET /api/tasks (S9-BE-01)
// =============================================================================
describe('GET /api/tasks', () => {
  it('TC-SA17: returns 200 with tasks array and pagination envelope', async () => {
    const app = createSquadApiApp()
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.tasks)).toBe(true)
    expect(res.body.pagination).toBeDefined()
    expect(typeof res.body.pagination.limit).toBe('number')
    expect(typeof res.body.pagination.offset).toBe('number')
    expect(typeof res.body.pagination.has_more).toBe('boolean')
  })

  it('TC-SA18: each task row has expected shape — project_slug present, no forbidden columns', async () => {
    // Seed: project owned by squad-test-agent, then one task in that project
    const projectRes = await db.pool.query<{ id: number }>(
      `INSERT INTO projects (slug, name, owner_agent_slug)
       VALUES ('squad-test-project', 'Squad Test Project', 'squad-test-agent')
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
    )
    // If DO NOTHING fired, fetch the id
    const projectId: number = projectRes.rows[0]?.id
      ?? (await db.pool.query<{ id: number }>(
            `SELECT id FROM projects WHERE slug = 'squad-test-project'`,
          )).rows[0]!.id

    await db.pool.query(
      `INSERT INTO tasks (project_id, title, status, assignee_agent_slug)
       VALUES ($1, 'Test task for TC-SA18', 'todo', 'squad-test-agent')`,
      [projectId],
    )

    const app = createSquadApiApp()
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(200)

    const tasks: unknown[] = res.body.tasks
    expect(tasks.length).toBeGreaterThan(0)

    const task = tasks[0] as Record<string, unknown>
    expect(typeof task['id']).toBe('number')
    expect(typeof task['project_id']).toBe('number')
    // project_slug must be present (string or null — not undefined)
    expect('project_slug' in task).toBe(true)
    expect(typeof task['title']).toBe('string')
    expect(typeof task['status']).toBe('string')
    // These fields must exist but may be null
    expect('assignee_agent_slug' in task).toBe(true)
    expect('github_pr_url' in task).toBe(true)
    expect('notes' in task).toBe(true)
    expect('description' in task).toBe(true)
    expect('created_at' in task).toBe(true)
    expect('updated_at' in task).toBe(true)
    // project_slug should equal the slug we seeded
    const seededTask = tasks.find((t) => (t as Record<string, unknown>)['assignee_agent_slug'] === 'squad-test-agent')
    expect(seededTask).toBeDefined()
    expect((seededTask as Record<string, unknown>)['project_slug']).toBe('squad-test-project')
  })

  it('TC-SA19: status filter — valid status returns 200, invalid returns 400 with error', async () => {
    const app = createSquadApiApp()

    const goodRes = await request(app)
      .get('/api/tasks?status=todo')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(goodRes.status).toBe(200)
    // All returned tasks must match the filtered status
    const tasks: unknown[] = goodRes.body.tasks
    for (const t of tasks) {
      expect((t as Record<string, unknown>)['status']).toBe('todo')
    }

    const badRes = await request(app)
      .get('/api/tasks?status=invalid-status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(badRes.status).toBe(400)
    expect(badRes.body.error).toMatch(/Invalid status/)
  })

  it('TC-SA20: pagination — limit and offset validated; invalid project_id rejected', async () => {
    const app = createSquadApiApp()

    const badLimit = await request(app)
      .get('/api/tasks?limit=0')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(badLimit.status).toBe(400)

    const badOffset = await request(app)
      .get('/api/tasks?offset=-5')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(badOffset.status).toBe(400)

    const badProjectId = await request(app)
      .get('/api/tasks?project_id=0')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(badProjectId.status).toBe(400)

    const goodRes = await request(app)
      .get('/api/tasks?limit=10&offset=0')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(goodRes.status).toBe(200)
    expect(goodRes.body.pagination.limit).toBe(10)
    expect(goodRes.body.pagination.offset).toBe(0)
  })
})

// =============================================================================
// GET /api/thoughts (S9-BE-04)
// =============================================================================
describe('GET /api/thoughts', () => {
  it('TC-SA21: returns 200 with thoughts array and pagination envelope', async () => {
    const app = createSquadApiApp()
    const res = await request(app)
      .get('/api/thoughts')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.thoughts)).toBe(true)
    expect(res.body.pagination).toBeDefined()
    expect(typeof res.body.pagination.limit).toBe('number')
    expect(typeof res.body.pagination.offset).toBe('number')
    expect(typeof res.body.pagination.has_more).toBe('boolean')
  })

  it('TC-SA22: each thought row has expected shape — sensitive columns excluded', async () => {
    // Seed one thought for squad-test-agent
    await db.pool.query(
      `INSERT INTO thoughts (agent_slug, thought, thought_type, must_surface)
       VALUES ('squad-test-agent', 'Test thought content for TC-SA22.', 'analysis', false)`,
    )

    const app = createSquadApiApp()
    const res = await request(app)
      .get('/api/thoughts?agent_slug=squad-test-agent')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(200)

    const thoughts: unknown[] = res.body.thoughts
    expect(thoughts.length).toBeGreaterThan(0)

    const thought = thoughts[0] as Record<string, unknown>
    // Required fields present
    expect(typeof thought['id']).toBe('number')
    expect(typeof thought['agent_slug']).toBe('string')
    expect(typeof thought['thought']).toBe('string')
    expect(typeof thought['thought_type']).toBe('string')
    expect(typeof thought['must_surface']).toBe('boolean')
    expect(typeof thought['auto_persist_candidate']).toBe('boolean')
    expect(typeof thought['auto_persisted']).toBe('boolean')
    expect('session_id' in thought).toBe(true)
    expect('task_id' in thought).toBe(true)
    expect('confidence' in thought).toBe(true)
    expect('ratified_by' in thought).toBe(true)
    expect('ratified_at' in thought).toBe(true)
    expect('counter_thought' in thought).toBe(true)
    expect('metadata' in thought).toBe(true)
    expect('created_at' in thought).toBe(true)

    // SEC-B1, SEC-B3: these columns must NEVER appear in the response
    expect('embedding' in thought).toBe(false)
    expect('raw_behavior' in thought).toBe(false)
    expect('expressed_behavior' in thought).toBe(false)
    expect('disposition_snapshot' in thought).toBe(false)
  })

  it('TC-SA23: thought_type filter — valid type returns 200, invalid returns 400', async () => {
    const app = createSquadApiApp()

    const goodRes = await request(app)
      .get('/api/thoughts?thought_type=analysis')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(goodRes.status).toBe(200)
    const thoughts: unknown[] = goodRes.body.thoughts
    for (const t of thoughts) {
      expect((t as Record<string, unknown>)['thought_type']).toBe('analysis')
    }

    const badRes = await request(app)
      .get('/api/thoughts?thought_type=invalid-type')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(badRes.status).toBe(400)
    expect(badRes.body.error).toMatch(/Invalid thought_type/)
  })

  it('TC-SA24: must_surface and pagination validated; invalid values return 400', async () => {
    const app = createSquadApiApp()

    const badMustSurface = await request(app)
      .get('/api/thoughts?must_surface=yes')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(badMustSurface.status).toBe(400)

    const badLimit = await request(app)
      .get('/api/thoughts?limit=101')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(badLimit.status).toBe(400)

    const goodSurface = await request(app)
      .get('/api/thoughts?must_surface=true&limit=5&offset=0')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(goodSurface.status).toBe(200)
    expect(goodSurface.body.pagination.limit).toBe(5)
    const surfacedThoughts: unknown[] = goodSurface.body.thoughts
    for (const t of surfacedThoughts) {
      expect((t as Record<string, unknown>)['must_surface']).toBe(true)
    }
  })
})

// =============================================================================
// GET /api/projects (S10-BE-01)
// =============================================================================
describe('GET /api/projects', () => {
  it('TC-SA25: returns 200 with data array and meta envelope', async () => {
    const app = createSquadApiApp()
    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(200)
    // Response shape: { data: ProjectRow[], meta: { limit, offset, has_more } }
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.meta).toBeDefined()
    expect(typeof res.body.meta.limit).toBe('number')
    expect(typeof res.body.meta.offset).toBe('number')
    expect(typeof res.body.meta.has_more).toBe('boolean')
  })

  it('TC-SA26: each project row has expected shape — no detail-only columns', async () => {
    // Ensure test project exists (active)
    const projectRes = await db.pool.query<{ id: number }>(
      `INSERT INTO projects (slug, name, owner_agent_slug, status)
       VALUES ('squad-test-project', 'Squad Test Project', 'squad-test-agent', 'active')
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
    )
    const _id: number = projectRes.rows[0]?.id
      ?? (await db.pool.query<{ id: number }>(
            `SELECT id FROM projects WHERE slug = 'squad-test-project'`,
          )).rows[0]!.id
    void _id

    const app = createSquadApiApp()
    const res = await request(app)
      .get('/api/projects?status=active')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(200)

    const projects: unknown[] = res.body.data
    expect(projects.length).toBeGreaterThan(0)

    const project = projects[0] as Record<string, unknown>
    expect(typeof project['id']).toBe('number')
    expect(typeof project['slug']).toBe('string')
    expect(typeof project['name']).toBe('string')
    expect(typeof project['status']).toBe('string')
    expect('description' in project).toBe(true)
    expect('owner_agent_slug' in project).toBe(true)
    expect('created_at' in project).toBe(true)
    expect('updated_at' in project).toBe(true)
    // open_task_count and current_sprint belong to the detail route only
    expect('open_task_count' in project).toBe(false)
    expect('current_sprint' in project).toBe(false)
  })

  it('TC-SA27: status filter validated; pagination bounds enforced', async () => {
    const app = createSquadApiApp()

    const activeRes = await request(app)
      .get('/api/projects?status=active')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(activeRes.status).toBe(200)

    const archivedRes = await request(app)
      .get('/api/projects?status=archived')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(archivedRes.status).toBe(200)

    const badStatus = await request(app)
      .get('/api/projects?status=deleted')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(badStatus.status).toBe(400)
    expect(badStatus.body.error).toMatch(/Invalid status/)

    const badLimit = await request(app)
      .get('/api/projects?limit=0')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(badLimit.status).toBe(400)

    const badOffset = await request(app)
      .get('/api/projects?offset=-1')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(badOffset.status).toBe(400)
  })
})

// =============================================================================
// GET /api/projects/:slug (S10-BE-02)
// =============================================================================
describe('GET /api/projects/:slug', () => {
  it('TC-SA28: returns 200 with project detail — open_task_count integer, current_sprint shape', async () => {
    // Ensure the test project exists
    const projectRes = await db.pool.query<{ id: number }>(
      `INSERT INTO projects (slug, name, owner_agent_slug, status)
       VALUES ('squad-test-project', 'Squad Test Project', 'squad-test-agent', 'active')
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
    )
    const projectId: number = projectRes.rows[0]?.id
      ?? (await db.pool.query<{ id: number }>(
            `SELECT id FROM projects WHERE slug = 'squad-test-project'`,
          )).rows[0]!.id

    // Seed a sprint so current_sprint is non-null
    await db.pool.query(
      `INSERT INTO sprints (project_id, sprint_number, sprint_goal)
       VALUES ($1, 1, 'Test sprint goal')
       ON CONFLICT (project_id, sprint_number) DO NOTHING`,
      [projectId],
    )

    const app = createSquadApiApp()
    const res = await request(app)
      .get('/api/projects/squad-test-project')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(200)

    const body = res.body as { project: Record<string, unknown> }
    expect(body.project).toBeDefined()

    const p = body.project
    expect(typeof p['id']).toBe('number')
    expect(p['slug']).toBe('squad-test-project')
    expect(typeof p['name']).toBe('string')
    // open_task_count: integer, never null (SEC-C6)
    expect(typeof p['open_task_count']).toBe('number')
    expect(Number.isInteger(p['open_task_count'])).toBe(true)
    // current_sprint: non-null because we seeded sprint 1
    expect(p['current_sprint']).not.toBeNull()
    const sprint = p['current_sprint'] as Record<string, unknown>
    expect(typeof sprint['sprint_number']).toBe('number')
    expect('sprint_goal' in sprint).toBe(true)
    expect('started_at' in sprint).toBe(true)
  })

  it('TC-SA29: returns 404 for a slug that does not exist', async () => {
    const app = createSquadApiApp()
    const res = await request(app)
      .get('/api/projects/nonexistent-project-xyz-99')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ error: 'Project not found' })
  })
})

// =============================================================================
// GET /api/projects/:slug/sprints (S10-BE-03)
// =============================================================================
describe('GET /api/projects/:slug/sprints', () => {
  it('TC-SA30: returns 200 with sprint list and meta; 404 for unknown slug', async () => {
    const app = createSquadApiApp()

    // squad-test-project has at least sprint 1 from TC-SA28
    const res = await request(app)
      .get('/api/projects/squad-test-project/sprints')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.meta).toBeDefined()
    expect(typeof res.body.meta.limit).toBe('number')
    expect(typeof res.body.meta.has_more).toBe('boolean')

    if (res.body.data.length > 0) {
      const sprint = res.body.data[0] as Record<string, unknown>
      expect(typeof sprint['sprint_number']).toBe('number')
      expect('sprint_goal' in sprint).toBe(true)
      expect('started_at' in sprint).toBe(true)
    }

    // Unknown slug → 404
    const notFound = await request(app)
      .get('/api/projects/no-such-project-abc/sprints')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(notFound.status).toBe(404)
    expect(notFound.body).toMatchObject({ error: 'Project not found' })
  })
})

// =============================================================================
// GET /api/tasks/:id (S10-BE-04)
// =============================================================================
describe('GET /api/tasks/:id', () => {
  it('TC-SA31: returns task detail on valid id; 404 on missing id; 400 on non-integer id', async () => {
    // Fetch the task seeded in TC-SA18
    const taskRes = await db.pool.query<{ id: string }>(
      `SELECT t.id FROM tasks t
         JOIN projects p ON p.id = t.project_id
        WHERE p.slug = 'squad-test-project'
          AND t.assignee_agent_slug = 'squad-test-agent'
        LIMIT 1`,
    )
    // pg returns BIGINT as a string; parse to number to match the route's parseInt output
    const seededId: number | undefined = taskRes.rows[0]?.id !== undefined
      ? parseInt(taskRes.rows[0].id, 10)
      : undefined

    const app = createSquadApiApp()

    if (seededId !== undefined) {
      const res = await request(app)
        .get(`/api/tasks/${String(seededId)}`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
      expect(res.status).toBe(200)

      const body = res.body as { task: Record<string, unknown> }
      expect(body.task).toBeDefined()

      const t = body.task
      expect(t['id']).toBe(seededId)
      expect(typeof t['project_id']).toBe('number')
      expect('project_slug' in t).toBe(true)
      expect(typeof t['title']).toBe('string')
      expect('description' in t).toBe(true)
      expect(typeof t['status']).toBe('string')
      expect('assignee_agent_slug' in t).toBe(true)
      expect('github_pr_url' in t).toBe(true)
      expect('notes' in t).toBe(true)
      expect('created_at' in t).toBe(true)
      expect('updated_at' in t).toBe(true)
    }

    // 404 — id far beyond seeded range
    const notFound = await request(app)
      .get('/api/tasks/999999999')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(notFound.status).toBe(404)
    expect(notFound.body).toMatchObject({ error: 'Task not found' })

    // 400 — non-integer path segment
    const badId = await request(app)
      .get('/api/tasks/not-an-id')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(badId.status).toBe(400)
    expect(badId.body.error).toMatch(/positive integer/)

    // 400 — zero is not a valid primary key
    const zeroId = await request(app)
      .get('/api/tasks/0')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
    expect(zeroId.status).toBe(400)
  })
})

// =============================================================================
describe('PATCH /api/projects/:slug — Portfolio matrix update (S11-BE-00)', () => {
  it('TC-SA32: returns 200 with updated project when portfolio fields provided', async () => {
    // Create a test project
    const projectRes = await db.pool.query<{ id: number }>(
      `INSERT INTO projects (slug, name, owner_agent_slug, status)
       VALUES ('patch-test-project-1', 'Patch Test Project 1', 'squad-test-agent', 'active')
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
    )
    const projectId: number = projectRes.rows[0]?.id
      ?? (await db.pool.query<{ id: number }>(
            `SELECT id FROM projects WHERE slug = 'patch-test-project-1'`,
          )).rows[0]!.id

    const app = createSquadApiApp()
    const res = await request(app)
      .patch('/api/projects/patch-test-project-1')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({
        business_value: 5,
        strategic_fit: 3,
        effort: 1,
      })

    expect(res.status).toBe(200)
    const body = res.body as { data: Record<string, unknown> }
    expect(body.data).toBeDefined()
    expect(body.data['business_value']).toBe(5)
    expect(body.data['strategic_fit']).toBe(3)
    expect(body.data['effort']).toBe(1)
    // ROI score: (5 * 3) / 1 = 15
    expect(body.data['roi_score']).toBe(15)
  })

  it('TC-SA33: returns 200 and computes null ROI score when any component is null', async () => {
    const projectRes = await db.pool.query<{ id: number }>(
      `INSERT INTO projects (slug, name, owner_agent_slug, status)
       VALUES ('patch-test-project-2', 'Patch Test Project 2', 'squad-test-agent', 'active')
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
    )
    const projectId: number = projectRes.rows[0]?.id
      ?? (await db.pool.query<{ id: number }>(
            `SELECT id FROM projects WHERE slug = 'patch-test-project-2'`,
          )).rows[0]!.id

    const app = createSquadApiApp()
    const res = await request(app)
      .patch('/api/projects/patch-test-project-2')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({
        business_value: null,
        strategic_fit: 3,
        effort: 1,
      })

    expect(res.status).toBe(200)
    const body = res.body as { data: Record<string, unknown> }
    expect(body.data['business_value']).toBeNull()
    expect(body.data['strategic_fit']).toBe(3)
    // ROI score should be null because business_value is null
    expect(body.data['roi_score']).toBeNull()
  })

  it('TC-SA34: returns 400 when field value not in [1,3,5]', async () => {
    const app = createSquadApiApp()
    const res = await request(app)
      .patch('/api/projects/patch-test-project-1')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({
        business_value: 2, // Invalid — not in [1,3,5]
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Validation failed')
  })

  it('TC-SA35: returns 422 when no fields provided', async () => {
    const app = createSquadApiApp()
    const res = await request(app)
      .patch('/api/projects/patch-test-project-1')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({})

    expect(res.status).toBe(422)
    expect(res.body.error).toMatch(/At least one portfolio matrix field must be provided/)
  })

  it('TC-SA36: returns 404 when project slug not found (opaque)', async () => {
    const app = createSquadApiApp()
    const res = await request(app)
      .patch('/api/projects/nonexistent-patch-project-xyz')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({
        business_value: 3,
      })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Project not found')
    // Should not enumerate valid projects (SEC-A6)
    expect(JSON.stringify(res.body)).not.toMatch(/patch-test-project/)
  })

  it('TC-SA37: only allows portfolio matrix fields (allowlist enforced via .strict())', async () => {
    const app = createSquadApiApp()
    const res = await request(app)
      .patch('/api/projects/patch-test-project-1')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({
        business_value: 3,
        name: 'New Name', // Not in allowlist — .strict() rejects
      })

    // SEC-31: Zod .strict() rejects unknown fields with 400
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Validation failed')
  })

  it('TC-SA38: partial update — only business_value, other fields unchanged', async () => {
    // Create project with all fields set
    const projectRes = await db.pool.query<{ id: number }>(
      `INSERT INTO projects (slug, name, owner_agent_slug, status, business_value, strategic_fit, effort, risk_index)
       VALUES ('patch-test-project-3', 'Patch Test Project 3', 'squad-test-agent', 'active', 1, 3, 5, 1)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
    )
    const projectId: number = projectRes.rows[0]?.id
      ?? (await db.pool.query<{ id: number }>(
            `SELECT id FROM projects WHERE slug = 'patch-test-project-3'`,
          )).rows[0]!.id

    const app = createSquadApiApp()
    const res = await request(app)
      .patch('/api/projects/patch-test-project-3')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({
        business_value: 5, // Change only business_value
      })

    expect(res.status).toBe(200)
    const body = res.body as { data: Record<string, unknown> }
    expect(body.data['business_value']).toBe(5)
    expect(body.data['strategic_fit']).toBe(3) // Unchanged
    expect(body.data['effort']).toBe(5) // Unchanged
    expect(body.data['risk_index']).toBe(1) // Unchanged
    // ROI: (5 * 3) / 5 = 3
    expect(body.data['roi_score']).toBe(3)
  })

  it('TC-SA39: setting effort when BV/SF are null — ROI stays null', async () => {
    // Create project with null business_value
    const projectRes = await db.pool.query<{ id: number }>(
      `INSERT INTO projects (slug, name, owner_agent_slug, status, strategic_fit, risk_index)
       VALUES ('patch-test-project-4', 'Patch Test Project 4', 'squad-test-agent', 'active', 3, 1)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
    )
    const projectId: number = projectRes.rows[0]?.id
      ?? (await db.pool.query<{ id: number }>(
            `SELECT id FROM projects WHERE slug = 'patch-test-project-4'`,
          )).rows[0]!.id

    const app = createSquadApiApp()
    const res = await request(app)
      .patch('/api/projects/patch-test-project-4')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({
        effort: 1, // Set effort, but business_value is still null
      })

    expect(res.status).toBe(200)
    const body = res.body as { data: Record<string, unknown> }
    expect(body.data['business_value']).toBeNull()
    expect(body.data['strategic_fit']).toBe(3)
    expect(body.data['effort']).toBe(1)
    // ROI: null (because business_value is null)
    expect(body.data['roi_score']).toBeNull()
  })

  it('TC-SA40: updated_at timestamp changes on PATCH', async () => {
    // Create project
    const projectRes = await db.pool.query<{ id: number; updated_at: string }>(
      `INSERT INTO projects (slug, name, owner_agent_slug, status, business_value, strategic_fit, effort, risk_index)
       VALUES ('patch-test-project-5', 'Patch Test Project 5', 'squad-test-agent', 'active', 1, 1, 1, 1)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id, updated_at`,
    )
    const projectId: number = projectRes.rows[0]!.id
    const originalUpdatedAt = new Date(projectRes.rows[0]!.updated_at).getTime()

    // Sleep briefly to ensure timestamp difference
    await new Promise((resolve) => setTimeout(resolve, 100))

    const app = createSquadApiApp()
    const res = await request(app)
      .patch('/api/projects/patch-test-project-5')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({
        business_value: 5,
      })

    expect(res.status).toBe(200)
    const body = res.body as { data: Record<string, unknown> }
    const newUpdatedAt = new Date(body.data['updated_at'] as string).getTime()

    // Verify updated_at has changed
    expect(newUpdatedAt).toBeGreaterThan(originalUpdatedAt)
  })
})

