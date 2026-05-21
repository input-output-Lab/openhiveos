#!/usr/bin/env tsx
/**
 * scripts/provision-agent-token.ts
 *
 * Generates and stores a new AGENT_TOKEN for a registered squad agent.
 *
 * Usage:
 *   npx tsx scripts/provision-agent-token.ts <agent-slug>              # provision / rotate
 *   npx tsx scripts/provision-agent-token.ts <agent-slug> --revoke     # deactivate agent
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

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------
const HELP = `
Usage:
  npx tsx scripts/provision-agent-token.ts <agent-slug>
  npx tsx scripts/provision-agent-token.ts <agent-slug> --revoke
  npx tsx scripts/provision-agent-token.ts --help

Flags:
  --revoke  Deactivate the agent's token. Sets active=false in the DB.
            The row is NOT deleted - audit trail is preserved (SEC-C7).

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
const slug = args.find((a) => !a.startsWith('--'))

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
      console.log(`[provision] Agent "${slug}" already provisioned (no rotation requested).`)
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

