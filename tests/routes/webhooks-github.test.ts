/**
 * S18-BE-02 (#2559) — GitHub PR-merge webhook: security unit tests.
 *
 * DB-free: covers G1 (signature gate), payload parsing, and transition-rule
 * gating logic. DB-backed transition behaviour lives in the integration tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHmac } from 'node:crypto'
import request from 'supertest'
import { createSquadApiApp } from '../../src/squad-api/server.js'

const SECRET = 'test-webhook-secret-for-unit-tests'
const RAW_BODY = JSON.stringify({
  action: 'closed',
  pull_request: { merged: true, html_url: 'https://github.com/acme/repo/pull/1', merged_by: { login: 'founder' } },
})

function sign(body: string, secret: string = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

describe('POST /webhooks/github — G1 signature gate', () => {
  let app: ReturnType<typeof createSquadApiApp>
  const originalSecret = process.env['GITHUB_WEBHOOK_SECRET']

  beforeAll(() => {
    process.env['GITHUB_WEBHOOK_SECRET'] = SECRET
    app = createSquadApiApp()
  })

  afterAll(() => {
    if (originalSecret === undefined) delete process.env['GITHUB_WEBHOOK_SECRET']
    else process.env['GITHUB_WEBHOOK_SECRET'] = originalSecret
  })

  it('rejects a missing signature with 401 (no DB write)', async () => {
    const res = await request(app).post('/webhooks/github').set('Content-Type', 'application/json').send(RAW_BODY)
    expect(res.status).toBe(401)
  })

  it('rejects a signature computed with the wrong secret with 401', async () => {
    const res = await request(app)
      .post('/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(RAW_BODY, 'attacker-secret'))
      .set('X-GitHub-Delivery', 'unit-test-delivery-1')
      .send(RAW_BODY)
    expect(res.status).toBe(401)
  })

  it('rejects a signature that does not match the body (tamper) with 401', async () => {
    const tampered = RAW_BODY.replace('pull/1', 'pull/2')
    const res = await request(app)
      .post('/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(RAW_BODY))
      .set('X-GitHub-Delivery', 'unit-test-delivery-2')
      .send(tampered)
    expect(res.status).toBe(401)
  })

  it('rejects a malformed signature scheme with 401', async () => {
    const res = await request(app)
      .post('/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', 'md5=deadbeef')
      .set('X-GitHub-Delivery', 'unit-test-delivery-3')
      .send(RAW_BODY)
    expect(res.status).toBe(401)
  })

  it('returns 200 ignored for signed non-merge events (opened) — G2 no-op', async () => {
    const body = JSON.stringify({
      action: 'opened',
      pull_request: { merged: false, html_url: 'https://github.com/acme/repo/pull/9' },
    })
    const res = await request(app)
      .post('/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(body))
      .set('X-GitHub-Delivery', 'unit-test-delivery-opened')
      .send(body)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ignored' })
  })

  it('returns 200 ignored for closed-without-merge — G2 no-op', async () => {
    const body = JSON.stringify({
      action: 'closed',
      pull_request: { merged: false, html_url: 'https://github.com/acme/repo/pull/9' },
    })
    const res = await request(app)
      .post('/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(body))
      .set('X-GitHub-Delivery', 'unit-test-delivery-closed-nomerge')
      .send(body)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ignored' })
  })

  it('requires X-GitHub-Delivery on valid merge events', async () => {
    const res = await request(app)
      .post('/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(RAW_BODY))
      .send(RAW_BODY)
    // Signature valid, delivery missing → not a GitHub request
    expect([400, 500]).toContain(res.status)
  })
})

describe('parsePrMergedPayload', () => {
  it('accepts a well-formed merged payload', async () => {
    const { parsePrMergedPayload } = await import('../../src/routes/webhooks-github.js')
    const parsed = parsePrMergedPayload(JSON.parse(RAW_BODY))
    expect(parsed).not.toBeNull()
    expect(parsed?.action).toBe('closed')
    expect(parsed?.pull_request.merged).toBe(true)
    expect(parsed?.pull_request.html_url).toBe('https://github.com/acme/repo/pull/1')
    expect(parsed?.pull_request.merged_by?.login).toBe('founder')
  })

  it('rejects payloads missing pull_request', async () => {
    const { parsePrMergedPayload } = await import('../../src/routes/webhooks-github.js')
    expect(parsePrMergedPayload({ action: 'closed' })).toBeNull()
    expect(parsePrMergedPayload(null)).toBeNull()
    expect(parsePrMergedPayload('string')).toBeNull()
  })
})
