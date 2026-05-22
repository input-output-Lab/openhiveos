#!/usr/bin/env tsx
/**
 * scripts/provision-all-agents.ts
 *
 * Batch provisioning CLI for all Squad agents - ARCH-014 C4 (#1371).
 * spawn-protocol Phase 3: Emanation.
 *
 * Usage:
 *   npx tsx scripts/provision-all-agents.ts --write-env <path>
 *   npx tsx scripts/provision-all-agents.ts --write-env <path> --force-rotate --confirm
 *   npx tsx scripts/provision-all-agents.ts --help
 *
 * Requirements:
 *   - DATABASE_URL set in .env or environment
 *   - PROVISION_ENV_DIR set in .env - only paths under this directory are
 *     allowed as --write-env targets (SEC-C4: path traversal prevention)
 *   - One active Ethos Seal must exist (run one-init first - SEC-C5)
 *
 * Behaviour:
 *   - Iterates all agents in squad.manifest.json; excludes 'dashboard'
 *     (dashboard is provisioned separately: provision-agent-token.ts dashboard)
 *   - Default: ON CONFLICT DO NOTHING - already-provisioned agents are skipped
 *   - --force-rotate --confirm: rotates ALL tokens with a 1h grace-period window
 *   - Writes AGENT_TOKEN_<SLUG>=<token> lines to --write-env file (SEC-C3)
 *   - File is written atomically (tmp + rename) with mode 0o600 (SEC-C4)
 *
 * Security conditions (Locksmith, ARCH-014):
 *   SEC-C2 - DO NOTHING default; --force-rotate --confirm for batch rotation
 *   SEC-C3 - --write-env mandatory for this script; process.exit(1) if absent
 *   SEC-C4 - path.resolve + PROVISION_ENV_DIR prefix allowlist + mode 0o600
 *   SEC-C5 - Ethos Seal gate: fail-closed; 42P01 handled explicitly
 *   SEC-C6 - --help includes chmod 600 note, recovery note, --write-env requirement
 */

// Load .env before any module that reads env vars at init time
import 'dotenv/config'

import { writeFile, rename, mkdir } from 'node:fs/promises'
import { resolve, dirname, sep } from 'node:path'

import { Pool } from 'pg'

import { manifest } from '../squad/manifest.js'
import {
  checkEthosSealGate,
  upsertAgent,
} from '../auth/upsert-agent.js'

// ---------------------------------------------------------------------------
// Help - SEC-C6
// ---------------------------------------------------------------------------
const HELP = `
Usage:
  npx tsx scripts/provision-all-agents.ts --write-env <path>
  npx tsx scripts/provision-all-agents.ts --write-env <path> --force-rotate --confirm
  npx tsx scripts/provision-all-agents.ts --help

Provisions tokens for all Squad agents defined in squad.manifest.json.

Flags:
  --write-env <path>       Required. Path to write the token file.
                           Must be under PROVISION_ENV_DIR (set in .env).
                           File is written with chmod 600 automatically.
  --force-rotate           Rotate tokens for agents that are already provisioned.
                           Requires --confirm. Without --confirm, exits with error.
  --confirm                Confirms destructive batch rotation. Required with
                           --force-rotate. No effect without --force-rotate.

Notes:
  - The 'dashboard' agent is excluded. Provision it separately:
      npx tsx scripts/provision-agent-token.ts dashboard
  - Tokens are written to the --write-env file (chmod 600). Never to stdout.
    Source the file into your environment or copy values to .env manually.
  - If an agent is skipped (already provisioned, no --force-rotate), no entry
    is written to the output file for that agent. Re-run with --force-rotate
    --confirm to rotate all tokens.
  - Lost token? Run provision-agent-token.ts <slug> to rotate one agent.
  - PROVISION_ENV_DIR must be set in your .env to prevent path traversal (SEC-C4).

Token file format:
  AGENT_TOKEN_MURPHY=<salt>.<secret>
  AGENT_TOKEN_SILAS=<salt>.<secret>
  ...

Source it with: set -a; source <path>; set +a
`

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(HELP)
  process.exit(0)
}

const forceRotate = args.includes('--force-rotate')
const confirm = args.includes('--confirm')

// --force-rotate requires --confirm to prevent accidental mass rotation (SEC-C2)
if (forceRotate && !confirm) {
  console.error('[provision-all] Error: --force-rotate requires --confirm.')
  console.error('[provision-all] Batch token rotation will immediately invalidate all')
  console.error('[provision-all] active agent tokens. Add --confirm if you are sure.')
  process.exit(1)
}

// Find --write-env <path> - SEC-C3: mandatory
const writeEnvIdx = args.indexOf('--write-env')
const writeEnvRaw = writeEnvIdx !== -1 ? args[writeEnvIdx + 1] : undefined

if (!writeEnvRaw || writeEnvRaw.startsWith('--')) {
  console.error('[provision-all] Error: --write-env <path> is required (SEC-C3).')
  console.error('[provision-all] Tokens must be written to a file, not stdout.')
  console.error('[provision-all] Example: --write-env /run/secrets/.env.tokens')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Path validation - SEC-C4
// Prevents path traversal: resolve + PROVISION_ENV_DIR prefix allowlist.
// ---------------------------------------------------------------------------
function validateWriteEnvPath(rawPath: string): string {
  const provisionEnvDir = process.env['PROVISION_ENV_DIR']
  if (!provisionEnvDir) {
    console.error('[provision-all] Error: PROVISION_ENV_DIR is not set.')
    console.error('[provision-all] Set it in .env to the directory where token files are allowed.')
    console.error('[provision-all] Example: PROVISION_ENV_DIR=/run/secrets')
    console.error('[provision-all] Only paths under PROVISION_ENV_DIR are accepted (SEC-C4).')
    process.exit(1)
  }

  const resolved = resolve(rawPath)
  const allowedPrefix = resolve(provisionEnvDir)

  // Require the resolved path to be within allowedPrefix.
  // The sep suffix on allowedPrefix prevents /run/secret-other from matching /run/secrets.
  if (!resolved.startsWith(allowedPrefix + sep) && resolved !== allowedPrefix) {
    console.error(
      `[provision-all] Error: --write-env path "${resolved}" is outside PROVISION_ENV_DIR "${allowedPrefix}".`,
    )
    console.error('[provision-all] Path traversal attempt blocked (SEC-C4).')
    process.exit(1)
  }

  return resolved
}

const writeEnvPath = validateWriteEnvPath(writeEnvRaw)

// ---------------------------------------------------------------------------
// Database connection
// ---------------------------------------------------------------------------
const databaseUrl = process.env['DATABASE_URL']
if (!databaseUrl) {
  console.error('[provision-all] Error: DATABASE_URL is required.')
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

/** Convert slug to env var name: 'my-agent' -> 'MY_AGENT' */
function slugToEnvKey(slug: string): string {
  return slug.toUpperCase().replace(/-/g, '_')
}

// dashboard is provisioned separately and is not in squad.manifest.json.
// Explicit guard: skip any agent with slug 'dashboard' in case it is ever
// added to the manifest in the future (ARCH-014).
const DASHBOARD_SLUG = 'dashboard'

const client = await db.connect()
try {
  // Ethos Seal gate - SEC-C5: fail-closed before provisioning any agent.
  await checkEthosSealGate(client)

  const agentsToProvision = manifest.agents.filter((a) => a.slug !== DASHBOARD_SLUG)

  if (agentsToProvision.length === 0) {
    console.error('[provision-all] No agents to provision (all are dashboard or excluded).')
    process.exit(1)
  }

  console.log(`[provision-all] Provisioning ${String(agentsToProvision.length)} agent(s)...`)
  if (forceRotate) {
    console.log('[provision-all] Mode: --force-rotate (all tokens will be rotated)')
  } else {
    console.log('[provision-all] Mode: default (already-provisioned agents will be skipped)')
  }
  console.log('')

  // Collect results in memory - written atomically to disk after all succeed.
  const tokenLines: string[] = []
  const provisioned: string[] = []
  const skipped: string[] = []

  for (const agent of agentsToProvision) {
    const result = await upsertAgent(client, {
      slug: agent.slug,
      displayName: agent.name,
      forceRotate,
    })

    if (result.skipped) {
      skipped.push(agent.slug)
      console.log(`  [skip]  ${agent.slug} (${agent.name}) - already provisioned`)
    } else {
      provisioned.push(agent.slug)
      const envKey = `AGENT_TOKEN_${slugToEnvKey(agent.slug)}`
      tokenLines.push(`${envKey}=${result.token}`)
      console.log(`  [done]  ${agent.slug} (${agent.name}) - token generated`)
    }
  }

  console.log('')

  if (tokenLines.length === 0) {
    console.log('[provision-all] All agents already provisioned. Nothing written to file.')
    console.log('[provision-all] To rotate all tokens: --force-rotate --confirm')
    process.exit(0)
  }

  // Write output file atomically - SEC-C4: mode 0o600 (owner read/write only)
  const dir = dirname(writeEnvPath)
  await mkdir(dir, { recursive: true })
  const tmp = `${writeEnvPath}.tmp`
  await writeFile(tmp, tokenLines.join('\n') + '\n', { encoding: 'utf-8', mode: 0o600 })
  await rename(tmp, writeEnvPath)

  console.log(`[provision-all] Token file written to: ${writeEnvPath}`)
  console.log('[provision-all] File permissions: 600 (owner read/write only)')
  console.log('')
  console.log('Summary:')
  console.log(`  Provisioned: ${provisioned.join(', ') || 'none'}`)
  console.log(`  Skipped:     ${skipped.join(', ') || 'none'}`)
  console.log('')
  if (skipped.length > 0) {
    console.log(`[provision-all] Note: ${String(skipped.length)} agent(s) skipped (already provisioned).`)
    console.log('[provision-all] Their tokens are NOT in the output file.')
    console.log('[provision-all] To rotate: --force-rotate --confirm')
  }
  console.log('')
  console.log('[provision-all] Next step: provision the dashboard agent separately:')
  console.log('[provision-all]   npx tsx scripts/provision-agent-token.ts dashboard')
} catch (err) {
  console.error('[provision-all] Error:', err instanceof Error ? err.message : err)
  process.exit(1)
} finally {
  client.release()
  await db.end()
}
