import { readFile } from 'node:fs/promises'
import { timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'
import { pool } from './client.js'

// ---------------------------------------------------------------------------
// checkEthosSeal — ARCH-013 Boot Step 3.5
//
// Verifies that the exported Ethos Seal file (ethos.seal.json) is consistent
// with the active seal record in the database. Called between Step 3
// (fingerprint check) and Step 4 (identity resolution) in the boot sequence.
//
// Comparison: DB ethos_seals.signature vs file .hmac, using timingSafeEqual.
// Both fields are HMAC-SHA256 hex strings (computed at provisioning time by
// scripts/one-init.ts). The MCP server does NOT re-derive the HMAC at runtime
// (ETHOS_SEAL_SECRET is not required by this function — Locksmith SEC-B ruling).
//
// Failure modes (all call process.exit(1) — SEC-B8: no degraded mode):
//   - ETHOS_SEAL_PATH file not found    → "Run one-init to initialise"
//   - File is not valid JSON            → "Seal file is corrupt — run one-init --revise"
//   - No active row in ethos_seals      → "Run one-init to initialise"
//   - Signature mismatch                → "Seal drift detected — run one-init --revise"
//
// Schema: migrations/004_ethos_seal.sql (Silas ruling #1356, 2026-05-21)
// ---------------------------------------------------------------------------

interface SealFileRecord {
  hmac: string
  [key: string]: unknown
}

interface ActiveSealRow {
  signature: string
}

function isSealFileRecord(value: unknown): value is SealFileRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'hmac' in value &&
    typeof (value as Record<string, unknown>)['hmac'] === 'string'
  )
}

export async function checkEthosSeal(): Promise<void> {
  const sealPath = config.ETHOS_SEAL_PATH

  // --- Step A: Read the exported seal file ---
  let fileRecord: SealFileRecord
  try {
    const raw = await readFile(sealPath, { encoding: 'utf-8' })
    const parsed: unknown = JSON.parse(raw)
    if (!isSealFileRecord(parsed)) {
      console.error(
        '[ethos-seal] Seal file at %s is missing the "hmac" field. ' +
          'Run: npx tsx scripts/one-init.ts --revise',
        sealPath,
      )
      process.exit(1)
    }
    fileRecord = parsed
  } catch (err) {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      console.error(
        '[ethos-seal] Seal file not found at %s. ' +
          'This OpenHiveOS instance has not been initialised. ' +
          'Run: npx tsx scripts/one-init.ts',
        sealPath,
      )
    } else if (err instanceof SyntaxError) {
      console.error(
        '[ethos-seal] Seal file at %s contains invalid JSON. ' +
          'The file may be corrupt. Run: npx tsx scripts/one-init.ts --revise',
        sealPath,
      )
    } else {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[ethos-seal] Failed to read seal file at %s: %s', sealPath, message)
    }
    process.exit(1)
  }

  // --- Step B: Query the active seal from the database ---
  let dbRow: ActiveSealRow | undefined
  try {
    const result = await pool.query<ActiveSealRow>(
      `SELECT signature FROM ethos_seals WHERE is_active = TRUE LIMIT 1`,
    )
    dbRow = result.rows[0]
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[ethos-seal] Failed to query ethos_seals: %s', message)
    process.exit(1)
  }

  if (!dbRow) {
    console.error(
      '[ethos-seal] No active Ethos Seal found in the database. ' +
        'This OpenHiveOS instance has not been initialised. ' +
        'Run: npx tsx scripts/one-init.ts',
    )
    process.exit(1)
  }

  // --- Step C: Compare signatures using timingSafeEqual (SEC-B6) ---
  const dbSig = Buffer.from(dbRow.signature, 'hex')
  const fileSig = Buffer.from(fileRecord.hmac, 'hex')

  if (dbSig.length !== fileSig.length || !timingSafeEqual(dbSig, fileSig)) {
    console.error(
      '[ethos-seal] Seal drift detected: the signature in %s does not match ' +
        'the active record in ethos_seals. The seal file may have been modified ' +
        'outside of one-init.ts, or a revision was committed to the database ' +
        'without updating the file. ' +
        'To recover: run npx tsx scripts/one-init.ts --revise',
      sealPath,
    )
    process.exit(1)
  }

  console.log('[ethos-seal] Ethos Seal verified — boot continuing')
}

// ---------------------------------------------------------------------------
// Type guard for Node.js filesystem errors
// ---------------------------------------------------------------------------
function isErrnoException(err: unknown): err is Error & { code?: string } {
  return err instanceof Error && 'code' in err
}
