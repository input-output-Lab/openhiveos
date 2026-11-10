#!/usr/bin/env tsx
/**
 * scripts/provision-agent-token.ts
 *
 * Generates and stores a new AGENT_TOKEN for a registered squad agent.
 *
 * Usage:
 *   npx tsx scripts/provision-agent-token.ts <agent-slug>              # provision / rotate
 *   npx tsx scripts/provision-agent-token.ts <agent-slug> --revoke     # deactivate agent
 *   npx tsx scripts/provision-agent-token.ts <agent-slug> --token-only # emit raw token to stdout (for scripted capture)
 *   npx tsx scripts/provision-agent-token.ts --help
 *
 * Requirements:
 *   - DATABASE_URL set in .env or environment
 *   - The agent slug must be registered in squad.manifest.json
 *   - One active Ethos Seal must exist (run one-init first)
 *
 * Behaviour:
 *   - If the agent already exists in the agents table: rotates the token
 *     (moves current token to previous_token_hash with a 1h grace window).
 *   - If the agent does not exist: inserts a new row.
 *   - Prints AGENT_TOKEN=<salt>.<secret> to stdout - this is the only time
 *     the secret is visible. Store it immediately. It cannot be recovered.
 *   - --revoke: sets active=false. Token is invalidated immediately. No DELETE
 *     (preserves audit trail - SEC-C7, ARCH-014).
 *
 * The secret never touches the database. Only the SHA-256 hash is stored.
 *
 * ARCH-008 Decision 7 - token format: <32-hex-salt>.<64-hex-secret>
 *   salt:   crypto.randomBytes(16).toString('hex')  → 32 hex chars
 *   secret: crypto.randomBytes(32).toString('hex')  → 64 hex chars (256-bit)
 *   hash:   SHA-256(salt + secret)                  → stored in agents.token_hash
 */

// Load .env before any module that reads env vars at init time
import 'dotenv/config'

import { Pool } from 'pg'

import { isValidAgentSlug, resolveAgent } from '../squad/manifest.js'
import {
  checkEthosSealGate,
  upsertAgent,
} from '../auth/upsert-agent.js'
import {
  isMacOS,
  keychainServiceName,
  readCommand,
  storeAndVerify,
} from '../auth/keychain.js'

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------
const HELP = `
Usage:
  npx tsx scripts/provision-agent-token.ts <agent-slug>
  npx tsx scripts/provision-agent-token.ts <agent-slug> --revoke
  npx tsx scripts/provision-agent-token.ts --help

Flags:
  --revoke      Deactivate the agent's token. Sets active=false in the DB.
                The row is NOT deleted - audit trail is preserved (SEC-C7).
  --token-only  Machine-readable mode. Emits the raw token value to stdout
                (one line, no surrounding text). All other output goes to
                stderr. Designed for scripted capture: TOKEN=$(... --token-only).
                Cannot be combined with --revoke.
  --keychain    S19-ARCH-01f (#2779): store the minted token in the macOS
                keychain instead of printing it (credential hygiene — keeps
                the raw token out of plaintext files/shell history). SPIKE
                2640 SCOPE: convenience, NOT a security control — any same-
                user process can read keychain items via the security CLI.
                The token is stored under service 'openhiveos' (override via
                OPENHIVE_KEYCHAIN_SERVICE), account = <agent-slug>, with
                readback verification before success is reported. Rotations
                overwrite in place. Mutually exclusive with --token-only.

Notes:
  - AGENT_TOKEN is printed to stdout once. Store it immediately.
  - If you lose the token, run this script again to rotate it.
  - For batch provisioning, use: scripts/provision-all-agents.ts --write-env <path>
    (requires PROVISION_ENV_DIR env var; see .env.example)
`

// ---------------------------------------------------------------------------
// CLI arg validation
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(HELP)
  process.exit(0)
}

const isRevoke = args.includes('--revoke')
const isTokenOnly = args.includes('--token-only')
const isKeychain = args.includes('--keychain')
const slug = args.find((a) => !a.startsWith('--'))

if (isKeychain && isTokenOnly) {
  console.error('[provision] Error: --keychain and --token-only are mutually exclusive.')
  console.error('[provision] --keychain exists so the token never needs to be captured from stdout.')
  process.exit(1)
}

if (!slug) {
  console.error('[provision] Error: agent slug is required.')
  console.error('[provision] Usage: npx tsx scripts/provision-agent-token.ts <agent-slug>')
  process.exit(1)
}

if (!isValidAgentSlug(slug)) {
  console.error(`[provision] Error: "${slug}" is not a registered agent slug.`)
  console.error('[provision] Check squad.manifest.json for valid slugs.')
  process.exit(1)
}

const agent = resolveAgent(slug)

// S19-ARCH-01f: fail early (before minting/rotating anything) if keychain
// storage was requested on a platform that cannot honor it. Prevents the
// worst outcome: token rotated, new secret nowhere to go.
if (isKeychain && !isMacOS()) {
  console.error('[provision] Error: --keychain requires macOS; this host is ' + process.platform + '.')
  console.error('[provision] Nothing was rotated — no token was minted.')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Database connection - provisioning scripts use a dedicated short-lived pool
// ---------------------------------------------------------------------------
const databaseUrl = process.env['DATABASE_URL']
if (!databaseUrl) {
  console.error('[provision] Error: DATABASE_URL environment variable is required.')
  console.error('[provision] Set it in .env or export it before running this script.')
  process.exit(1)
}

const db = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 5_000,
})

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const client = await db.connect()
try {
  // Ethos Seal gate - SEC-C5: fail-closed if no active seal or table missing.
  await checkEthosSealGate(client)

  if (isRevoke) {
    // --revoke: deactivate the agent. No DELETE - preserves audit trail (SEC-C7).
    const result = await client.query(
      `UPDATE agents SET active = false, updated_at = NOW() WHERE slug = $1 RETURNING id`,
      [slug],
    )
    if ((result.rowCount ?? 0) === 0) {
      console.warn(`[provision] Agent "${slug}" not found in the database. Nothing to revoke.`)
    } else {
      console.log(`[provision] Agent "${slug}" (${agent.name}) has been revoked.`)
      console.log('[provision] The token is immediately invalid. Row preserved for audit.')
    }
  } else {
    // Provision / rotate. forceRotate=true preserves single-agent UX:
    // running the script explicitly against one agent always rotates.
    const result = await upsertAgent(client, {
      slug,
      displayName: agent.name,
      forceRotate: true,
    })

    // upsertAgent with forceRotate=true always produces a new token - never skipped.
    // The skipped branch is unreachable here but required for type safety.
    if (result.skipped) {
      if (!isTokenOnly) {
        console.log(`[provision] Agent "${slug}" already provisioned (no rotation requested).`)
      }
    } else if (isKeychain) {
      // S19-ARCH-01f (#2779): token goes to the OS keychain, never to stdout,
      // shell history, or a plaintext file. Readback-verified before we
      // report success (the verification reads via the same OS surface a
      // consumer would use, so success proves the round trip end to end).
      const ref = { service: keychainServiceName(), account: slug }
      storeAndVerify(ref, result.token)
      console.log('[provision] Token stored successfully.')
      console.log('')
      console.log('─────────────────────────────────────────────────────────')
      console.log(`  Agent:      ${slug} (${agent.name})`)
      console.log(`  Keychain:   service='${ref.service}' account='${ref.account}'`)
      console.log('─────────────────────────────────────────────────────────')
      console.log('')
      console.log('The raw token was NOT printed. Read it back with:')
      console.log(`  ${readCommand(ref)}`)
      console.log('')
      console.log(`SPIKE-2640 reminder: this is hygiene, not security — any process`)
      console.log(`running as this user can read the item via the security CLI.`)
      console.log('To rotate, run this script again (overwrites in place).')
    } else if (isTokenOnly) {
      // Machine-readable mode: emit raw token to stdout only.
      // All diagnostic output goes to stderr to keep stdout clean for capture.
      process.stderr.write(`[provision] Token stored for ${slug} (${agent.name}).\n`)
      process.stdout.write(`${result.token}\n`)
    } else {
      console.log('[provision] Token stored successfully.')
      console.log('')
      console.log('─────────────────────────────────────────────────────────')
      console.log(`  Agent:      ${slug} (${agent.name})`)
      console.log(`  AGENT_TOKEN=${result.token}`)
      console.log('─────────────────────────────────────────────────────────')
      console.log('')
      console.log('⚠  Store this token securely. It cannot be recovered.')
      console.log('   Set it in .env as: AGENT_TOKEN=<value above>')
      console.log('   If you lose it, run this script again to rotate.')
    }
  }
} catch (err) {
  console.error('[provision] Database error:', err instanceof Error ? err.message : err)
  process.exit(1)
} finally {
  client.release()
  await db.end()
}

