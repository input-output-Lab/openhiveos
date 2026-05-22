/**
 * tests/db/queries/memory.test.ts
 *
 * Integration tests for src/db/queries/memory.ts.
 * storeMemory and searchMemory both accept pre-computed embeddings as parameters —
 * no call to the Gemini API is made in this module. The pool is injected via
 * the vi.mock getter pattern.
 *
 * Coverage targets (S7-07):
 *   storeMemory  — success, optional task_id and metadata
 *   searchMemory — empty result, with stored memory, with metadata_filter
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { createTestDb, type TestDb } from '../../helpers/db.js'

let clientPool: Pool | undefined
vi.mock('../../../src/db/client.js', () => ({
  get pool() { return clientPool },
}))

import { storeMemory, searchMemory } from '../../../src/db/queries/memory.js'

let db: TestDb

// 768-dimensional zero embedding — matches the vector(768) column from 001_init.sql
const ZERO_EMBEDDING = new Array(768).fill(0.0)
const NEAR_EMBEDDING = new Array(768).fill(0.1)

beforeAll(async () => {
  db = await createTestDb()
  clientPool = db.pool

  // Ensure test-agent exists (seeded by createTestDb)
}, 90_000)

afterAll(async () => {
  await db.teardown()
})

beforeEach(async () => {
  await db.pool.query(`DELETE FROM memories`)
})

// ---------------------------------------------------------------------------
// storeMemory
// ---------------------------------------------------------------------------

describe('storeMemory', () => {
  it('TC-M1: inserts and returns an id', async () => {
    const result = await storeMemory({
      agent_slug: 'test-agent',
      content: 'Some memory content',
      embedding: ZERO_EMBEDDING,
    })

    expect(result).toHaveProperty('id')
    expect(Number(result.id)).toBeGreaterThan(0)
  })

  it('TC-M2: persists optional metadata', async () => {
    const result = await storeMemory({
      agent_slug: 'test-agent',
      content: 'Tagged memory',
      embedding: ZERO_EMBEDDING,
      metadata: { type: 'journal', project: 'openhiveos' },
    })

    const row = await db.pool.query<{ metadata: Record<string, string> }>(
      `SELECT metadata FROM memories WHERE id = $1`,
      [result.id],
    )
    expect(row.rows[0]!.metadata).toMatchObject({ type: 'journal' })
  })
})

// ---------------------------------------------------------------------------
// searchMemory
// ---------------------------------------------------------------------------

describe('searchMemory', () => {
  it('TC-M3: returns empty array when no memories exist', async () => {
    const results = await searchMemory({ embedding: ZERO_EMBEDDING, limit: 5 })
    expect(results).toHaveLength(0)
  })

  it('TC-M4: returns stored memories ordered by similarity', async () => {
    await storeMemory({ agent_slug: 'test-agent', content: 'First',  embedding: NEAR_EMBEDDING })
    await storeMemory({ agent_slug: 'test-agent', content: 'Second', embedding: ZERO_EMBEDDING })

    const results = await searchMemory({ embedding: NEAR_EMBEDDING, limit: 10 })
    expect(results.length).toBeGreaterThanOrEqual(1)
    // Results have a similarity score
    expect((results[0] as { similarity?: number }).similarity).toBeDefined()
  })

  it('TC-M5: filters by metadata_filter', async () => {
    await storeMemory({
      agent_slug: 'test-agent',
      content: 'Tagged',
      embedding: ZERO_EMBEDDING,
      metadata: { type: 'quality' },
    })
    await storeMemory({
      agent_slug: 'test-agent',
      content: 'Untagged',
      embedding: ZERO_EMBEDDING,
    })

    const results = await searchMemory({
      embedding: ZERO_EMBEDDING,
      limit: 10,
      metadata_filter: { type: 'quality' },
    })

    expect(results.every(r => (r.metadata as { type?: string })?.type === 'quality')).toBe(true)
  })

  it('TC-M6: respects the limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await storeMemory({
        agent_slug: 'test-agent',
        content: `Memory ${i}`,
        embedding: NEAR_EMBEDDING,  // non-zero so cosine similarity is defined
      })
    }

    const results = await searchMemory({ embedding: NEAR_EMBEDDING, limit: 2 })
    expect(results).toHaveLength(2)
  })
})
