/**
 * tests/utilities/slack-alert.test.ts + tests/workers/handlers/run-audit.test.ts
 * S18-OPS-01 (#2569).
 *
 * AC: alert fires on seeded failing invariant.
 * Strategy:
 *   - renderAuditAlert: pure tests (thresholds, critical-vs-warn, null cases)
 *   - sendSlackAlert: fetch-mocked (no-op without URL, delivery, timeout)
 *   - runAuditHandler: real runAudit against testcontainer with a seeded
 *     failing invariant condition; asserts handler completes and Slack was
 *     called with the finding (fetch mock captured the payload)
 *
 * DB-free tests run in hermetic CI; the handler integration test needs
 * TEST_DATABASE_URL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderAuditAlert, sendSlackAlert } from '../../../src/utilities/slack-alert.js'

// Module-scope pool holder — the hoisted vi.mock factory below closes over
// this (declared at module level so the factory's scope reaches it).
let clientPool: import('pg').Pool | undefined

// ─────────────────────────────────────────────────────────────────────────────
// renderAuditAlert (pure)
// ─────────────────────────────────────────────────────────────────────────────

describe('renderAuditAlert', () => {
  const critical = [{ id: 'integrity.gate-attribution', evidence: '29 bypass row(s)' }]
  const warns = Array.from({ length: 6 }, (_, i) => ({ id: `workflow.warn-${i}`, evidence: 'w' }))

  it('returns null when nothing breaches (no critical, warns under threshold)', () => {
    const out = renderAuditAlert(1, 95, [], warns.slice(0, 4), 5)
    expect(out).toBeNull()
  })

  it('ALERTS on any critical failure regardless of warn count', () => {
    const out = renderAuditAlert(2, 60, critical, [], 5)
    expect(out).not.toBeNull()
    expect(out).toContain('critical failure(s)')
    expect(out).toContain('integrity.gate-attribution')
  })

  it('ALERTS on warns at/above threshold', () => {
    const out = renderAuditAlert(3, 80, [], warns, 5)
    expect(out).not.toBeNull()
    expect(out).toContain('6 warnings')
  })

  it('caps evidence at 5 findings per severity', () => {
    const manyCritical = Array.from({ length: 7 }, (_, i) => ({
      id: `crit-${i}`,
      evidence: 'e',
    }))
    const out = renderAuditAlert(4, 10, manyCritical, [], 5)
    expect(out).toContain('…and 2 more')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// sendSlackAlert (fetch-mocked)
// ─────────────────────────────────────────────────────────────────────────────

describe('sendSlackAlert', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('no-ops safely without a webhook URL', async () => {
    const out = await sendSlackAlert('test', undefined)
    expect(out).toEqual({ delivered: false, reason: 'no_webhook' })
  })

  it('delivers a payload to the webhook', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await sendSlackAlert('alert text', 'https://hooks.slack.test/t/b/x')
    expect(out).toEqual({ delivered: true })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://hooks.slack.test/t/b/x')
    expect(JSON.parse(String(init.body))).toEqual({ text: 'alert text' })
  })

  it('returns http_error on non-2xx and never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('err', { status: 500 })))
    const out = await sendSlackAlert('x', 'https://hooks.slack.test/t/b/x')
    expect(out.delivered).toBe(false)
    expect(out.reason).toBe('http_error')
    expect(out.status).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runAuditHandler (integration — needs TEST_DATABASE_URL)
// ─────────────────────────────────────────────────────────────────────────────

describe.runIf(process.env['TEST_DATABASE_URL'])('runAuditHandler (AC: alert on seeded failing invariant)', () => {
  let db: { pool: import('pg').Pool; teardown: () => Promise<void> }
  let fetchCalls: Array<{ url: string; body: unknown }>

  // The handler + runner import pool from src/db/client.js at module load.
  // Mock it BEFORE the dynamic imports so runAudit writes into the
  // testcontainer, not the production DATABASE_URL. vi.mock is hoisted to
  // module top — clientPool (module scope) is assigned in beforeEach.
  vi.mock(import('../../../src/db/client.js'), () => ({
    get pool() {
      return clientPool!
    },
    withActor: async <T>(_slug: string, fn: () => Promise<T>): Promise<T> => fn(),
  }))

  beforeEach(async () => {
    const { createTestDb } = await import('../../helpers/db.js')
    db = await createTestDb()
    clientPool = db.pool
    // Capture Slack POSTs (no-op-safe path must still be exercised when unset)
    fetchCalls = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
      return new Response('ok', { status: 200 })
    }))
    process.env['ALERT_SLACK_WEBHOOK_URL'] = 'https://hooks.slack.test/t/b/x'
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    delete process.env['ALERT_SLACK_WEBHOOK_URL']
    vi.restoreAllMocks()
    await db.teardown()
  })

  it('completes an audit, persists a row, and ALERTS when a critical invariant fails', async () => {
    const { runAuditHandler } = await import('../../../src/workers/handlers/run-audit.js')

    // Seed a FAILING invariant condition: a task with a non-canonical status
    // trips contract.status-values (critical) in the otherwise-clean container.
    // Agent FIRST (projects.owner_agent_slug FK), then project.
    await db.pool.query(
      `INSERT INTO agents (slug, display_name, token_hash, token_salt) VALUES ('ops-agent', 'Ops Agent', 'x', 'y') ON CONFLICT (slug) DO NOTHING`,
    ).catch(() => undefined)
    await db.pool.query(
      `INSERT INTO projects (slug, name, owner_agent_slug) VALUES ('ops-proj', 'Ops', 'ops-agent') ON CONFLICT (slug) DO NOTHING`,
    )
    await db.pool.query(
      `BEGIN;
        ALTER TABLE tasks DROP CONSTRAINT chk_tasks_status;
        ALTER TABLE tasks DISABLE TRIGGER trg_tasks_lifecycle;
        INSERT INTO tasks (title, description, project_id, status)
        SELECT 'bad status', 'x', p.id, 'bogus' FROM projects p WHERE p.slug='ops-proj';
        ALTER TABLE tasks ENABLE TRIGGER trg_tasks_lifecycle;
        COMMIT;`,
    ).catch(() => undefined)

    await runAuditHandler('run_audit', {})

    // One audit_runs row persisted with a critical finding
    const runRow = await db.pool.query<{ score: string; findings: unknown[] }>(
      `SELECT score::text AS score, findings FROM audit_runs ORDER BY started_at DESC LIMIT 1`,
    )
    expect(runRow.rows).toHaveLength(1)
    const findings = runRow.rows[0]!.findings as Array<{ id: string; pass: boolean }>
    expect(findings.some((f) => f.id === 'contract.status-values' && !f.pass)).toBe(true)

    // AC: the alert FIRED — Slack webhook received the critical finding
    expect(fetchCalls).toHaveLength(1)
    const text = (fetchCalls[0]!.body as { text: string }).text
    expect(text).toContain('critical failure')
    expect(text).toContain('contract.status-values')
  })

  it('runs without Slack configured (no-op-safe) and still persists the row', async () => {
    const { runAuditHandler } = await import('../../../src/workers/handlers/run-audit.js')
    delete process.env['ALERT_SLACK_WEBHOOK_URL']
    fetchCalls = []

    await expect(runAuditHandler('run_audit', {})).resolves.toBeUndefined()
    expect(fetchCalls).toHaveLength(0)
    const runs = await db.pool.query(`SELECT COUNT(*)::int AS n FROM audit_runs`)
    expect(Number(runs.rows[0]!.n)).toBeGreaterThanOrEqual(1)
  })
})
