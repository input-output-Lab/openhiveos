import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import matter from 'gray-matter'
import { pool } from '../db/client.js'
import { embedContent } from '../embeddings/gemini.js'

// ---------------------------------------------------------------------------
// SOP ingest runner — ARCH-009 Decisions 1–9, Sprint 8 S8-02
//
// Boot step 3.75: runs after checkEthosSeal() (Step 3.5), before
// resolveIdentity() (Step 4). Silas ruling, 2026-05-22.
//
// Reads all .md files from seeds/sops/core/ and seeds/sops/operator/,
// computes SHA-256 content hashes, and upserts rows into the sops table.
// If the hash is unchanged since last boot, the file is skipped — no
// embedding API call is made (idempotency, Decision 1).
//
// SEC-D5 (Locksmith): every SOP write logs source_path to stdout.
// Operators should review operator/ SOP content before deployment —
// adversarial SOP content is a prompt injection vector.
// ---------------------------------------------------------------------------

// ARCH-009 Decision 3 — valid category enum, mapped from subdirectory name
const CATEGORY_MAP: Readonly<Record<string, string>> = {
  coding: 'Coding',
  devops: 'DevOps',
  qa: 'QA',
  architecture: 'Architecture',
  documentation: 'Documentation',
  decision: 'Decision',
}

type SourceNamespace = 'core' | 'operator'

interface SopFrontmatter {
  title?: unknown
  status?: unknown
  replaces?: unknown
}

export interface IngestStats {
  inserted: number
  updated: number
  skipped: number
  warned: number
  errored: number
}

function computeHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

async function walkMdFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    // Directory missing (e.g. operator/ has no subdirectories yet) — not an error
    return []
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    const s = await stat(full)
    if (s.isDirectory()) {
      files.push(...(await walkMdFiles(full)))
    } else if (entry.endsWith('.md')) {
      files.push(full)
    }
  }
  return files
}

function resolveNamespaceAndCategory(
  absolutePath: string,
  sopRoot: string,
): { namespace: SourceNamespace; category: string | null } {
  // rel: e.g. "core/coding/no-hardcoded-secrets.md"
  const rel = relative(sopRoot, absolutePath)
  const parts = rel.split('/')

  // Must have at minimum: <namespace>/<category>/file.md
  if (parts.length < 3) {
    return { namespace: 'core', category: null }
  }

  const nsDir = parts[0] ?? ''
  const catDir = parts[1] ?? ''

  // ARCH-009 Decision 2: namespace is derived exclusively from directory path —
  // no frontmatter or API input can override this.
  const namespace: SourceNamespace = nsDir === 'operator' ? 'operator' : 'core'
  const category = CATEGORY_MAP[catDir.toLowerCase()] ?? null

  return { namespace, category }
}

// ARCH-009 Decision 7 — operator SOP shadow warning
async function checkShadow(
  embedding: number[],
  category: string,
  sourcePath: string,
): Promise<void> {
  const result = await pool.query<{ source_path: string; similarity: number }>(
    `SELECT source_path, 1 - (embedding <=> $1::vector) AS similarity
     FROM sops
     WHERE source_namespace = 'core'
       AND category = $2
       AND embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT 1`,
    [JSON.stringify(embedding), category],
  )
  const top = result.rows[0]
  if (top && top.similarity >= 0.92) {
    console.warn(
      '[sop-ingest] WARN: operator SOP [%s] semantically shadows core SOP [%s] ' +
        '(cosine: %s). Both will be retrieved. Review intentional? See seeds/sops/README.md.',
      sourcePath,
      top.source_path,
      top.similarity.toFixed(4),
    )
  }
}

// ---------------------------------------------------------------------------
// runSopIngest — called from src/index.ts at boot Step 3.75
//
// seedsRoot: absolute path to the seeds/sops/ directory
//   Typically: join(process.cwd(), 'seeds', 'sops')
// ---------------------------------------------------------------------------
export async function runSopIngest(seedsRoot: string): Promise<IngestStats> {
  const stats: IngestStats = { inserted: 0, updated: 0, skipped: 0, warned: 0, errored: 0 }

  const coreDir = join(seedsRoot, 'core')
  const operatorDir = join(seedsRoot, 'operator')
  const allFiles = [...(await walkMdFiles(coreDir)), ...(await walkMdFiles(operatorDir))]

  if (allFiles.length === 0) {
    console.warn('[sop-ingest] No .md files found in %s. Skipping.', seedsRoot)
    return stats
  }

  // Decision 8: pre-check — is the sops table currently populated?
  // Used to decide warn-continue vs fail-fast on Gemini unavailability.
  const countResult = await pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM sops')
  const existingCount = parseInt(countResult.rows[0]?.count ?? '0', 10)

  let geminiWarnedOnce = false

  for (const absolutePath of allFiles) {
    const { namespace, category } = resolveNamespaceAndCategory(absolutePath, seedsRoot)

    if (!category) {
      // Decision 3: unrecognised subdirectory — skip with warning
      console.warn(
        '[sop-ingest] WARN: [%s] not in a recognised category subdirectory — skipped.',
        absolutePath,
      )
      stats.warned++
      continue
    }

    let raw: string
    try {
      raw = await readFile(absolutePath, 'utf-8')
    } catch (err) {
      console.error('[sop-ingest] ERROR: Cannot read [%s]: %s', absolutePath, String(err))
      stats.errored++
      continue
    }

    const { data, content: body } = matter(raw) as { data: SopFrontmatter; content: string }

    // Decision 9: skip draft SOPs
    if (data.status === 'draft') {
      console.log('[sop-ingest] Skipping draft SOP: %s', absolutePath)
      stats.skipped++
      continue
    }

    const title = typeof data.title === 'string' ? data.title.trim() : ''
    if (!title) {
      console.warn('[sop-ingest] WARN: [%s] missing frontmatter title — skipped.', absolutePath)
      stats.warned++
      continue
    }

    // Store path relative to cwd for environment-independence
    const sourcePath = relative(process.cwd(), absolutePath)
    const contentHash = computeHash(raw)

    // Check for existing row
    const existing = await pool.query<{ id: number; content_hash: string | null }>(
      'SELECT id, content_hash FROM sops WHERE source_path = $1',
      [sourcePath],
    )
    const existingRow = existing.rows[0]

    if (existingRow?.content_hash === contentHash) {
      // Unchanged — skip embedding call
      stats.skipped++
      continue
    }

    // Embed the SOP body (not the frontmatter)
    const instruction = body.trim()
    let embedding: number[]
    try {
      embedding = await embedContent(instruction)
    } catch (err) {
      // Decision 8: Gemini unavailable
      if (existingCount === 0 && stats.inserted === 0) {
        // Fail fast: fresh install, sops table is empty, no fallback
        throw new Error(
          `[sop-ingest] Gemini API unavailable and sops table is empty. ` +
            `Agents cannot operate without a SOP foundation. Resolve API access and restart. ` +
            `Error: ${String(err)}`,
        )
      }
      // Warn-and-continue: existing SOPs remain active
      if (!geminiWarnedOnce) {
        console.warn(
          '[sop-ingest] WARN: Gemini API unavailable — SOP seed step partially skipped. ' +
            'Existing SOPs remain active. Restart to retry new/changed files.',
        )
        geminiWarnedOnce = true
      }
      stats.warned++
      continue
    }

    if (!existingRow) {
      // INSERT — SEC-D5: log source_path for every write
      await pool.query(
        `INSERT INTO sops (category, instruction, embedding, source_path, content_hash, source_namespace)
         VALUES ($1, $2, $3::vector, $4, $5, $6)`,
        [category, instruction, JSON.stringify(embedding), sourcePath, contentHash, namespace],
      )
      console.log(
        '[sop-ingest] INSERTED | source_path=%s | namespace=%s | category=%s',
        sourcePath,
        namespace,
        category,
      )
      stats.inserted++
    } else {
      // UPDATE — SEC-D5: log source_path for every write
      await pool.query(
        `UPDATE sops
         SET category = $1, instruction = $2, embedding = $3::vector,
             content_hash = $4, source_namespace = $5, updated_at = NOW()
         WHERE source_path = $6`,
        [category, instruction, JSON.stringify(embedding), contentHash, namespace, sourcePath],
      )
      console.log(
        '[sop-ingest] UPDATED  | source_path=%s | namespace=%s | category=%s',
        sourcePath,
        namespace,
        category,
      )
      stats.updated++
    }

    // Decision 7: shadow check for operator SOPs after upsert
    if (namespace === 'operator') {
      await checkShadow(embedding, category, sourcePath)
    }

    // Decision 9: replaces field — mark superseded SOP as deprecated
    // Note: the sops table has no status column yet. This is named debt.
    // Logged here; implementation deferred to the migration that adds sops.status.
    if (typeof data.replaces === 'string' && data.replaces.trim()) {
      console.warn(
        '[sop-ingest] WARN: replaces=%s noted but sops.status column does not exist. ' +
          'Deprecation is deferred. File a migration to add sops.status TEXT.',
        data.replaces,
      )
      stats.warned++
    }
  }

  console.log(
    '[sop-ingest] Done — inserted=%d updated=%d skipped=%d warned=%d errored=%d',
    stats.inserted,
    stats.updated,
    stats.skipped,
    stats.warned,
    stats.errored,
  )

  return stats
}
