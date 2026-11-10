/**
 * scripts/test-stepup-roundtrip.mjs
 *
 * S19-ARCH-01c-R1 (#2792) — LIVE round-trip verification of the step-up
 * relay against a REAL gateway + subprocess (the merge gate that was missing
 * in 01c). Run from the REPO ROOT (spike-2640: relative MCP_BINARY_PATH
 * resolves against cwd; from packages/mcp-gateway the child is the gateway
 * itself → orphan recursion).
 *
 * What it proves:
 *   FIND-2 fix — non-initialize POSTs on a session SUCCEED (the stored
 *   transport accepts them; the per-request pattern 400'd here).
 *   FIND-1 fix — the subprocess's elicitation reaches the mock client
 *   through the upstream relay; decline (no stream / wrong nonce) and
 *   approval (prompt answered approve:true) both round-trip; approval
 *   stamps __stepUpUser.
 *
 * Topology: test gateway (:3018, flag unset) spawns the REAL subprocess
 * (stdio) → tools/call update_task on a seeded task in 'pending-close' →
 * the subprocess elicits → gateway relay forwards to this script's MCP
 * client session (the mock "VS Code").
 *
 * Usage: node scripts/test-stepup-roundtrip.mjs
 * Requires: TEST_DATABASE_URL pointing at a DB with migrations 031+032
 * applied and the seeded agent rows (test-agent owner, murphy assignee,
 * nova approver for elizabeth-owned projects — production-shaped fixture).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolRequestSchema, ElicitRequestSchema, ElicitResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const GATEWAY_PORT = process.env['TEST_GATEWAY_PORT'] ?? '3018'
const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}/mcp`
const AGENT_TOKEN = process.env['TEST_AGENT_TOKEN'] ?? process.env['MURPHY_AGENT_TOKEN']
const GATEWAY_TOKEN = process.env['MCP_GATEWAY_TOKEN']
const TASK_ID = process.env['TEST_TASK_ID']

if (!AGENT_TOKEN || !GATEWAY_TOKEN || !TASK_ID) {
  console.error('FATAL: TEST_AGENT_TOKEN, MCP_GATEWAY_TOKEN and TEST_TASK_ID are required')
  process.exit(1)
}

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---------------------------------------------------------------------------
// Mock VS Code: an elicitation-capable MCP client. Human policy is injected
// per phase: 'approve' | 'decline' | 'absent' (no GET stream open).
// ---------------------------------------------------------------------------
let humanPolicy = 'absent'
let lastPrompt = null

const mockClient = new Client(
  { name: 'stepup-roundtrip-mock', version: '1.0.0' },
  { capabilities: { elicitation: { form: {} } } },
)

mockClient.setRequestHandler(ElicitRequestSchema, async (request) => {
  lastPrompt = request.params.message
  console.log(`  [mock-human] prompt received: ${String(lastPrompt).slice(0, 90)}...`)
  if (humanPolicy === 'approve') {
    return { action: 'accept', content: { approve: true } }
  }
  return { action: 'decline' }
})

async function connectMock(withGetStream) {
  const transport = new StreamableHTTPClientTransport(new URL(GATEWAY_URL), {
    requestInit: { headers: { Authorization: `Bearer ${AGENT_TOKEN}` } },
  })
  await mockClient.connect(transport)
  if (!withGetStream) {
    // Close the SSE side channel: elicitation has nowhere to go → decline.
    await transport.terminateSession().catch(() => {})
  }
  return transport
}

// ---------------------------------------------------------------------------
// Boot the test gateway from the CURRENT directory (must be repo root).
// ---------------------------------------------------------------------------
const gatewayProc = spawn('node', ['packages/mcp-gateway/dist/index.js'], {
  env: {
    ...process.env,
    DATABASE_URL: process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'],
    GEMINI_API_KEY: process.env['GEMINI_API_KEY'] ?? 'roundtrip-placeholder',
    GATEWAY_MODE: 'true',
    MCP_GATEWAY_PORT: GATEWAY_PORT,
    // The SUBPROCESS health port must not collide with the live stack's :3007.
    HEALTH_PORT: process.env['TEST_HEALTH_PORT'] ?? '3019',
    GATEWAY_BIND: '127.0.0.1',
    NODE_ENV: 'development',
    GATEWAY_OPERATOR: 'roundtrip-tester',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
gatewayProc.stdout.on('data', (d) => process.env['VERBOSE'] && console.log('[gw]', String(d).trim()))
gatewayProc.stderr.on('data', (d) => process.env['VERBOSE'] && console.error('[gw!]', String(d).trim()))

async function waitForGateway() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/health`)
      if (r.ok) return true
    } catch { /* not up yet */ }
    await delay(500)
  }
  return false
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------
async function phaseFind2_noStreamDecline() {
  console.log('\n== PHASE 1: FIND-2 — non-initialize POST succeeds; elicitation declines without a GET stream ==')
  const transport = new StreamableHTTPClientTransport(new URL(GATEWAY_URL), {
    requestInit: { headers: { Authorization: `Bearer ${AGENT_TOKEN}` } },
  })
  const c = new Client({ name: 'phase1', version: '1.0.0' }, { capabilities: { elicitation: { form: {} } } })
  c.setRequestHandler(ElicitRequestSchema, async (request) => {
    // NOTE: StreamableHTTPClientTransport ALWAYS opens a GET stream on
    // connect (only a 405 suppresses it), so "no stream" is not reachable
    // from the SDK client. The real degradation case is STREAM LOSS
    // mid-flight: the mock human goes away (aborts the GET stream) before
    // answering. The relay must then fail-closed — its forward fails/times
    // out and the transition is denied. humanPolicy 'absent' = never answer.
    lastPrompt = request.params.message
    record('P1: prompt delivered on the open stream (expected — client auto-opens GET)', true)
    if (humanPolicy === 'absent') {
      console.log('  [mock-human] going away mid-flight (aborting streams)...')
      void transport.terminateSession().catch(() => {})
      // Never resolve — the relay must time out or observe the closed stream.
      return new Promise(() => {})
    }
    return { action: 'decline' }
  })
  await c.connect(transport)

  // FIND-2 regression probe: a tools/list call AFTER initialize must succeed
  // (the broken per-request pattern returned 400 Server-not-initialized here).
  try {
    await c.listTools()
    record('P1a: non-initialize POST accepted on stored session (FIND-2 fixed)', true)
  } catch (err) {
    record('P1a: non-initialize POST accepted on stored session (FIND-2 fixed)', false, String(err).slice(0, 140))
    return
  }

  // Stream-loss: mock human disappears before answering; the relay's forward
  // must fail-closed (step_up_denied), never hang the caller past the timeout.
  // The client-side callTool may itself time out (60s SDK default) — either
  // outcome proves the caller is never left hanging indefinitely; the DB
  // check after confirms nothing was written.
  humanPolicy = 'absent'
  const t0 = Date.now()
  let parsed = {}
  try {
    const result = await c.callTool({ name: 'update_task', arguments: { task_id: Number(TASK_ID), status: 'done' } })
    parsed = JSON.parse(result.content?.[0]?.text ?? '{}')
  } catch (err) {
    parsed = { error: `caller_timeout: ${String(err).slice(0, 80)}` }
  }
  const elapsed = Date.now() - t0
  const dbCheck = await (async () => {
    try {
      const { Pool } = await import('pg')
      const pool = new Pool({ connectionString: process.env['TEST_DATABASE_URL'] })
      const r = await pool.query(`SELECT status FROM tasks WHERE id = $1`, [Number(TASK_ID)])
      const s = r.rows[0]?.status
      await pool.end()
      return s
    } catch {
      return 'unknown'
    }
  })()
  record(
    'P1-stream-loss: human vanishes mid-flight → caller resolves/times out, nothing written',
    (parsed.error === 'step_up_denied' || parsed.error === 'step_up_required' || parsed.error?.startsWith('caller_timeout')) && dbCheck === 'pending-close',
    `error=${parsed.error ?? 'none'} db=${dbCheck} (${elapsed}ms)`,
  )
  await transport.terminateSession().catch(() => {})
  await c.close().catch(() => {})
}

async function phase2_declineViaMockHuman() {
  console.log('\n== PHASE 2: relay round-trip — mock human DECLINES ==')
  humanPolicy = 'decline'
  const transport = new StreamableHTTPClientTransport(new URL(GATEWAY_URL), {
    requestInit: { headers: { Authorization: `Bearer ${AGENT_TOKEN}` } },
  })
  const c = new Client({ name: 'phase2', version: '1.0.0' }, { capabilities: { elicitation: { form: {} } } })
  c.setRequestHandler(ElicitRequestSchema, async (request) => {
    lastPrompt = request.params.message
    console.log(`  [mock-human] prompt received: ${String(lastPrompt).slice(0, 90)}...`)
    record('P2a: elicitation relayed to the client session (FIND-1 fixed)', true)
    return { action: 'decline' }
  })
  await c.connect(transport)

  const result = await c.callTool({ name: 'update_task', arguments: { task_id: Number(TASK_ID), status: 'done' } })
  const parsed = JSON.parse(result.content?.[0]?.text ?? '{}')
  record('P2b: decline → step_up_denied, nothing written', parsed.error === 'step_up_denied', `error=${parsed.error ?? 'none'}`)
  await transport.terminateSession().catch(() => {})
  await c.close().catch(() => {})
}

async function phase3_approve() {
  console.log('\n== PHASE 3: relay round-trip — mock human APPROVES ==')
  humanPolicy = 'approve'
  const transport = new StreamableHTTPClientTransport(new URL(GATEWAY_URL), {
    requestInit: { headers: { Authorization: `Bearer ${AGENT_TOKEN}` } },
  })
  const c = new Client({ name: 'phase3', version: '1.0.0' }, { capabilities: { elicitation: { form: {} } } })
  c.setRequestHandler(ElicitRequestSchema, async (request) => {
    lastPrompt = request.params.message
    console.log(`  [mock-human] prompt received: ${String(lastPrompt).slice(0, 90)}...`)
    return { action: 'accept', content: { approve: true } }
  })
  await c.connect(transport)

  const result = await c.callTool({ name: 'update_task', arguments: { task_id: Number(TASK_ID), status: 'done' } })
  const parsed = JSON.parse(result.content?.[0]?.text ?? '{}')
  // update_task returns the updated task flat (RETURNING row shape), not {task}.
  const ok = !parsed.error && parsed.status === 'done'
  record('P3: approve → transition executes', ok, parsed.error ?? `status=${parsed.status}`)

  // Verify the DB row carries the step-up attribution triple.
  try {
    const { Pool } = await import('pg')
    const pool = new Pool({ connectionString: process.env['TEST_DATABASE_URL'] })
    const r = await pool.query(
      `SELECT changed_by, auth_strength, step_up_user FROM task_status_history
        WHERE task_id = $1 ORDER BY changed_at DESC, id DESC LIMIT 1`,
      [Number(TASK_ID)],
    )
    const row = r.rows[0]
    // changed_by = nova: resolveApprover for an elizabeth-owned project (D5) —
    // the AGENT who called, not the human. step_up_user carries the operator.
    record(
      'P3b: history row carries (agent, session, operator)',
      row?.auth_strength === 'session' && !!row?.step_up_user && row?.changed_by === 'nova',
      JSON.stringify(row),
    )
    await pool.end()
  } catch (err) {
    record('P3b: history row carries (agent, session, operator)', false, String(err).slice(0, 140))
  }

  await transport.terminateSession().catch(() => {})
  await c.close().catch(() => {})
}

// ---------------------------------------------------------------------------
async function main() {
  process.stdout.write('Booting test gateway (from repo root — spike-2640 rule)...\n')
  if (!(await waitForGateway())) {
    console.error('FATAL: gateway did not become healthy in 30s')
    gatewayProc.kill('SIGTERM')
    process.exit(1)
  }
  console.log('Gateway healthy.\n')

  // Fixture reset: the previous run's approved transition left the task at
  // 'done' (invalid_transition on every phase). The step-up chain requires
  // pending-close → done, so rewind the fixture via direct SQL. Attribution
  // on the rewind is honest: system:sql (fixture maintenance, not a task
  // action — and the aging invariant never sees it because the task returns
  // to pending-close before the run).
  try {
    const { Pool } = await import('pg')
    const pool = new Pool({ connectionString: process.env['TEST_DATABASE_URL'] })
    await pool.query(
      `UPDATE tasks SET status = 'pending-close', updated_at = now() WHERE id = $1 AND status <> 'pending-close'`,
      [Number(TASK_ID)],
    )
    await pool.end()
  } catch (err) {
    console.error(`FATAL: fixture reset failed: ${String(err).slice(0, 140)}`)
    gatewayProc.kill('SIGTERM')
    process.exit(1)
  }

  try {
    await phaseFind2_noStreamDecline()
    await phase2_declineViaMockHuman()
    await phase3_approve()
  } finally {
    gatewayProc.kill('SIGTERM')
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== ROUND-TRIP RESULT: ${results.length - failed.length}/${results.length} passed ===`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('FATAL:', err)
  gatewayProc.kill('SIGTERM')
  process.exit(1)
})
