/**
 * tests/primitives/primitives.test.ts
 *
 * Unit tests for src/primitives/** — S8-10 (Sprint 8 P2 carry from S7-10)
 *
 * Coverage targets (src/primitives/**):
 *   lines: 85%  /  branches: 65%
 *
 * Strategy:
 *   - Pure unit tests — no testcontainers, no real DB, no Gemini API key
 *   - All DB queries and external services mocked via vi.mock()
 *   - isValidAgentSlug reads squad.manifest.json on disk — no mock needed
 *     ('murphy' is valid, 'unknown-agent' is not registered)
 *
 * TC-PD*   get-disposition
 * TC-QT*   query-thoughts
 * TC-RT*   ratify-thought
 * TC-SM*   search-memory
 * TC-SS*   search-sops
 * TC-SD*   set-disposition
 * TC-STM*  store-memory
 * TC-STH*  store-thought
 */

import { vi, describe, it, expect, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — declared before any handler imports so Vitest hoisting
// ensures the mocked versions are received by each handler module.
// ---------------------------------------------------------------------------

vi.mock('../../src/db/queries/thoughts.js', () => ({
  computeThoughtFlags: vi.fn(),
  insertThought: vi.fn(),
  updateThoughtEmbedding: vi.fn(),
  ratifyThought: vi.fn(),
  getDisposition: vi.fn(),
  setDisposition: vi.fn(),
  queryThoughts: vi.fn(),
}))

vi.mock('../../src/db/queries/memory.js', () => ({
  storeMemory: vi.fn(),
  searchMemory: vi.fn(),
}))

vi.mock('../../src/db/queries/sops.js', () => ({
  searchSops: vi.fn(),
}))

vi.mock('../../src/embeddings/gemini.js', () => ({
  embedContent: vi.fn(),
}))

vi.mock('../../src/search/sanitizer.js', () => ({
  sanitizeQuery: vi.fn(),
}))

vi.mock('../../src/search/bm25.js', () => ({
  hybridRank: vi.fn(),
}))

// Imports after vi.mock() to receive the mocked module instances
import {
  computeThoughtFlags,
  insertThought,
  updateThoughtEmbedding,
  ratifyThought,
  getDisposition,
  setDisposition,
  queryThoughts,
} from '../../src/db/queries/thoughts.js'
import { storeMemory, searchMemory } from '../../src/db/queries/memory.js'
import { searchSops } from '../../src/db/queries/sops.js'
import { embedContent } from '../../src/embeddings/gemini.js'
import { sanitizeQuery } from '../../src/search/sanitizer.js'
import { hybridRank } from '../../src/search/bm25.js'

import {
  handleGetDisposition,
  getDispositionSchema,
} from '../../src/primitives/get-disposition.js'
import {
  handleQueryThoughts,
  queryThoughtsSchema,
} from '../../src/primitives/query-thoughts.js'
import {
  handleRatifyThought,
  ratifyThoughtSchema,
} from '../../src/primitives/ratify-thought.js'
import {
  handleSearchMemory,
  searchMemorySchema,
} from '../../src/primitives/search-memory.js'
import {
  handleSearchSops,
  searchSopsSchema,
} from '../../src/primitives/search-sops.js'
import {
  handleSetDisposition,
  setDispositionSchema,
} from '../../src/primitives/set-disposition.js'
import {
  handleStoreMemory,
  storeMemorySchema,
} from '../../src/primitives/store-memory.js'
import {
  handleStoreThought,
  storeThoughtSchema,
} from '../../src/primitives/store-thought.js'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const FAKE_EMBEDDING = [0.1, 0.2, 0.3]
const AGENT_SLUG = 'murphy' // registered in squad.manifest.json

// Standard sanitizeQuery return for search-memory tests
const SANITIZE_PASSTHROUGH = {
  clean_query: 'clean query text',
  was_sanitized: false,
  method: 'passthrough' as const,
  original_length: 16,
  clean_length: 16,
}

// ---------------------------------------------------------------------------
// get-disposition
// ---------------------------------------------------------------------------

describe('handleGetDisposition', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC-PD1: returns disposition profile when found', async () => {
    const profile = { agent_slug: AGENT_SLUG, assertiveness: 0.5 }
    vi.mocked(getDisposition).mockResolvedValue(profile as any)

    const result = await handleGetDisposition({ agent_slug: AGENT_SLUG })

    expect(getDisposition).toHaveBeenCalledWith(AGENT_SLUG)
    expect(result).toBe(profile)
  })

  it('TC-PD2: throws when no disposition profile exists', async () => {
    vi.mocked(getDisposition).mockResolvedValue(null)

    await expect(handleGetDisposition({ agent_slug: AGENT_SLUG }))
      .rejects.toThrow(/No disposition profile found/)
  })

  it('TC-PD3: schema rejects an unknown agent slug', () => {
    expect(() => getDispositionSchema.parse({ agent_slug: 'unknown-agent' })).toThrow()
  })

  it('TC-PD4: schema accepts a valid agent slug', () => {
    expect(() => getDispositionSchema.parse({ agent_slug: AGENT_SLUG })).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// query-thoughts
// ---------------------------------------------------------------------------

describe('handleQueryThoughts', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC-QT1: minimal call with default limit forwards to queryThoughts', async () => {
    const rows = [{ id: 1, thought: 'x' }]
    vi.mocked(queryThoughts).mockResolvedValue(rows as any)

    const result = await handleQueryThoughts({ limit: 50 })

    expect(queryThoughts).toHaveBeenCalledWith({ limit: 50 })
    expect(result).toBe(rows)
  })

  it('TC-QT2: all optional filters are forwarded', async () => {
    vi.mocked(queryThoughts).mockResolvedValue([])

    await handleQueryThoughts({
      agent_slug: AGENT_SLUG,
      session_id: 'sess-1',
      thought_type: 'decision',
      must_surface: true,
      auto_persist_candidate: false,
      pending_ratification: true,
      from: '2026-01-01',
      to: '2026-12-31',
      limit: 10,
    })

    expect(queryThoughts).toHaveBeenCalledWith({
      agent_slug: AGENT_SLUG,
      session_id: 'sess-1',
      thought_type: 'decision',
      must_surface: true,
      auto_persist_candidate: false,
      pending_ratification: true,
      from: '2026-01-01',
      to: '2026-12-31',
      limit: 10,
    })
  })

  it('TC-QT3: undefined optional fields are excluded from the query call', async () => {
    vi.mocked(queryThoughts).mockResolvedValue([])

    await handleQueryThoughts({ limit: 5 })

    const call = vi.mocked(queryThoughts).mock.calls[0]![0]
    expect(call).not.toHaveProperty('agent_slug')
    expect(call).not.toHaveProperty('session_id')
    expect(call).not.toHaveProperty('thought_type')
  })

  it('TC-QT4: schema default limit is 50', () => {
    const parsed = queryThoughtsSchema.parse({})
    expect(parsed.limit).toBe(50)
  })

  it('TC-QT5: schema rejects limit > 100', () => {
    expect(() => queryThoughtsSchema.parse({ limit: 101 })).toThrow()
  })

  it('TC-QT6: schema rejects an invalid thought_type', () => {
    expect(() => queryThoughtsSchema.parse({ thought_type: 'rant' })).toThrow()
  })

  it('TC-QT7: schema rejects an unknown agent slug', () => {
    expect(() => queryThoughtsSchema.parse({ agent_slug: 'nobody' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// ratify-thought
// ---------------------------------------------------------------------------

describe('handleRatifyThought', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC-RT1: calls ratifyThought with thought_id and ratifying_agent', async () => {
    const ratified = { id: 42, ratified_by: AGENT_SLUG }
    vi.mocked(ratifyThought).mockResolvedValue(ratified as any)

    const result = await handleRatifyThought({ thought_id: 42 }, AGENT_SLUG)

    expect(ratifyThought).toHaveBeenCalledWith({
      thought_id: 42,
      ratifying_agent: AGENT_SLUG,
    })
    expect(result).toBe(ratified)
  })

  it('TC-RT2: schema rejects non-positive thought_id', () => {
    expect(() => ratifyThoughtSchema.parse({ thought_id: 0 })).toThrow()
    expect(() => ratifyThoughtSchema.parse({ thought_id: -5 })).toThrow()
  })

  it('TC-RT3: schema rejects non-integer thought_id', () => {
    expect(() => ratifyThoughtSchema.parse({ thought_id: 1.5 })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// search-memory
// ---------------------------------------------------------------------------

describe('handleSearchMemory', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC-SM1: sanitizes, embeds, fetches candidates, reranks, and returns result with meta', async () => {
    vi.mocked(sanitizeQuery).mockReturnValue(SANITIZE_PASSTHROUGH as any)
    vi.mocked(embedContent).mockResolvedValue(FAKE_EMBEDDING)
    const candidates = [{ id: 1, content: 'foo', similarity: 0.9 }]
    vi.mocked(searchMemory).mockResolvedValue(candidates as any)
    const reranked = [{ id: 1, content: 'foo', similarity: 0.9, bm25_score: 1.2 }]
    vi.mocked(hybridRank).mockReturnValue(reranked as any)

    const result = await handleSearchMemory({ query: 'clean query text', limit: 5 })

    expect(sanitizeQuery).toHaveBeenCalledWith('clean query text')
    expect(embedContent).toHaveBeenCalledWith(SANITIZE_PASSTHROUGH.clean_query)
    // fetchLimit = min(5*3, 20) = 15
    expect(searchMemory).toHaveBeenCalledWith({ embedding: FAKE_EMBEDDING, limit: 15 })
    expect(hybridRank).toHaveBeenCalledWith(candidates, SANITIZE_PASSTHROUGH.clean_query)
    expect(result.results).toEqual(reranked)
    expect(result.query_meta.was_sanitized).toBe(false)
    expect(result.query_meta.method).toBe('passthrough')
  })

  it('TC-SM2: fetchLimit is capped at 20 when limit * 3 would exceed it', async () => {
    vi.mocked(sanitizeQuery).mockReturnValue(SANITIZE_PASSTHROUGH as any)
    vi.mocked(embedContent).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(searchMemory).mockResolvedValue([])
    vi.mocked(hybridRank).mockReturnValue([])

    // limit=20 → 20*3=60, capped to 20
    await handleSearchMemory({ query: 'test', limit: 20 })

    expect(searchMemory).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }))
  })

  it('TC-SM3: metadata_filter is forwarded when provided', async () => {
    vi.mocked(sanitizeQuery).mockReturnValue(SANITIZE_PASSTHROUGH as any)
    vi.mocked(embedContent).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(searchMemory).mockResolvedValue([])
    vi.mocked(hybridRank).mockReturnValue([])

    await handleSearchMemory({ query: 'test', limit: 5, metadata_filter: { agent: 'silas' } })

    expect(searchMemory).toHaveBeenCalledWith(
      expect.objectContaining({ metadata_filter: { agent: 'silas' } }),
    )
  })

  it('TC-SM4: metadata_filter is absent from query call when not provided', async () => {
    vi.mocked(sanitizeQuery).mockReturnValue(SANITIZE_PASSTHROUGH as any)
    vi.mocked(embedContent).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(searchMemory).mockResolvedValue([])
    vi.mocked(hybridRank).mockReturnValue([])

    await handleSearchMemory({ query: 'test', limit: 5 })

    const call = vi.mocked(searchMemory).mock.calls[0]![0]
    expect(call).not.toHaveProperty('metadata_filter')
  })

  it('TC-SM5: results are trimmed to requested limit after rerank', async () => {
    vi.mocked(sanitizeQuery).mockReturnValue(SANITIZE_PASSTHROUGH as any)
    vi.mocked(embedContent).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(searchMemory).mockResolvedValue([])
    const reranked = [
      { id: 1, content: 'a', bm25_score: 3 },
      { id: 2, content: 'b', bm25_score: 2 },
      { id: 3, content: 'c', bm25_score: 1 },
    ]
    vi.mocked(hybridRank).mockReturnValue(reranked as any)

    const result = await handleSearchMemory({ query: 'test', limit: 2 })

    expect(result.results).toHaveLength(2)
  })

  it('TC-SM6: sanitization metadata is surfaced in query_meta', async () => {
    const sanitized = {
      clean_query: 'safe query',
      was_sanitized: true,
      method: 'strip_injection' as const,
      original_length: 80,
      clean_length: 10,
    }
    vi.mocked(sanitizeQuery).mockReturnValue(sanitized as any)
    vi.mocked(embedContent).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(searchMemory).mockResolvedValue([])
    vi.mocked(hybridRank).mockReturnValue([])

    const result = await handleSearchMemory({ query: 'injected prompt...', limit: 5 })

    expect(result.query_meta.was_sanitized).toBe(true)
    expect(result.query_meta.method).toBe('strip_injection')
    expect(result.query_meta.original_length).toBe(80)
  })

  it('TC-SM7: schema rejects empty query string', () => {
    expect(() => searchMemorySchema.parse({ query: '' })).toThrow()
  })

  it('TC-SM8: schema rejects limit > 20', () => {
    expect(() => searchMemorySchema.parse({ query: 'x', limit: 21 })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// search-sops
// ---------------------------------------------------------------------------

describe('handleSearchSops', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC-SS1: embeds query and calls searchSops, returning rows', async () => {
    vi.mocked(embedContent).mockResolvedValue(FAKE_EMBEDDING)
    const sops = [{ id: 1, instruction: 'do the thing' }]
    vi.mocked(searchSops).mockResolvedValue(sops as any)

    const result = await handleSearchSops({ query: 'how do I deploy', limit: 3 })

    expect(embedContent).toHaveBeenCalledWith('how do I deploy')
    expect(searchSops).toHaveBeenCalledWith({ embedding: FAKE_EMBEDDING, limit: 3 })
    expect(result).toBe(sops)
  })

  it('TC-SS2: category filter is forwarded when provided', async () => {
    vi.mocked(embedContent).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(searchSops).mockResolvedValue([])

    await handleSearchSops({ query: 'deploy process', limit: 3, category: 'DevOps' })

    expect(searchSops).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'DevOps' }),
    )
  })

  it('TC-SS3: category is absent from query call when not provided', async () => {
    vi.mocked(embedContent).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(searchSops).mockResolvedValue([])

    await handleSearchSops({ query: 'general SOP lookup', limit: 3 })

    const call = vi.mocked(searchSops).mock.calls[0]![0]
    expect(call).not.toHaveProperty('category')
  })

  it('TC-SS4: schema default limit is 3', () => {
    const parsed = searchSopsSchema.parse({ query: 'test' })
    expect(parsed.limit).toBe(3)
  })

  it('TC-SS5: schema rejects limit > 10', () => {
    expect(() => searchSopsSchema.parse({ query: 'test', limit: 11 })).toThrow()
  })

  it('TC-SS6: schema rejects an invalid category value', () => {
    expect(() => searchSopsSchema.parse({ query: 'test', category: 'Recipes' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// set-disposition
// ---------------------------------------------------------------------------

describe('handleSetDisposition', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC-SD1: calls setDisposition with agent_slug and provided slider values', async () => {
    const updated = { agent_slug: AGENT_SLUG, assertiveness: 0.7 }
    vi.mocked(setDisposition).mockResolvedValue(updated as any)

    await handleSetDisposition({ assertiveness: 0.7, energy: -0.5 }, AGENT_SLUG)

    expect(setDisposition).toHaveBeenCalledWith(
      expect.objectContaining({ agent_slug: AGENT_SLUG, assertiveness: 0.7, energy: -0.5 }),
    )
  })

  it('TC-SD2: empty input forwards only agent_slug', async () => {
    vi.mocked(setDisposition).mockResolvedValue({} as any)

    await handleSetDisposition({}, AGENT_SLUG)

    const call = vi.mocked(setDisposition).mock.calls[0]![0]
    expect(call).toEqual({ agent_slug: AGENT_SLUG })
  })

  it('TC-SD3: unprovided optional sliders are absent from the call', async () => {
    vi.mocked(setDisposition).mockResolvedValue({} as any)

    await handleSetDisposition({ patience: 0.3 }, AGENT_SLUG)

    const call = vi.mocked(setDisposition).mock.calls[0]![0]
    expect(call.patience).toBe(0.3)
    expect(call).not.toHaveProperty('assertiveness')
    expect(call).not.toHaveProperty('energy')
  })

  it('TC-SD4: schema rejects assertiveness outside [-1, 1]', () => {
    expect(() => setDispositionSchema.parse({ assertiveness: 1.1 })).toThrow()
    expect(() => setDispositionSchema.parse({ assertiveness: -1.1 })).toThrow()
  })

  it('TC-SD5: schema rejects candor_floor below 0.2', () => {
    expect(() => setDispositionSchema.parse({ candor_floor: 0.1 })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// store-memory
// ---------------------------------------------------------------------------

describe('handleStoreMemory', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC-STM1: embeds content and stores memory, returning the new id', async () => {
    vi.mocked(embedContent).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(storeMemory).mockResolvedValue({ id: 99 })

    const result = await handleStoreMemory({ content: 'important insight' }, AGENT_SLUG)

    expect(embedContent).toHaveBeenCalledWith('important insight')
    expect(storeMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_slug: AGENT_SLUG,
        content: 'important insight',
        embedding: FAKE_EMBEDDING,
      }),
    )
    expect(result).toEqual({ id: 99 })
  })

  it('TC-STM2: optional task_id and metadata are forwarded when provided', async () => {
    vi.mocked(embedContent).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(storeMemory).mockResolvedValue({ id: 42 })

    await handleStoreMemory(
      { content: 'sprint note', task_id: 7, metadata: { sprint: '8' } },
      AGENT_SLUG,
    )

    expect(storeMemory).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: 7, metadata: { sprint: '8' } }),
    )
  })

  it('TC-STM3: task_id and metadata absent from call when not provided', async () => {
    vi.mocked(embedContent).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(storeMemory).mockResolvedValue({ id: 1 })

    await handleStoreMemory({ content: 'bare note' }, AGENT_SLUG)

    const call = vi.mocked(storeMemory).mock.calls[0]![0]
    expect(call).not.toHaveProperty('task_id')
    expect(call).not.toHaveProperty('metadata')
  })

  it('TC-STM4: schema rejects empty content', () => {
    expect(() => storeMemorySchema.parse({ content: '' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// store-thought
// ---------------------------------------------------------------------------

describe('handleStoreThought', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC-STH1: inserts thought and immediately returns {id, must_surface, auto_persist_candidate}', async () => {
    vi.mocked(computeThoughtFlags).mockReturnValue({
      must_surface: false,
      auto_persist_candidate: false,
    })
    vi.mocked(insertThought).mockResolvedValue({ id: 77 } as any)
    vi.mocked(embedContent).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(updateThoughtEmbedding).mockResolvedValue(undefined as any)

    const result = await handleStoreThought({ thought: 'this is a thought' }, AGENT_SLUG)

    expect(insertThought).toHaveBeenCalledWith(
      expect.objectContaining({ agent_slug: AGENT_SLUG, thought: 'this is a thought' }),
    )
    expect(result).toEqual({ id: 77, must_surface: false, auto_persist_candidate: false })
  })

  it('TC-STH2: schema default thought_type is analysis', () => {
    const parsed = storeThoughtSchema.parse({ thought: 'x' })
    expect(parsed.thought_type).toBe('analysis')
  })

  it('TC-STH3: must_surface and auto_persist_candidate from computeThoughtFlags are forwarded', async () => {
    vi.mocked(computeThoughtFlags).mockReturnValue({
      must_surface: true,
      auto_persist_candidate: true,
    })
    vi.mocked(insertThought).mockResolvedValue({ id: 10 } as any)
    vi.mocked(embedContent).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(updateThoughtEmbedding).mockResolvedValue(undefined as any)

    const result = await handleStoreThought(
      { thought: 'high-confidence realization', thought_type: 'realization', confidence: 0.95 },
      AGENT_SLUG,
    )

    expect(result.must_surface).toBe(true)
    expect(result.auto_persist_candidate).toBe(true)
    const call = vi.mocked(insertThought).mock.calls[0]![0]
    expect(call.must_surface).toBe(true)
    expect(call.auto_persist_candidate).toBe(true)
  })

  it('TC-STH4: updateThoughtEmbedding is called asynchronously after embedContent resolves', async () => {
    vi.mocked(computeThoughtFlags).mockReturnValue({
      must_surface: false,
      auto_persist_candidate: false,
    })
    vi.mocked(insertThought).mockResolvedValue({ id: 5 } as any)
    vi.mocked(embedContent).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(updateThoughtEmbedding).mockResolvedValue(undefined as any)

    await handleStoreThought({ thought: 'async embed test' }, AGENT_SLUG)

    // Flush microtask queue: embedContent .then() resolves in two ticks
    await Promise.resolve()
    await Promise.resolve()

    expect(updateThoughtEmbedding).toHaveBeenCalledWith({ id: 5, embedding: FAKE_EMBEDDING })
  })

  it('TC-STH5: embedding failure is swallowed — caller promise still resolves', async () => {
    vi.mocked(computeThoughtFlags).mockReturnValue({
      must_surface: false,
      auto_persist_candidate: false,
    })
    vi.mocked(insertThought).mockResolvedValue({ id: 6 } as any)
    vi.mocked(embedContent).mockRejectedValue(new Error('Gemini unavailable'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await handleStoreThought({ thought: 'embed will fail' }, AGENT_SLUG)

    await Promise.resolve()
    await Promise.resolve()

    expect(result).toEqual({ id: 6, must_surface: false, auto_persist_candidate: false })
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('TC-STH6: counter_thought is forwarded when provided', async () => {
    vi.mocked(computeThoughtFlags).mockReturnValue({
      must_surface: false,
      auto_persist_candidate: false,
    })
    vi.mocked(insertThought).mockResolvedValue({ id: 8 } as any)
    vi.mocked(embedContent).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(updateThoughtEmbedding).mockResolvedValue(undefined as any)

    const counter = {
      primary_thought_summary: 'some summary',
      challenge: 'here is my challenge',
      basis: 'evidence basis',
      must_surface: true,
      intensity: 'caution' as const,
    }
    await handleStoreThought({ thought: 'with counter', counter_thought: counter }, AGENT_SLUG)

    expect(insertThought).toHaveBeenCalledWith(
      expect.objectContaining({ counter_thought: counter }),
    )
  })

  it('TC-STH7: unprovided optional fields are absent from insertThought call', async () => {
    vi.mocked(computeThoughtFlags).mockReturnValue({
      must_surface: false,
      auto_persist_candidate: false,
    })
    vi.mocked(insertThought).mockResolvedValue({ id: 9 } as any)
    vi.mocked(embedContent).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(updateThoughtEmbedding).mockResolvedValue(undefined as any)

    await handleStoreThought({ thought: 'minimal thought' }, AGENT_SLUG)

    const call = vi.mocked(insertThought).mock.calls[0]![0]
    expect(call).not.toHaveProperty('session_id')
    expect(call).not.toHaveProperty('task_id')
    expect(call).not.toHaveProperty('counter_thought')
    expect(call).not.toHaveProperty('raw_behavior')
    expect(call).not.toHaveProperty('expressed_behavior')
  })

  it('TC-STH8: schema rejects empty thought string', () => {
    expect(() => storeThoughtSchema.parse({ thought: '' })).toThrow()
  })

  it('TC-STH9: schema rejects an invalid thought_type value', () => {
    expect(() => storeThoughtSchema.parse({ thought: 'x', thought_type: 'rant' })).toThrow()
  })

  it('TC-STH10: schema rejects confidence outside [0, 1]', () => {
    expect(() => storeThoughtSchema.parse({ thought: 'x', confidence: 1.1 })).toThrow()
    expect(() => storeThoughtSchema.parse({ thought: 'x', confidence: -0.1 })).toThrow()
  })
})
