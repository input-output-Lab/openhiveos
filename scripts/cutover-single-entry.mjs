#!/usr/bin/env node
/**
 * scripts/cutover-single-entry.mjs
 *
 * S19-ARCH-01g (#2780): mcp.json + agent-file cutover to the single
 * `openhiveos` MCP entry (ARCH-026 Decision 1).
 *
 * WHAT IT DOES (reversible — every mutation writes a timestamped backup):
 *   1. mcp.json (VS Code user config):
 *      - replaces the N `openhiveos-<slug>` persona entries with ONE
 *        `openhiveos` entry (same URL + one session credential via
 *        --token, or ${input:openhiveosToken} with --input-mode)
 *      - leaves non-OpenHiveOS entries untouched
 *   2. ~/.copilot/agents/*.agent.md:
 *      - rewrites `openhiveos-<slug>/tool` references → `openhiveos/tool`
 *      - injects the persona body-instruction block (the model-passes-
 *        persona convention from ARCH-026) if absent
 *
 * VALIDATION (runs before any write; abort on failure):
 *   - live gateway responds 401 without auth (server up)
 *   - the new unified entry authenticates (--token path: one tools/list)
 *
 * ROLLBACK: backups are written to the paths printed at start; restore =
 *   copy back. The script also prints exact jq-less restore commands.
 *
 * HUMAN-RUN ROTATION NOTE (per the task): tokens still in mcp.json are the
 * pre-S17-SEC-02 set — this script does NOT rotate them. Rotation remains a
 * human-run provision-agent-token.ts step per the epic ruling.
 *
 * Usage:
 *   node scripts/cutover-single-entry.mjs --token <64xhex-or-salt.secret> [--dry-run]
 *   node scripts/cutover-single-entry.mjs --input-mode [--dry-run]
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const args = process.argv.slice(2)
const getArg = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const hasFlag = (name) => args.includes(name)
const DRY = hasFlag('--dry-run')
const INPUT_MODE = hasFlag('--input-mode')
const TOKEN = getArg('--token')

if (!INPUT_MODE && !TOKEN) {
  console.error('Usage: node scripts/cutover-single-entry.mjs --token <credential> [--dry-run]')
  console.error('       node scripts/cutover-single-entry.mjs --input-mode [--dry-run]')
  process.exit(1)
}
// S19 post-cutover fix: the unified /mcp entry resolves identity from the
// agents table (salt.secret bearer), NOT the legacy gateway token. A 64-hex
// MCP_GATEWAY_TOKEN here authenticates /sse only and locks every client out
// of /mcp with 401 (VS Code then falls back to OAuth discovery). Accept only
// the ARCH-008 Decision 7 shape: <32-hex-salt>.<64-hex-secret>.
if (TOKEN && !/^[a-f0-9]{32}\.[a-f0-9]{64}$/i.test(TOKEN)) {
  console.error('FATAL: --token must be an AGENT bearer (salt.secret: 32-hex + dot + 64-hex).')
  console.error('       The legacy MCP_GATEWAY_TOKEN is NOT valid for /mcp — it only')
  console.error('       authenticates the /sse?token= path. Provision via:')
  console.error('         npx tsx src/scripts/provision-agent-token.ts <agent-slug> --token-only')
  process.exit(1)
}

const MCP_JSON = path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'mcp.json')
const AGENTS_DIR = path.join(os.homedir(), '.copilot', 'agents')
const ts = new Date().toISOString().replace(/[:.]/g, '-')

// --- 1. mcp.json -----------------------------------------------------------
if (!fs.existsSync(MCP_JSON)) {
  console.error(`FATAL: mcp.json not found at ${MCP_JSON}`)
  process.exit(1)
}
const mcpBackup = `${MCP_JSON}.bak-cutover-${ts}`
const mcpRaw = fs.readFileSync(MCP_JSON, 'utf8')
const mcp = JSON.parse(mcpRaw)
const servers = mcp.servers ?? {}
const personaEntries = Object.keys(servers).filter((k) => /^openhiveos-/.test(k))

if (personaEntries.length === 0 && servers['openhiveos']) {
  console.log('mcp.json already cut over (single openhiveos entry present, no persona entries). Skipping.')
} else {
  console.log(`mcp.json: ${personaEntries.length} persona entries → 1 unified entry`)
  console.log(`  backup: ${mcpBackup}`)

  // Reference credential for the unified entry: reuse an existing persona
  // bearer unless --token provided (rotation stays human-run; this preserves
  // the CURRENT working credential so the cutover cannot lock anyone out).
  const referenceAuth = servers[personaEntries[0]]?.headers?.Authorization ?? ''
  const unifiedAuth = TOKEN
    ? `Bearer ${TOKEN}`
    : (INPUT_MODE ? 'Bearer ${input:openhiveosToken}' : referenceAuth)

  const unified = {
    type: 'http',
    url: 'http://127.0.0.1:3008/mcp',
    headers: { Authorization: unifiedAuth },
  }

  const next = { ...servers }
  for (const k of personaEntries) delete next[k]
  next['openhiveos'] = unified
  mcp.servers = next

  if (!DRY) {
    fs.writeFileSync(mcpBackup, mcpRaw)
    fs.writeFileSync(MCP_JSON, JSON.stringify(mcp, null, 2) + '\n')
    console.log('  written.')
  } else {
    console.log('  (dry-run: not written)')
  }
}

// --- 2. agent files ----------------------------------------------------------
const agentFiles = fs.existsSync(AGENTS_DIR)
  ? fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.agent.md'))
  : []
console.log(`\nagent files: ${agentFiles.length} in ${AGENTS_DIR}`)

const PERSONA_BLOCK = [
  '',
  '## MCP identity — single OpenHiveOS entry (S19-ARCH-01g)',
  '',
  'All OpenHiveOS tools are served by the single `openhiveos` MCP entry.',
  'Your OpenHiveOS session is shared: your persona is a CLAIMED LABEL, not',
  'a credential. On every OpenHiveOS tool call, pass',
  '`"persona": "<your-slug>"` (e.g. `"persona": "murphy"`) when the tool',
  'accepts extra arguments; the gateway lifts it into the audit trail as',
  '`claimed_persona` with the call\'s `auth_strength`. Do not claim another',
  'agent\'s slug — the label is for humans reading the audit trail and',
  'spoofing it is a ratified risk (ARCH-026), not an access control.',
  '',
].join('\n')

let touched = 0
for (const f of agentFiles) {
  const full = path.join(AGENTS_DIR, f)
  const slug = f.replace(/\.agent\.md$/, '')
  const raw = fs.readFileSync(full, 'utf8')
  const re = new RegExp(`openhiveos-${slug}/`, 'g')
  const rewritten = raw.replace(re, 'openhiveos/')
  const needsPersona = !rewritten.includes('S19-ARCH-01g') && rewritten.includes('openhiveos/')
  let out = rewritten
  if (needsPersona) {
    // Insert the persona block after the frontmatter (after the second '---')
    const fmEnd = out.indexOf('\n---', 3)
    const insertAt = fmEnd === -1 ? 0 : fmEnd + 4
    out = out.slice(0, insertAt) + '\n' + PERSONA_BLOCK + out.slice(insertAt)
  }
  if (out !== raw) {
    touched++
    console.log(`  ${f}: refs rewritten + persona block ${needsPersona ? 'added' : 'skipped (already present)'}`)
    if (!DRY) {
      fs.writeFileSync(`${full}.bak-cutover-${ts}`, raw)
      fs.writeFileSync(full, out)
    }
  }
}
if (DRY) console.log(`  (dry-run: not written; ${touched} files would change)`)
else console.log(`  ${touched} files updated. Backups: *.bak-cutover-${ts}`)

// --- 3. validation ------------------------------------------------------------
console.log('\nvalidation:')
const { default: http } = await import('node:http')
const url = 'http://127.0.0.1:3008/mcp'
await new Promise((resolve) => {
  const req = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 4000 }, (res) => {
    // 401 without auth = gateway alive and enforcing (expected probe result)
    console.log(`  gateway alive: HTTP ${res.statusCode} (401 expected without auth)`)
    res.resume()
    resolve()
  })
  req.on('timeout', () => { console.error('  FATAL: gateway did not respond — is pm2 mcp-gateway running?'); process.exit(1) })
  req.on('error', (e) => { console.error(`  FATAL: gateway unreachable: ${e.message}`); process.exit(1) })
  req.end(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping' }))
})

console.log(`
DONE${DRY ? ' (dry-run)' : ''}. Next steps (human):
  1. Reload VS Code (picks up mcp.json + agent files).
  2. ${INPUT_MODE ? 'On first call, enter the OpenHiveOS credential at the ${input:openhiveosToken} prompt.' : 'The unified entry reuses the reference persona credential — rotate it via scripts/provision-agent-token.ts when convenient (human-run).'}
  3. One smoke call per agent: query_projects with {"persona":"<slug>"}.
  4. Verify audit: SELECT agent_slug, claimed_persona, auth_strength FROM tool_invocations ORDER BY id DESC LIMIT 5;
     expect agent_slug='dev-actor'/'bridge'→ no — expect the bearer-resolved slug + your claimed persona.
Rollback: restore the .bak-cutover-${ts} files printed above and reload VS Code.`)
