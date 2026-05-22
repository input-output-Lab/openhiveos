/**
 * tests/db/queries/thoughts.test.ts
 *
 * Integration + unit tests for src/db/queries/thoughts.ts.
 * - computeThoughtFlags is a pure function — no DB or network needed.
 * - All DB functions use the vi.mock pool injection pattern.
 * - ratifyThought calls embedContent — mocked via vi.mock.
 *
 * Coverage targets (S7-07):
 *   computeThoughtFlags   — all flag combinations
 *   insertThought         — basic insert
 *   updateThoughtEmbedding — update path
 *   queryThoughts         — no filters, agent filter, must_surface, pending_ratification
 *   getDisposition        — found, not found
 *   setDisposition        — partial update, throws when no profile exists
 *   ratifyThought         — success, self-ratification error, block-intensity error,
 *                           not-a-candidate error
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { createTestDb, type TestDb } from '../../helpers/db.js'

// ---------------------------------------------------------------------------
// Pool injection
// ---------------------------------------------------------------------------
let clientPool: Pool | undefined
vi.mock('../../../src/db/client.js', () => ({
  get pool() { return clientPool },
}))

// ---------------------------------------------------------------------------
// Gemini embedding mock — ratifyThought calls embedContent internally
// ---------------------------------------------------------------------------
vi.mock('../../../src/embeddings/gemini.js', () => ({
  embedContent: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
}))

import {
  computeThoughtFlags,
  insertThought,
  updateThoughtEmbedding,
  queryThoughts,
  ratifyThought,
  getDisposition,
  setDisposition,
} from '../../../src/db/queries/thoughts.js'

let db: TestDb
const AGENT = 'test-agent'
const OTHER_AGENT = 'other-agent'

beforeAll(async () => {
  db = await createTestDb()
  clientPool = db.pool

  await db.pool.query(`
    INSERT INTO agents (slug, display_name, token_hash, token_salt)
    VALUES ($1, 'Other Agent', 'other-hash-thoughts', 'other-salt-t')
    ON CONFLICT (slug) DO NOTHING
  `, [OTHER_AGENT])
}, 90_000)

afterAll(async () => {
  await db.teardown()
})

beforeEach(async () => {
  await db.pool.query(`DELETE FROM memories`)
  await db.pool.query(`DELETE FROM thoughts`)
})

// ---------------------------------------------------------------------------
// computeThoughtFlags — pure function
// ---------------------------------------------------------------------------

describe('computeThoughtFlags', () => {
  it('TC-TH1: both flags false when confidence is undefined', () => {
    const flags = computeThoughtFlags('analysis', undefined)
    expect(flags.must_surface).toBe(false)
    expect(flags.auto_persist_candidate).toBe(false)
  })

  it('TC-TH2: must_surface true for concern type with confidence > 0.75', () => {
    const flags = computeThoughtFlags('concern', 0.9)
    expect(flags.must_surface).toBe(true)
  })

  it('TC-TH3: must_surface false for analysis type (not a triggering type)', () => {
    const flags = computeThoughtFlags('analysis', 0.9)
    expect(flags.must_surface).toBe(false)
  })

  it('TC-TH4: must_surface false when confidence is at threshold (not above)', () => {
    const flags = computeThoughtFlags('concern', 0.75)
    expect(flags.must_surface).toBe(false)
  })

  it('TC-TH5: auto_persist_candidate true for realization with confidence > 0.95', () => {
    const flags = computeThoughtFlags('realization', 0.99)
    expect(flags.auto_persist_candidate).toBe(true)
    expect(flags.must_surface).toBe(true)  // realization is a MUST_SURFACE_TYPE
  })

  it('TC-TH6: auto_persist_candidate false for non-realization types', () => {
    const flags = computeThoughtFlags('concern', 0.99)
    expect(flags.auto_persist_candidate).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// insertThought + queryThoughts
// ---------------------------------------------------------------------------

describe('insertThought', () => {
  it('TC-TH7: inserts and returns an id', async () => {
    const result = await insertThought({
      agent_slug: AGENT,
      thought: 'Coverage tests are important',
      thought_type: 'analysis',
      must_surface: false,
      auto_persist_candidate: false,
    })

    expect(Number(result.id)).toBeGreaterThan(0)
  })

  it('TC-TH8: inserted thought is queryable', async () => {
    await insertThought({
      agent_slug: AGENT,
      thought: 'Must surface this concern',
      thought_type: 'concern',
      confidence: 0.9,
      must_surface: true,
      auto_persist_candidate: false,
    })

    const thoughts = await queryThoughts({ agent_slug: AGENT })
    expect(thoughts).toHaveLength(1)
    expect(thoughts[0]!.thought).toBe('Must surface this concern')
    expect(thoughts[0]!.must_surface).toBe(true)
  })
})

describe('queryThoughts', () => {
  beforeEach(async () => {
    await insertThought({
      agent_slug: AGENT,
      thought: 'Analysis thought',
      thought_type: 'analysis',
      must_surface: false,
      auto_persist_candidate: false,
    })
    await insertThought({
      agent_slug: OTHER_AGENT,
      thought: 'Concern thought',
      thought_type: 'concern',
      confidence: 0.9,
      must_surface: true,
      auto_persist_candidate: false,
    })
    await insertThought({
      agent_slug: AGENT,
      thought: 'High-value realization',
      thought_type: 'realization',
      confidence: 0.99,
      must_surface: true,
      auto_persist_candidate: true,
    })
  })

  it('TC-TH9: returns all thoughts with no filters', async () => {
    const thoughts = await queryThoughts({})
    expect(thoughts).toHaveLength(3)
  })

  it('TC-TH10: filters by agent_slug', async () => {
    const thoughts = await queryThoughts({ agent_slug: AGENT })
    expect(thoughts).toHaveLength(2)
    expect(thoughts.every(t => t.agent_slug === AGENT)).toBe(true)
  })

  it('TC-TH11: filters by must_surface', async () => {
    const thoughts = await queryThoughts({ must_surface: true })
    expect(thoughts).toHaveLength(2)
    expect(thoughts.every(t => t.must_surface)).toBe(true)
  })

  it('TC-TH12: filters by pending_ratification', async () => {
    const thoughts = await queryThoughts({ pending_ratification: true })
    expect(thoughts).toHaveLength(1)
    expect(thoughts[0]!.auto_persist_candidate).toBe(true)
  })

  it('TC-TH13: respects limit', async () => {
    const thoughts = await queryThoughts({ limit: 1 })
    expect(thoughts).toHaveLength(1)
  })

  it('TC-TH14: filters by thought_type', async () => {
    const thoughts = await queryThoughts({ thought_type: 'concern' })
    expect(thoughts).toHaveLength(1)
    expect(thoughts[0]!.thought_type).toBe('concern')
  })
})

// ---------------------------------------------------------------------------
// updateThoughtEmbedding
// ---------------------------------------------------------------------------

describe('updateThoughtEmbedding', () => {
  it('TC-TH15: updates the embedding column without error', async () => {
    const { id } = await insertThought({
      agent_slug: AGENT,
      thought: 'To be embedded',
      thought_type: 'analysis',
      must_surface: false,
      auto_persist_candidate: false,
    })

    // Should not throw
    await expect(
      updateThoughtEmbedding({ id, embedding: new Array(768).fill(0.2) }),
    ).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// ratifyThought
// ---------------------------------------------------------------------------

describe('ratifyThought', () => {
  let candidateId: number

  beforeEach(async () => {
    const result = await insertThought({
      agent_slug: AGENT,
      thought: 'This is a ratifiable realization',
      thought_type: 'realization',
      confidence: 0.99,
      must_surface: true,
      auto_persist_candidate: true,
    })
    candidateId = result.id
  })

  it('TC-TH16: successfully ratifies a candidate thought', async () => {
    const result = await ratifyThought({
      thought_id: candidateId,
      ratifying_agent: OTHER_AGENT,
    })

    expect(Number(result.memory_id)).toBeGreaterThan(0)
    expect(result.auto_persisted).toBe(true)
    expect(result.ratified_by).toBe(OTHER_AGENT)
  })

  it('TC-TH17: throws on self-ratification (same agent)', async () => {
    await expect(
      ratifyThought({ thought_id: candidateId, ratifying_agent: AGENT }),
    ).rejects.toThrow('Self-ratification is prohibited')
  })

  it('TC-TH18: throws when thought is not an auto_persist_candidate', async () => {
    const { id } = await insertThought({
      agent_slug: AGENT,
      thought: 'Not a candidate',
      thought_type: 'analysis',
      must_surface: false,
      auto_persist_candidate: false,
    })

    await expect(
      ratifyThought({ thought_id: id, ratifying_agent: OTHER_AGENT }),
    ).rejects.toThrow('not an auto_persist_candidate')
  })

  it('TC-TH19: throws for non-existent thought id', async () => {
    await expect(
      ratifyThought({ thought_id: 999999, ratifying_agent: OTHER_AGENT }),
    ).rejects.toThrow('not found')
  })

  it('TC-TH20: throws when block-intensity counter_thought is present', async () => {
    // Insert a thought with a block-intensity counter_thought manually
    await db.pool.query(
      `UPDATE thoughts SET counter_thought = $2::jsonb WHERE id = $1`,
      [
        candidateId,
        JSON.stringify({ intensity: 'block', challenge: 'This is wrong', must_surface: true, primary_thought_summary: 'x', basis: 'y' }),
      ],
    )

    await expect(
      ratifyThought({ thought_id: candidateId, ratifying_agent: OTHER_AGENT }),
    ).rejects.toThrow('Ratification suspended')
  })
})

// ---------------------------------------------------------------------------
// getDisposition + setDisposition
// ---------------------------------------------------------------------------

describe('getDisposition', () => {
  it('TC-TH21: returns null when no disposition profile exists', async () => {
    // test-agent has no disposition unless seeded
    const disp = await getDisposition('nonexistent-agent')
    expect(disp).toBeNull()
  })

  it('TC-TH22: returns disposition profile when it exists', async () => {
    // Seed a disposition for test-agent
    await db.pool.query(`
      INSERT INTO dispositions (agent_slug, assertiveness, energy, patience, formality, candor_floor)
      VALUES ($1, 0.5, 0.5, 0.5, 0.5, 0.5)
      ON CONFLICT (agent_slug) DO NOTHING
    `, [AGENT])

    const disp = await getDisposition(AGENT)
    expect(disp).toBeDefined()
    expect(disp!.agent_slug).toBe(AGENT)
    expect(typeof disp!.assertiveness).toBe('number')

    await db.pool.query(`DELETE FROM dispositions WHERE agent_slug = $1`, [AGENT])
  })
})

describe('setDisposition', () => {
  it('TC-TH23: throws when no disposition profile exists for the agent', async () => {
    await expect(
      setDisposition({ agent_slug: 'nonexistent-agent', energy: 0.8 }),
    ).rejects.toThrow()
  })

  it('TC-TH24: throws when no fields are provided', async () => {
    await db.pool.query(`
      INSERT INTO dispositions (agent_slug, assertiveness, energy, patience, formality, candor_floor)
      VALUES ($1, 0.5, 0.5, 0.5, 0.5, 0.5)
      ON CONFLICT (agent_slug) DO UPDATE SET assertiveness = EXCLUDED.assertiveness
    `, [AGENT])

    await expect(
      setDisposition({ agent_slug: AGENT }),
    ).rejects.toThrow('requires at least one field')

    await db.pool.query(`DELETE FROM dispositions WHERE agent_slug = $1`, [AGENT])
  })

  it('TC-TH25: updates disposition fields', async () => {
    await db.pool.query(`
      INSERT INTO dispositions (agent_slug, assertiveness, energy, patience, formality, candor_floor)
      VALUES ($1, 0.5, 0.5, 0.5, 0.5, 0.5)
      ON CONFLICT (agent_slug) DO UPDATE SET assertiveness = EXCLUDED.assertiveness
    `, [AGENT])

    const updated = await setDisposition({ agent_slug: AGENT, energy: 0.9 })
    expect(updated.energy).toBe(0.9)

    await db.pool.query(`DELETE FROM dispositions WHERE agent_slug = $1`, [AGENT])
  })
})
