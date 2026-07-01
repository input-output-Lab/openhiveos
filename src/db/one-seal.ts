import { readFile } from 'node:fs/promises'
import { timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'
import { pool } from './client.js'

// ---------------------------------------------------------------------------
// checkOneSeal — ARCH-025 Boot Step 3.6
//
// Verifies that the exported One Seal file (one.seal.json) is consistent
// with the active seal record in the database. Called immediately after
// checkEthosSeal() (Step 3.5) in the boot sequence.
//
// Protects The One's operational protocols (spawn-protocol and agent-outline
// SOPs) from being tampered with in the database.
//
// Comparison: DB one_seals.signature vs file .hmac, using timingSafeEqual.
// Both fields are HMAC-SHA256 hex strings (computed at provisioning time by
// scripts/one-init.ts). The MCP server does NOT re-derive the HMAC at runtime
// (ONE_SEAL_SECRET is not required by this function — Locksmith SEC-B ruling).
//
// Failure modes (all call process.exit(1) — SEC-B8: no degraded mode):
//   - ONE_SEAL_PATH file not found  → "Run one-init to initialise"
//   - File is not valid JSON        → "Seal file is corrupt — run one-init --revise"
//   - No active row in one_seals    → "Run one-init to initialise"
//   - Signature mismatch            → "One protocol drift detected — run one-init --revise"
//
// Schema: migrations/021_one_seal.sql (ARCH-025)
// ---------------------------------------------------------------------------

interface OneSealFileRecord {
  hmac: string
  [key: string]: unknown
}

interface ActiveOneSealRow {
  signature: string
}

function isOneSealFileRecord(value: unknown): value is OneSealFileRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'hmac' in value &&
    typeof (value as Record<string, unknown>)['hmac'] === 'string'
  )
}

export async function checkOneSeal(): Promise<void> {
  const sealPath = config.ONE_SEAL_PATH

  // --- Step A: Read the exported seal file ---
  let fileRecord: OneSealFileRecord
  try {
    const raw = await readFile(sealPath, { encoding: 'utf-8' })
    const parsed: unknown = JSON.parse(raw)
    if (!isOneSealFileRecord(parsed)) {
      console.error(
        '[one-seal] Seal file at %s is missing the "hmac" field. ' +
          'Run: npx tsx src/scripts/one-init.ts --revise',
        sealPath,
      )
      process.exit(1)
    }
    fileRecord = parsed
  } catch (err) {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      console.error(
        '[one-seal] Seal file not found at %s. ' +
          "The One's protocols have not been sealed. " +
          'Run: npx tsx src/scripts/one-init.ts',
        sealPath,
      )
    } else if (err instanceof SyntaxError) {
      console.error(
        '[one-seal] Seal file at %s contains invalid JSON. ' +
          'The file may be corrupt. Run: npx tsx src/scripts/one-init.ts --revise',
        sealPath,
      )
    } else {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[one-seal] Failed to read seal file at %s: %s', sealPath, message)
    }
    process.exit(1)
  }

  // --- Step B: Query the active seal from the database ---
  let dbRow: ActiveOneSealRow | undefined
  try {
    const result = await pool.query<ActiveOneSealRow>(
      `SELECT signature FROM one_seals WHERE is_active = TRUE LIMIT 1`,
    )
    dbRow = result.rows[0]
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[one-seal] Failed to query one_seals: %s', message)
    process.exit(1)
  }

  if (!dbRow) {
    console.error(
      '[one-seal] No active One Seal found in the database. ' +
        "The One's protocols have not been sealed. " +
        'Run: npx tsx src/scripts/one-init.ts',
    )
    process.exit(1)
  }

  // --- Step C: Compare signatures using timingSafeEqual (SEC-B6 / SEC-C6) ---
  const dbSig = Buffer.from(dbRow.signature, 'hex')
  const fileSig = Buffer.from(fileRecord.hmac, 'hex')

  if (dbSig.length !== fileSig.length || !timingSafeEqual(dbSig, fileSig)) {
    console.error(
      '[one-seal] One protocol drift detected: the signature in %s does not match ' +
        'the active record in one_seals. The seal file or the database record may ' +
        'have been modified outside of one-init.ts. ' +
        'To recover: run npx tsx src/scripts/one-init.ts --revise',
      sealPath,
    )
    process.exit(1)
  }

  console.error('[one-seal] One Seal verified — boot continuing')
}

// ---------------------------------------------------------------------------
// Type guard for Node.js filesystem errors
// ---------------------------------------------------------------------------
function isErrnoException(err: unknown): err is Error & { code?: string } {
  return err instanceof Error && 'code' in err
}
