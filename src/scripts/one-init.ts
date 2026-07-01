#!/usr/bin/env tsx
/**
 * scripts/one-init.ts
 *
 * Operator-facing CLI for initialising and revising the Ethos Seal.
 *
 * The Ethos Seal is a cryptographically-signed record of the operator's
 * declared Squad intent — who the agents are, their roles, and the Squad
 * identity. It is stored in the database and exported to a file on disk.
 * The MCP server refuses to start if the seal is absent or invalid.
 *
 * Usage:
 *   npx tsx scripts/one-init.ts              # first-time initialisation
 *   npx tsx scripts/one-init.ts --revise     # revise an existing seal
 *
 * Required environment variables:
 *   DATABASE_URL        — PostgreSQL connection string
 *   ETHOS_SEAL_SECRET   — 32-byte hex HMAC key (64 hex chars)
 *                         Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *   ETHOS_SEAL_PATH     — Absolute path for the seal file (e.g. /run/secrets/ethos.seal.json)
 *
 * The seal payload is derived from squad.manifest.json. Never edit the seal
 * file directly — always use this script to revise.
 *
 * --revise path uses SERIALIZABLE isolation to atomically replace the seal.
 * If a concurrent revision occurs, the transaction is retried up to 3 times.
 *
 * ARCH-013 B4 — schema per Silas ruling #1356 (2026-05-21):
 *   UNIQUE partial index (WHERE is_active = TRUE) — see migrations/004_ethos_seal.sql.
 */

// Load .env before anything that reads env vars at init time
import 'dotenv/config'

import { createHash, createHmac } from 'node:crypto'
import { writeFile, rename, mkdir, readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { dirname, join, resolve } from 'node:path'

import { Pool } from 'pg'
import type { PoolClient } from 'pg'

import { manifest } from '../squad/manifest.js'

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const isRevise = process.argv.includes('--revise')

// ---------------------------------------------------------------------------
// Environment validation — scripts validate inline, not via src/config.ts
// (config.ts requires AGENT_TOKEN which operators don't set before one-init)
// ---------------------------------------------------------------------------
const DATABASE_URL = process.env['DATABASE_URL']
const ETHOS_SEAL_SECRET = process.env['ETHOS_SEAL_SECRET']
const ETHOS_SEAL_PATH = process.env['ETHOS_SEAL_PATH']

if (!DATABASE_URL) {
  console.error('[one-init] Error: DATABASE_URL is required.')
  process.exit(1)
}
if (!ETHOS_SEAL_SECRET) {
  console.error('[one-init] Error: ETHOS_SEAL_SECRET is required.')
  console.error('[one-init] Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
  process.exit(1)
}
if (!/^[\da-f]{64}$/i.test(ETHOS_SEAL_SECRET)) {
  console.error('[one-init] Error: ETHOS_SEAL_SECRET must be exactly 64 hex characters (32 bytes).')
  process.exit(1)
}
if (!ETHOS_SEAL_PATH) {
  console.error('[one-init] Error: ETHOS_SEAL_PATH is required.')
  process.exit(1)
}

// Narrow to string for downstream use after validation
const sealSecret: string = ETHOS_SEAL_SECRET
const sealPath: string = resolve(ETHOS_SEAL_PATH)

// ---------------------------------------------------------------------------
// One Seal env vars (ARCH-025)
// ONE_SEAL_SECRET: separate 32-byte hex key — must NOT equal ETHOS_SEAL_SECRET (SEC-C1)
// ONE_SEAL_PATH: file path for the exported one.seal.json (default: ./one.seal.json)
// ---------------------------------------------------------------------------
const ONE_SEAL_SECRET = process.env['ONE_SEAL_SECRET']
const ONE_SEAL_PATH = process.env['ONE_SEAL_PATH']

if (!ONE_SEAL_SECRET) {
  console.error('[one-init] Error: ONE_SEAL_SECRET is required.')
  console.error('[one-init] Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
  process.exit(1)
}
if (!/^[\da-f]{64}$/i.test(ONE_SEAL_SECRET)) {
  console.error('[one-init] Error: ONE_SEAL_SECRET must be exactly 64 hex characters (32 bytes).')
  process.exit(1)
}
if (ONE_SEAL_SECRET === ETHOS_SEAL_SECRET) {
  console.error('[one-init] Error: ONE_SEAL_SECRET must not equal ETHOS_SEAL_SECRET (SEC-C1).')
  process.exit(1)
}
if (!ONE_SEAL_PATH) {
  console.error('[one-init] Error: ONE_SEAL_PATH is required.')
  process.exit(1)
}

const oneSealSecret: string = ONE_SEAL_SECRET
const oneSealPath: string = resolve(ONE_SEAL_PATH)

// ---------------------------------------------------------------------------
// Company identity env vars (ARCH-018 S8-03)
// All five must be set, or all five must be absent. Partial config is rejected.
// SEC-D7: COMPANY_VALUES is parsed from comma-separated string — strip
// surrounding quotes from each entry, reject empty strings after trim.
// ---------------------------------------------------------------------------
const COMPANY_NAME = process.env['COMPANY_NAME']
const COMPANY_MISSION = process.env['COMPANY_MISSION']
const COMPANY_3YEAR = process.env['COMPANY_3YEAR']
const COMPANY_VALUES = process.env['COMPANY_VALUES']
const COMPANY_NICHE = process.env['COMPANY_NICHE']

const companyVarsSet = [COMPANY_NAME, COMPANY_MISSION, COMPANY_3YEAR, COMPANY_VALUES, COMPANY_NICHE].filter(Boolean).length

let companyEthos: CompanyEthos | undefined

if (companyVarsSet === 5) {
  // SEC-D7: split on comma, trim whitespace, strip surrounding single/double quotes,
  // then reject any entry that is empty after processing.
  const rawValues = (COMPANY_VALUES ?? '').split(',')
    .map((v) => v.trim().replace(/^["']|["']$/g, ''))
    .filter((v) => v.length > 0)
  if (rawValues.length === 0) {
    console.error('[one-init] Error: COMPANY_VALUES contains no valid entries after parsing (SEC-D7).')
    console.error('[one-init] Provide at least one non-empty value, e.g.: COMPANY_VALUES="Radical transparency,Systems thinking"')
    process.exit(1)
  }
  // Keys in canonical alphabetical order per ARCH-018: mission, name, niche, three_year_picture, values
  companyEthos = {
    mission: COMPANY_MISSION ?? '',
    name: COMPANY_NAME ?? '',
    niche: COMPANY_NICHE ?? '',
    three_year_picture: COMPANY_3YEAR ?? '',
    values: rawValues,
  }
} else if (companyVarsSet > 0) {
  console.error('[one-init] Error: Partial company configuration detected.')
  console.error('[one-init] All five COMPANY_* env vars must be set together, or all must be absent.')
  console.error('[one-init] Missing:', ['COMPANY_NAME', 'COMPANY_MISSION', 'COMPANY_3YEAR', 'COMPANY_VALUES', 'COMPANY_NICHE']
    .filter((k) => !process.env[k])
    .join(', '))
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Company identity block — ARCH-018 S8-03.
 * All five fields required when the block is present. Absent = unconfigured.
 * Keys defined in canonical (alphabetical) order: mission, name, niche, three_year_picture, values.
 */
interface CompanyEthos {
  mission: string
  name: string
  niche: string
  three_year_picture: string
  values: string[]
}

interface EthosSealPayload {
  squad: string
  manifestVersion: string
  agents: Array<{ slug: string; name: string; role: string }>
  initialisedAt: string  // ISO 8601
  company?: CompanyEthos  // ARCH-018 S8-03 — optional company identity extension
  // version is NOT in the payload — it is derived inside the DB transaction
  // (COALESCE(MAX(version), 0) + 1) and stored as a separate column.
}

interface EthosSealRecord {
  payload: EthosSealPayload
  hmac: string
}

// ---------------------------------------------------------------------------
// One Seal types (ARCH-025)
// ---------------------------------------------------------------------------

/** Canonical input for the One Seal HMAC. Keys sorted alphabetically. */
interface OneSealInput {
  agentOutline: string
  spawnProtocol: string
}

interface OneSealRecord {
  hmac: string
  sealedAt: string
}

// ---------------------------------------------------------------------------
// HMAC helpers
// ---------------------------------------------------------------------------

/**
 * Deep-stable JSON serialisation — all object keys sorted alphabetically at every level.
 * ARCH-018: company sub-keys must be sorted deterministically for HMAC computation.
 * Canonical order for company: [mission, name, niche, three_year_picture, values].
 *
 * NOTE: checkEthosSeal() uses stored-vs-stored comparison (not re-derivation), so
 * updating this function does not affect boot verification for existing seals.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']'
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    const parts = keys.map(
      (k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`,
    )
    return '{' + parts.join(',') + '}'
  }
  return JSON.stringify(value)
}

/** Stable canonical JSON — all keys sorted recursively for deterministic serialisation. */
function canonicalise(payload: EthosSealPayload): string {
  return stableStringify(payload)
}

/** HMAC-SHA256(canonical_json, ETHOS_SEAL_SECRET) — stored in ethos_seals.signature. */
function computeHmac(payload: EthosSealPayload): string {
  return createHmac('sha256', sealSecret).update(canonicalise(payload)).digest('hex')
}

/** SHA-256(canonical_json) — stored in ethos_seals.payload_hash. No key required. */
function computePayloadHash(payload: EthosSealPayload): string {
  return createHash('sha256').update(canonicalise(payload)).digest('hex')
}

/** HMAC-SHA256(stableStringify(input), ONE_SEAL_SECRET) — stored in one_seals.signature. */
function computeOneSealHmac(input: OneSealInput): string {
  return createHmac('sha256', oneSealSecret).update(stableStringify(input)).digest('hex')
}

// ---------------------------------------------------------------------------
// Atomic file export
// Writes to a temp file then renames — rename is atomic on POSIX systems.
// Prevents a partial write being read by checkEthosSeal() at boot.
// ---------------------------------------------------------------------------
async function exportSealFile(record: EthosSealRecord): Promise<void> {
  const dir = dirname(sealPath)
  await mkdir(dir, { recursive: true })

  const tmp = `${sealPath}.tmp`
  await writeFile(tmp, JSON.stringify(record, null, 2), { encoding: 'utf-8', mode: 0o600 })
  await rename(tmp, sealPath)
  console.log(`[one-init] Seal file written to ${sealPath}`)
}

async function exportOneSealFile(record: OneSealRecord): Promise<void> {
  const dir = dirname(oneSealPath)
  await mkdir(dir, { recursive: true })

  const tmp = `${oneSealPath}.tmp`
  await writeFile(tmp, JSON.stringify(record, null, 2), { encoding: 'utf-8', mode: 0o600 })
  await rename(tmp, oneSealPath)
  console.log(`[one-init] One Seal file written to ${oneSealPath}`)
}

// ---------------------------------------------------------------------------
// One Seal database operations (ARCH-025)
// Schema: 021_one_seal.sql — UNIQUE partial index (WHERE is_active = TRUE)
// ---------------------------------------------------------------------------

async function insertOneSeal(client: PoolClient, hmac: string): Promise<void> {
  await client.query(
    `INSERT INTO one_seals (signature, sealed_at, sealed_by, is_active)
     VALUES ($1, NOW(), 'cli:init', TRUE)`,
    [hmac],
  )
}

async function reviseOneSeal(client: PoolClient, hmac: string): Promise<void> {
  await client.query(`UPDATE one_seals SET is_active = FALSE WHERE is_active = TRUE`)
  await client.query(
    `INSERT INTO one_seals (signature, sealed_at, sealed_by, is_active)
     VALUES ($1, NOW(), 'cli:revise', TRUE)`,
    [hmac],
  )
}

// ---------------------------------------------------------------------------
// Read One SOP seed files for HMAC computation
// Paths relative to project root (process.cwd() when running via npm/tsx)
// ---------------------------------------------------------------------------
async function readOneSopFiles(): Promise<OneSealInput> {
  const root = process.cwd()
  const agentOutlinePath = join(root, 'seeds', 'sops', 'core', 'architecture', 'one-agent-outline.md')
  const spawnProtocolPath = join(root, 'seeds', 'sops', 'core', 'architecture', 'one-spawn-protocol.md')

  let agentOutline: string
  let spawnProtocol: string

  try {
    agentOutline = await readFile(agentOutlinePath, 'utf-8')
  } catch {
    console.error('[one-init] Error: One SOP file not found: %s', agentOutlinePath)
    console.error('[one-init] Ensure seeds/sops/core/architecture/one-agent-outline.md exists before running one-init.')
    process.exit(1)
  }

  try {
    spawnProtocol = await readFile(spawnProtocolPath, 'utf-8')
  } catch {
    console.error('[one-init] Error: One SOP file not found: %s', spawnProtocolPath)
    console.error('[one-init] Ensure seeds/sops/core/architecture/one-spawn-protocol.md exists before running one-init.')
    process.exit(1)
  }

  // Keys in alphabetical order (stableStringify will sort, but explicit here for clarity)
  return { agentOutline, spawnProtocol }
}

// ---------------------------------------------------------------------------
// Readline confirmation
// ---------------------------------------------------------------------------
async function confirmWithOperator(payload: EthosSealPayload): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  console.log('')
  console.log('─────────────────────────────────────────────────────────')
  console.log('  ETHOS SEAL — Squad Identity Declaration')
  console.log('─────────────────────────────────────────────────────────')
  console.log(`  Squad:    ${payload.squad}`)
  console.log(`  Agents:   ${payload.agents.map((a) => a.slug).join(', ')}`)
  if (payload.company !== undefined) {
    console.log(`  Company:  ${payload.company.name}`)
    console.log(`  Mission:  ${payload.company.mission}`)
    console.log(`  Values:   ${payload.company.values.join(' | ')}`)
  }
  console.log(`  Mode:     ${isRevise ? '--revise (replaces active seal)' : 'first init'}`)
  console.log('─────────────────────────────────────────────────────────')
  console.log('')

  return new Promise<boolean>((resolve) => {
    rl.question('  Confirm seal? [y/N] ', (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'y')
    })
  })
}

// ---------------------------------------------------------------------------
// SERIALIZABLE transaction wrapper
//
// Retries the transaction on serialization failure (Postgres error 40001).
// The retry loop wraps only the DB transaction — not the full handler.
// Reading stdin, computing the payload, and prompting the operator all happen
// before this function is called. Only the DB write is retried.
//
// maxRetries: 3 is sufficient for the --revise path. Concurrent revisions
// are operationally impossible (one operator, one CLI) but we handle it
// correctly regardless.
// ---------------------------------------------------------------------------
const SERIALIZATION_FAILURE = '40001'

async function withSerializableRetry(
  client: PoolClient,
  fn: (client: PoolClient) => Promise<void>,
  maxRetries = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
      await fn(client)
      await client.query('COMMIT')
      return
    } catch (err: unknown) {
      await client.query('ROLLBACK')

      const isSerializationFailure =
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === SERIALIZATION_FAILURE

      if (isSerializationFailure && attempt < maxRetries) {
        console.warn(`[one-init] Serialization conflict on attempt ${String(attempt)} — retrying...`)
        continue
      }

      throw err
    }
  }
}

// ---------------------------------------------------------------------------
// Database operations
// Schema: 004_ethos_seal.sql — UNIQUE partial index (WHERE is_active = TRUE)
// Silas ruling #1356, 2026-05-21. See migrations/004_ethos_seal.sql.
// ---------------------------------------------------------------------------

/**
 * Derives the next version number inside the current transaction.
 * Must be called within an open transaction — safe under SERIALIZABLE.
 * First init: COALESCE(MAX(version), 0) + 1 = 1.
 */
async function deriveNextVersion(client: PoolClient): Promise<number> {
  const result = await client.query<{ next_version: string }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM ethos_seals`,
  )
  const row = result.rows[0]
  if (!row) throw new Error('[one-init] Failed to derive next version — no result from MAX query')
  return parseInt(row.next_version, 10)
}

/** First-time initialisation path. No existing active seal. */
async function insertSeal(client: PoolClient, payload: EthosSealPayload, hmac: string): Promise<void> {
  const payloadHash = computePayloadHash(payload)
  const version = await deriveNextVersion(client)
  await client.query(
    `INSERT INTO ethos_seals
       (version, payload, signature, payload_hash, is_active, activated_at, activated_by)
     VALUES ($1, $2, $3, $4, TRUE, NOW(), 'cli:init')`,
    [version, JSON.stringify(payload), hmac, payloadHash],
  )
}

/**
 * --revise path. Runs inside a SERIALIZABLE transaction (via withSerializableRetry).
 * Deactivates the current active seal, inserts the new one.
 * The UNIQUE partial index (WHERE is_active = TRUE) ensures that if two concurrent
 * revisions race, one will fail with serialization error 40001 and retry.
 */
async function reviseSeal(client: PoolClient, payload: EthosSealPayload, hmac: string): Promise<void> {
  const payloadHash = computePayloadHash(payload)
  const version = await deriveNextVersion(client)
  // Deactivate current active seal (may be 0 rows on a fresh DB — that is fine).
  await client.query(`UPDATE ethos_seals SET is_active = FALSE WHERE is_active = TRUE`)
  await client.query(
    `INSERT INTO ethos_seals
       (version, payload, signature, payload_hash, is_active, activated_at, activated_by)
     VALUES ($1, $2, $3, $4, TRUE, NOW(), 'cli:revise')`,
    [version, JSON.stringify(payload), hmac, payloadHash],
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const db = new Pool({
  connectionString: DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 5_000,
})

async function main(): Promise<void> {
  // Build the payload from the squad manifest.
  // company is included when all five COMPANY_* env vars are set (ARCH-018 S8-03).
  const payload: EthosSealPayload = {
    squad: manifest.squad,
    manifestVersion: manifest.version,
    agents: manifest.agents.map((a) => ({ slug: a.slug, name: a.name, role: a.role })),
    initialisedAt: new Date().toISOString(),
    // version is derived inside the SERIALIZABLE transaction — not pre-computed here.
    ...(companyEthos !== undefined ? { company: companyEthos } : {}),
  }

  if (companyEthos !== undefined) {
    console.log(`[one-init] Company context will be included in the seal (ARCH-018).`)
  }

  const confirmed = await confirmWithOperator(payload)
  if (!confirmed) {
    console.log('[one-init] Aborted.')
    process.exit(0)
  }

  const hmac = computeHmac(payload)
  const record: EthosSealRecord = { payload, hmac }

  const client = await db.connect()
  try {
    if (isRevise) {
      await withSerializableRetry(client, (c) => reviseSeal(c, payload, hmac))
      console.log('[one-init] Seal revised successfully.')
    } else {
      await client.query('BEGIN')
      await insertSeal(client, payload, hmac)
      await client.query('COMMIT')
      console.log('[one-init] Seal initialised successfully.')
    }

    await exportSealFile(record)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('[one-init] Error:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  } finally {
    client.release()
  }

  // ---------------------------------------------------------------------------
  // One Seal initialisation (ARCH-025) — runs after Ethos Seal, same CLI run.
  // Reads the two One SOP seed files, computes HMAC, stores in one_seals,
  // and exports one.seal.json. Uses a separate DB client (separate connection).
  // ---------------------------------------------------------------------------
  console.log('')
  console.log('[one-init] Initialising One Seal (ARCH-025)...')

  const sopInput = await readOneSopFiles()
  const oneSealHmac = computeOneSealHmac(sopInput)
  const oneSealRecord: OneSealRecord = { hmac: oneSealHmac, sealedAt: new Date().toISOString() }

  const oneClient = await db.connect()
  try {
    if (isRevise) {
      await withSerializableRetry(oneClient, (c) => reviseOneSeal(c, oneSealHmac))
      console.log('[one-init] One Seal revised successfully.')
    } else {
      await oneClient.query('BEGIN')
      await insertOneSeal(oneClient, oneSealHmac)
      await oneClient.query('COMMIT')
      console.log('[one-init] One Seal initialised successfully.')
    }

    await exportOneSealFile(oneSealRecord)
  } catch (err) {
    await oneClient.query('ROLLBACK').catch(() => undefined)
    console.error('[one-init] One Seal error:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  } finally {
    oneClient.release()
  }
}

main().catch((err: unknown) => {
  console.error('[one-init] Fatal:', err instanceof Error ? err.message : String(err))
  process.exit(1)
}).finally(() => {
  db.end().catch(() => undefined)
})
