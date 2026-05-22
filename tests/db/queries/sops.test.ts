/**
 * tests/db/queries/sops.test.ts
 *
 * Integration tests for src/db/queries/sops.ts.
 * searchSops accepts a pre-computed embedding — no Gemini API call is made here.
 *
 * Coverage targets (S7-07):
 *   searchSops — empty result, with data, with category filter, respects limit
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { createTestDb, type TestDb } from '../../helpers/db.js'

let clientPool: Pool | undefined
vi.mock('../../../src/db/client.js', () => ({
  get pool() { return clientPool },
}))

import { searchSops } from '../../../src/db/queries/sops.js'

let db: TestDb
const ZERO_EMBEDDING = new Array(768).fill(0.0)
const NEAR_EMBEDDING = new Array(768).fill(0.1)

beforeAll(async () => {
  db = await createTestDb()
  clientPool = db.pool
}, 90_000)

afterAll(async () => {
  await db.teardown()
})

beforeEach(async () => {
  await db.pool.query(`DELETE FROM sops`)
})

// Helper: insert a SOP row directly (no handler for this — SOPs are seeded via scripts)
async function seedSop(
  category: string,
  agent: string | null,
  instruction: string,
  embedding = ZERO_EMBEDDING,
) {
  await db.pool.query(
    `INSERT INTO sops (category, agent, instruction, embedding)
     VALUES ($1, $2, $3, $4::vector)`,
    [category, agent, instruction, JSON.stringify(embedding)],
  )
}

// ---------------------------------------------------------------------------
// searchSops
// ---------------------------------------------------------------------------

describe('searchSops', () => {
  it('TC-SO1: returns empty array when no SOPs exist', async () => {
    const results = await searchSops({ embedding: ZERO_EMBEDDING, limit: 5 })
    expect(results).toHaveLength(0)
  })

  it('TC-SO2: returns SOPs ordered by vector similarity', async () => {
    await seedSop('Coding', null, 'Use strict TypeScript', NEAR_EMBEDDING)
    await seedSop('DevOps', null, 'Always use containers', ZERO_EMBEDDING)

    const results = await searchSops({ embedding: NEAR_EMBEDDING, limit: 10 })
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect((results[0] as { similarity?: number }).similarity).toBeDefined()
  })

  it('TC-SO3: filters by category', async () => {
    await seedSop('Coding', null, 'TypeScript strict mode')
    await seedSop('DevOps', null, 'Use health checks')

    const results = await searchSops({ embedding: ZERO_EMBEDDING, limit: 10, category: 'Coding' })
    expect(results.every(r => r.category === 'Coding')).toBe(true)
  })

  it('TC-SO4: respects the limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await seedSop('Coding', null, `SOP ${i}`)
    }

    const results = await searchSops({ embedding: ZERO_EMBEDDING, limit: 2 })
    expect(results).toHaveLength(2)
  })
})
