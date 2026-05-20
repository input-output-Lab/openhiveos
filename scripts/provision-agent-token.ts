#!/usr/bin/env tsx
/**
 * scripts/provision-agent-token.ts
 *
 * Generates and stores a new AGENT_TOKEN for a registered squad agent.
 *
 * Usage:
 *   npx tsx scripts/provision-agent-token.ts <agent-slug>
 *
 * Requirements:
 *   - DATABASE_URL set in .env or environment
 *   - The agent slug must be registered in squad.manifest.json
 *
 * Behaviour:
 *   - If the agent already exists in the agents table: rotates the token
 *     (moves current token to previous_token_hash with a 1h grace window).
 *   - If the agent does not exist: inserts a new row.
 *   - Prints AGENT_TOKEN=<salt>.<secret> to stdout — this is the only time
 *     the secret is visible. Store it immediately. It cannot be recovered.
 *
 * The secret never touches the database. Only the SHA-256 hash is stored.
 *
 * ARCH-008 Decision 7 — token format: <32-hex-salt>.<64-hex-secret>
 *   salt:   crypto.randomBytes(16).toString('hex')  → 32 hex chars
 *   secret: crypto.randomBytes(32).toString('hex')  → 64 hex chars (256-bit)
 *   hash:   SHA-256(salt + secret)                  → stored in agents.token_hash
 */

// Load .env before any module that reads env vars at init time
import 'dotenv/config'

import { createHash, randomBytes } from 'node:crypto'
import { Pool } from 'pg'

// ---------------------------------------------------------------------------
// Squad manifest — load directly to avoid importing the full server stack
// ---------------------------------------------------------------------------
import { isValidAgentSlug, resolveAgent } from '../src/squad/manifest.js'

// ---------------------------------------------------------------------------
// CLI arg validation
// ---------------------------------------------------------------------------
const slug = process.argv[2]
if (!slug) {
  console.error('Usage: npx tsx scripts/provision-agent-token.ts <agent-slug>')
  console.error('Example: npx tsx scripts/provision-agent-token.ts murphy')
  process.exit(1)
}

if (!isValidAgentSlug(slug)) {
  console.error(`[provision] Error: "${slug}" is not a registered agent slug.`)
  console.error('[provision] Check squad.manifest.json for valid slugs.')
  process.exit(1)
}

const agent = resolveAgent(slug)

// ---------------------------------------------------------------------------
// Database connection — provisioning scripts use a dedicated short-lived pool
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
// Token generation
// ---------------------------------------------------------------------------
const salt = randomBytes(16).toString('hex')    // 32 hex chars
const secret = randomBytes(32).toString('hex')  // 64 hex chars — 256-bit entropy
const tokenHash = createHash('sha256').update(salt + secret).digest('hex')
const agentToken = `${salt}.${secret}`

// ---------------------------------------------------------------------------
// Persist — upsert with grace-period rotation
// ---------------------------------------------------------------------------
// On rotation: the current token moves to previous_token_hash with a 1h
// expiry window so in-flight connections can finish without error.
const upsertSql = `
  INSERT INTO agents (
    slug,
    display_name,
    token_hash,
    token_salt,
    active,
    updated_at
  ) VALUES ($1, $2, $3, $4, true, NOW())
  ON CONFLICT (slug) DO UPDATE SET
    -- Rotate: move current token to grace-period slot
    previous_token_hash       = agents.token_hash,
    previous_token_salt       = agents.token_salt,
    previous_token_expires_at = NOW() + INTERVAL '1 hour',
    -- Install new token
    token_hash                = EXCLUDED.token_hash,
    token_salt                = EXCLUDED.token_salt,
    active                    = true,
    updated_at                = NOW()
`

try {
  const client = await db.connect()
  try {
    await client.query(upsertSql, [slug, agent.name, tokenHash, salt])
    console.log('[provision] Token stored successfully.')
    console.log('')
    console.log('─────────────────────────────────────────────────────────')
    console.log(`  Agent:      ${slug} (${agent.name})`)
    console.log(`  AGENT_TOKEN=${agentToken}`)
    console.log('─────────────────────────────────────────────────────────')
    console.log('')
    console.log('⚠  Store this token securely. It cannot be recovered.')
    console.log('   Set it in .env as: AGENT_TOKEN=<value above>')
    console.log('   If you lose it, run this script again to rotate.')
  } finally {
    client.release()
  }
} catch (err) {
  console.error('[provision] Database error:', err instanceof Error ? err.message : err)
  process.exit(1)
} finally {
  await db.end()
}
