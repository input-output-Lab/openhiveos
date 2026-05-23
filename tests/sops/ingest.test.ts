/**
 * tests/sops/ingest.test.ts
 *
 * Integration tests for src/sops/ingest.ts — SOP ingest runner (S8-06).
 *
 * Coverage targets (src/sops/**):
 *   lines: 85%  /  branches: 65%
 *
 * Test strategy:
 *   - Real PostgreSQL + pgvector via testcontainers (migrations 001–008 applied)
 *   - Real file system temp directories for seed file fixtures
 *   - vi.mock for embedContent (Gemini) — controls embedding responses per test
 *     so no real Gemini API key is required
 *   - pool from src/db/client.js redirected to testcontainer pool via getter mock
 *
 * Decision coverage:
 *   D1  idempotency (TC-SI6: hash skip on second run)
 *   D2  namespace from directory path (TC-SI10)
 *   D3  category from subdirectory name (TC-SI4 unknown, TC-SI12 all valid values)
 *   D4  content_hash stored and checked (TC-SI6, TC-SI7)
 *   D7  operator SOP shadow check ≥ 0.92 (TC-SI11)
 *   D8  fail-fast on empty table + Gemini error (TC-SI8)
 *   D8  warn-continue on non-empty table + Gemini error (TC-SI9)
 *   D9  skip draft status (TC-SI2)
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Pool } from 'pg'
import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestDb, type TestDb } from '../helpers/db.js'

// ---------------------------------------------------------------------------
// Module mocks — hoisted before any import of the mocked modules
// ---------------------------------------------------------------------------

let clientPool: Pool | undefined

vi.mock('../../src/db/client.js', () => ({
  get pool() { return clientPool },
}))

vi.mock('../../src/embeddings/gemini.js', () => ({
  embedContent: vi.fn(),
}))

// These imports must come after vi.mock() declarations so Vitest's hoisting
// ensures they receive the mocked versions.
import { embedContent } from '../../src/embeddings/gemini.js'
import { runSopIngest, type IngestStats } from '../../src/sops/ingest.js'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** 768-dimensional unit vector — first component = 1, rest = 0 */
const UNIT_EMBEDDING = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1.0 : 0.0))

/** Valid SOP frontmatter + body. Optional extra frontmatter lines before the closing ---. */
const VALID_SOP = (title = 'Test SOP', extraFrontmatter = ''): string =>
  `---\ntitle: ${title}\nversion: 1.0.0\nscope: team\nstatus: active\n` +
  `review_date: 2027-01-01\ntags:\n  - coding\n${extraFrontmatter}---\n\n` +
  `This is the SOP instruction body. Long enough to be meaningful.`

const DRAFT_SOP = `---\ntitle: Draft SOP\nstatus: draft\n---\n\nNot ready yet.`

const NO_TITLE_SOP = `---\nversion: 1.0\nstatus: active\n---\n\nNo title present.`

/**
 * Create a temporary seeds directory tree from a flat path→content map.
 * Returns the seeds root path (the directory to pass to runSopIngest).
 */
async function makeSeeds(files: Record<string, string>): Promise<string> {
  const seedsRoot = await mkdtemp(join(tmpdir(), 'sop-ingest-test-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(seedsRoot, rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content, 'utf-8')
  }
  return seedsRoot
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

let db: TestDb

beforeAll(async () => {
  db = await createTestDb()
  clientPool = db.pool
}, 90_000)

afterAll(async () => {
  await db.teardown()
})

beforeEach(async () => {
  await db.pool.query('DELETE FROM sops')
  vi.mocked(embedContent).mockResolvedValue(UNIT_EMBEDDING)
})

// Shared seedsRoot for tests that use makeSeeds via the tracked variable.
// Tests that manage their own lifecycle (TC-SI12, TC-SI14) clean up internally.
let seedsRoot: string | undefined

afterEach(async () => {
  if (seedsRoot) {
    await rm(seedsRoot, { recursive: true, force: true })
    seedsRoot = undefined
  }
})

// ---------------------------------------------------------------------------
// TC-SI1 — empty seeds directory
// ---------------------------------------------------------------------------

describe('TC-SI1: empty seeds directory returns zero stats', () => {
  it('does not crash and returns all-zero IngestStats when no .md files exist', async () => {
    seedsRoot = await makeSeeds({})

    const stats = await runSopIngest(seedsRoot)

    expect(stats).toEqual<IngestStats>({ inserted: 0, updated: 0, skipped: 0, warned: 0, errored: 0 })
    expect(vi.mocked(embedContent)).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// TC-SI2 — draft SOP skipped (Decision 9)
// ---------------------------------------------------------------------------

describe('TC-SI2: draft SOP is skipped (Decision 9)', () => {
  it('increments skipped, does not embed or write a row', async () => {
    seedsRoot = await makeSeeds({ 'core/coding/draft.md': DRAFT_SOP })

    const stats = await runSopIngest(seedsRoot)

    expect(stats.skipped).toBe(1)
    expect(stats.inserted).toBe(0)
    expect(vi.mocked(embedContent)).not.toHaveBeenCalled()
    const { rows } = await db.pool.query('SELECT COUNT(*) AS n FROM sops')
    expect(Number(rows[0].n)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// TC-SI3 — missing frontmatter title
// ---------------------------------------------------------------------------

describe('TC-SI3: missing frontmatter title warns and skips', () => {
  it('increments warned, does not insert', async () => {
    seedsRoot = await makeSeeds({ 'core/coding/no-title.md': NO_TITLE_SOP })

    const stats = await runSopIngest(seedsRoot)

    expect(stats.warned).toBe(1)
    expect(stats.inserted).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// TC-SI4 — unrecognised category subdirectory (Decision 3)
// ---------------------------------------------------------------------------

describe('TC-SI4: unrecognised category subdirectory warns and skips (Decision 3)', () => {
  it('increments warned, does not insert', async () => {
    seedsRoot = await makeSeeds({ 'core/not-a-real-category/sop.md': VALID_SOP() })

    const stats = await runSopIngest(seedsRoot)

    expect(stats.warned).toBe(1)
    expect(stats.inserted).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// TC-SI5 — INSERT new SOP
// ---------------------------------------------------------------------------

describe('TC-SI5: INSERT new SOP with correct DB row shape', () => {
  it('inserts one row with correct category, source_namespace, content_hash, source_path', async () => {
    seedsRoot = await makeSeeds({ 'core/coding/my-sop.md': VALID_SOP('Coding SOP') })

    const stats = await runSopIngest(seedsRoot)

    expect(stats.inserted).toBe(1)
    expect(stats.updated).toBe(0)
    expect(stats.skipped).toBe(0)
    expect(vi.mocked(embedContent)).toHaveBeenCalledOnce()

    const { rows } = await db.pool.query(
      `SELECT category, source_namespace, content_hash, source_path FROM sops`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].category).toBe('Coding')
    expect(rows[0].source_namespace).toBe('core')
    expect(rows[0].content_hash).toMatch(/^[0-9a-f]{64}$/) // SHA-256 hex string
    expect(rows[0].source_path).toContain('core/coding/my-sop.md')
  })
})

// ---------------------------------------------------------------------------
// TC-SI6 — idempotency: hash skip on unchanged content (Decision 4)
// ---------------------------------------------------------------------------

describe('TC-SI6: unchanged content is skipped on second run (Decision 4)', () => {
  it('does not re-embed or re-write when content_hash is unchanged', async () => {
    seedsRoot = await makeSeeds({ 'core/coding/stable.md': VALID_SOP('Stable SOP') })

    const first = await runSopIngest(seedsRoot)
    expect(first.inserted).toBe(1)

    vi.mocked(embedContent).mockClear()

    const second = await runSopIngest(seedsRoot)
    expect(second.inserted).toBe(0)
    expect(second.updated).toBe(0)
    expect(second.skipped).toBe(1)
    expect(vi.mocked(embedContent)).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// TC-SI7 — UPDATE when content changes
// ---------------------------------------------------------------------------

describe('TC-SI7: changed content triggers UPDATE (Decision 4)', () => {
  it('updates the existing row and increments stats.updated', async () => {
    seedsRoot = await makeSeeds({ 'core/devops/changeable.md': VALID_SOP('DevOps SOP v1') })

    const first = await runSopIngest(seedsRoot)
    expect(first.inserted).toBe(1)

    // Overwrite with different content — different hash
    await writeFile(join(seedsRoot, 'core/devops/changeable.md'), VALID_SOP('DevOps SOP v2'), 'utf-8')
    vi.mocked(embedContent).mockClear()

    const second = await runSopIngest(seedsRoot)
    expect(second.updated).toBe(1)
    expect(second.inserted).toBe(0)
    expect(vi.mocked(embedContent)).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// TC-SI8 — Decision 8: fail-fast when table empty + Gemini unavailable
// ---------------------------------------------------------------------------

describe('TC-SI8: fail-fast when sops table is empty and embedContent throws (Decision 8)', () => {
  it('throws with descriptive message on fresh install with Gemini unavailable', async () => {
    vi.mocked(embedContent).mockRejectedValue(new Error('Gemini 503'))
    seedsRoot = await makeSeeds({ 'core/coding/my-sop.md': VALID_SOP() })

    await expect(runSopIngest(seedsRoot)).rejects.toThrow(
      '[sop-ingest] Gemini API unavailable and sops table is empty',
    )
  })
})

// ---------------------------------------------------------------------------
// TC-SI9 — Decision 8: warn-and-continue when sops table non-empty + Gemini unavailable
// ---------------------------------------------------------------------------

describe('TC-SI9: warn-and-continue when sops table has rows and embedContent throws (Decision 8)', () => {
  it('does not throw; increments warned and leaves existing SOPs intact', async () => {
    // Pre-seed one existing SOP so existingCount > 0
    await db.pool.query(
      `INSERT INTO sops (category, instruction, embedding, source_path, content_hash, source_namespace)
       VALUES ('Coding', 'Existing instruction', $1::vector, 'seeds/sops/core/coding/existing.md', 'aabbcc', 'core')`,
      [JSON.stringify(UNIT_EMBEDDING)],
    )

    vi.mocked(embedContent).mockRejectedValue(new Error('Gemini 503'))
    // New file — different source_path, so it's a new candidate → will try to embed → fail → warn-continue
    seedsRoot = await makeSeeds({ 'core/coding/new-sop.md': VALID_SOP('New SOP') })

    const stats = await runSopIngest(seedsRoot)

    // Must NOT throw. warned ≥ 1 because one file was skipped due to Gemini failure.
    expect(stats.warned).toBeGreaterThanOrEqual(1)
    expect(stats.errored).toBe(0)
    // The pre-seeded row must still exist
    const { rows } = await db.pool.query('SELECT COUNT(*) AS n FROM sops')
    expect(Number(rows[0].n)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// TC-SI10 — operator namespace assignment (Decision 2)
// ---------------------------------------------------------------------------

describe('TC-SI10: operator/ path sets source_namespace=operator (Decision 2)', () => {
  it('stores source_namespace="operator" for files under operator/', async () => {
    seedsRoot = await makeSeeds({ 'operator/coding/op-sop.md': VALID_SOP('Operator Coding SOP') })

    const stats = await runSopIngest(seedsRoot)

    expect(stats.inserted).toBe(1)
    const { rows } = await db.pool.query('SELECT source_namespace FROM sops')
    expect(rows[0].source_namespace).toBe('operator')
  })
})

// ---------------------------------------------------------------------------
// TC-SI11 — Decision 7: shadow check warns when operator embedding ≥ 0.92 cosine
// ---------------------------------------------------------------------------

describe('TC-SI11: operator SOP shadow check warns when cosine ≥ 0.92 (Decision 7)', () => {
  it('emits console.warn when operator embedding is near-identical to a core SOP', async () => {
    // Pre-seed a core SOP with the UNIT_EMBEDDING (cosine similarity to itself = 1.0 ≥ 0.92)
    await db.pool.query(
      `INSERT INTO sops (category, instruction, embedding, source_path, content_hash, source_namespace)
       VALUES ('Coding', 'Core SOP instruction', $1::vector, 'seeds/sops/core/coding/core.md', 'coreHash', 'core')`,
      [JSON.stringify(UNIT_EMBEDDING)],
    )

    // Operator SOP gets the same UNIT_EMBEDDING → cosine = 1.0 → shadow fires
    vi.mocked(embedContent).mockResolvedValue(UNIT_EMBEDDING)

    const warnSpy = vi.spyOn(console, 'warn')
    seedsRoot = await makeSeeds({ 'operator/coding/shadow.md': VALID_SOP('Shadow Operator SOP') })

    try {
      const stats = await runSopIngest(seedsRoot)
      expect(stats.inserted).toBe(1)

      // Shadow warning is console.warn(formatStr, sourcePath, coreSopPath, similarity)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[sop-ingest] WARN: operator SOP'),
        expect.any(String),
        expect.any(String),
        expect.any(String),
      )
    } finally {
      warnSpy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// TC-SI12 — All valid category subdirectory names map correctly (Decision 3)
// ---------------------------------------------------------------------------

describe('TC-SI12: category directory names map to canonical category strings (Decision 3)', () => {
  it.each([
    ['coding', 'Coding'],
    ['devops', 'DevOps'],
    ['qa', 'QA'],
    ['architecture', 'Architecture'],
    ['documentation', 'Documentation'],
    ['decision', 'Decision'],
  ])('dir "%s" → category "%s" in DB', async (dir, expectedCategory) => {
    const root = await makeSeeds({
      [`core/${dir}/sop.md`]: VALID_SOP(`${expectedCategory} SOP`),
    })
    try {
      await runSopIngest(root)
      const { rows } = await db.pool.query('SELECT category FROM sops')
      expect(rows[0].category).toBe(expectedCategory)
    } finally {
      await db.pool.query('DELETE FROM sops')
      await rm(root, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// TC-SI13 — replaces frontmatter field increments warned (deferred debt)
// ---------------------------------------------------------------------------

describe('TC-SI13: replaces frontmatter field logs debt warning', () => {
  it('inserts the SOP and increments warned for the deferred deprecation note', async () => {
    // 'replaces: old-sop\n' is injected before the closing --- in VALID_SOP
    seedsRoot = await makeSeeds({
      'core/coding/new-version.md': VALID_SOP('Versioned SOP', 'replaces: old-sop-v1\n'),
    })

    const stats = await runSopIngest(seedsRoot)

    expect(stats.inserted).toBe(1)
    // warned ≥ 1: the replaces debt warning fires after the insert
    expect(stats.warned).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// TC-SI14 — file read error increments errored (defensive branch)
// ---------------------------------------------------------------------------

describe('TC-SI14: unreadable file increments errored', () => {
  it('increments errored and does not crash when a .md file cannot be read', async () => {
    seedsRoot = await makeSeeds({
      'core/coding/unreadable.md': VALID_SOP('Unreadable SOP'),
    })
    const filePath = join(seedsRoot, 'core/coding/unreadable.md')
    await chmod(filePath, 0o000)

    let stats!: IngestStats
    try {
      stats = await runSopIngest(seedsRoot)
    } finally {
      // Restore permissions so afterEach rm() can clean up
      await chmod(filePath, 0o644)
    }

    expect(stats.errored).toBe(1)
    expect(stats.inserted).toBe(0)
  })
})
