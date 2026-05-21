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

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { writeFile, rename, mkdir } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { dirname, resolve } from 'node:path'

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
// Types
// ---------------------------------------------------------------------------
interface EthosSealPayload {
  squad: string
  manifestVersion: string
  agents: Array<{ slug: string; name: string; role: string }>
  initialisedAt: string  // ISO 8601
  // version is NOT in the payload — it is derived inside the DB transaction
  // (COALESCE(MAX(version), 0) + 1) and stored as a separate column.
}

interface EthosSealRecord {
  payload: EthosSealPayload
  hmac: string
}

// ---------------------------------------------------------------------------
// HMAC helpers
// ---------------------------------------------------------------------------
/** Stable canonical JSON — keys sorted for deterministic serialisation. */
function canonicalise(payload: EthosSealPayload): string {
  return JSON.stringify(payload, Object.keys(payload).sort() as (keyof EthosSealPayload)[])
}

/** HMAC-SHA256(canonical_json, ETHOS_SEAL_SECRET) — stored in ethos_seals.signature. */
function computeHmac(payload: EthosSealPayload): string {
  return createHmac('sha256', sealSecret).update(canonicalise(payload)).digest('hex')
}

/** SHA-256(canonical_json) — stored in ethos_seals.payload_hash. No key required. */
function computePayloadHash(payload: EthosSealPayload): string {
  return createHash('sha256').update(canonicalise(payload)).digest('hex')
}

function verifyHmac(record: EthosSealRecord): boolean {
  const expected = Buffer.from(computeHmac(record.payload), 'hex')
  const actual = Buffer.from(record.hmac, 'hex')
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
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
        console.warn(`[one-init] Serialization conflict on attempt ${attempt} — retrying...`)
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
  // Build the payload from the squad manifest
  const payload: EthosSealPayload = {
    squad: manifest.squad,
    manifestVersion: manifest.version,
    agents: manifest.agents.map((a) => ({ slug: a.slug, name: a.name, role: a.role })),
    initialisedAt: new Date().toISOString(),
    // version is derived inside the SERIALIZABLE transaction — not pre-computed here.
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
}

main().catch((err: unknown) => {
  console.error('[one-init] Fatal:', err instanceof Error ? err.message : String(err))
  process.exit(1)
}).finally(() => {
  db.end().catch(() => undefined)
})
