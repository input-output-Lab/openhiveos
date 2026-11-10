import { describe, it, expect, vi } from 'vitest'
import { resolveStepUpRoles, runStepUp, stepUpTimeoutMs } from '../../src/auth/step-up.js'

// ---------------------------------------------------------------------------
// S19-ARCH-01c (#2776, Tier-3): the subprocess step-up decision logic.
// Pins the ONE security property: approval requires action==='accept' AND
// content.approve===true. Every other outcome — decline, cancel, timeout,
// transport error, malformed answer — collapses to { approved: false }.
// ---------------------------------------------------------------------------

const ctx = {
  taskId: 42,
  taskTitle: 'Ship the thing',
  fromStatus: 'pending-close',
  toStatus: 'done',
  callerAgentSlug: 'murphy',
  stepUpNonce: 'nonce-abc',
}

const extra = (respond: () => Promise<unknown>) =>
  ({
    sendRequest: respond,
    signal: new AbortController().signal,
  }) as never

describe('S19-ARCH-01c: runStepUp strict approval', () => {
  it('approves ONLY on accept + approve:true', async () => {
    const outcome = await runStepUp(
      ctx,
      extra(() => Promise.resolve({ action: 'accept', content: { approve: true } })),
    )
    expect(outcome.approved).toBe(true)
    expect(outcome.stepUpUser).toBe('direct-client') // standalone fallback
  })

  it('rejects decline and cancel', async () => {
    const decline = await runStepUp(
      ctx,
      extra(() => Promise.resolve({ action: 'decline' })),
    )
    expect(decline.approved).toBe(false)

    const cancel = await runStepUp(
      ctx,
      extra(() => Promise.resolve({ action: 'cancel' })),
    )
    expect(cancel.approved).toBe(false)
  })

  it('rejects accept with approve:false or missing approve (the auto-answer trap)', async () => {
    const no = await runStepUp(
      ctx,
      extra(() => Promise.resolve({ action: 'accept', content: { approve: false } })),
    )
    expect(no.approved).toBe(false)

    const empty = await runStepUp(
      ctx,
      extra(() => Promise.resolve({ action: 'accept', content: {} })),
    )
    expect(empty.approved).toBe(false)

    const noContent = await runStepUp(
      ctx,
      extra(() => Promise.resolve({ action: 'accept' })),
    )
    expect(noContent.approved).toBe(false)
  })

  it('collapses timeout / transport errors to not-approved', async () => {
    const timeout = await runStepUp(
      ctx,
      extra(() => Promise.reject(new Error('Request timed out'))),
    )
    expect(timeout.approved).toBe(false)
    expect(timeout.reason).toContain('step-up failed')
  })

  it('round-trips the nonce into the elicitation request _meta', async () => {
    let captured: unknown
    await runStepUp(
      ctx,
      extra((req) => {
        captured = req
        return Promise.resolve({ action: 'decline' })
      }),
    )
    const params = (captured as { params?: { _meta?: Record<string, unknown> } }).params
    expect(params?._meta?.['__stepUpNonce']).toBe('nonce-abc')
  })

  it('prefers the gateway-stamped operator label over the fallback', async () => {
    const outcome = await runStepUp(
      ctx,
      extra(() =>
        Promise.resolve({
          action: 'accept',
          content: { approve: true },
          _meta: { __stepUpUser: 'richo' },
        }),
      ),
    )
    expect(outcome.approved).toBe(true)
    expect(outcome.stepUpUser).toBe('richo')
  })

  it('rejects malformed operator labels (falls back)', async () => {
    const outcome = await runStepUp(
      ctx,
      extra(() =>
        Promise.resolve({
          action: 'accept',
          content: { approve: true },
          _meta: { __stepUpUser: 'has spaces' },
        }),
      ),
    )
    expect(outcome.stepUpUser).toBe('direct-client')
  })

  it('omits the nonce key when standalone (no gateway)', async () => {
    let captured: unknown
    await runStepUp(
      { ...ctx, stepUpNonce: null },
      extra((req) => {
        captured = req
        return Promise.resolve({ action: 'decline' })
      }),
    )
    const meta = (captured as { params?: { _meta?: Record<string, unknown> } }).params?._meta
    expect(meta?.['__stepUpNonce']).toBeUndefined()
  })
})

describe('S19-ARCH-01c: role gating config', () => {
  it('defaults to approver only', () => {
    expect(resolveStepUpRoles(undefined)).toEqual(new Set(['approver']))
    expect(resolveStepUpRoles('')).toEqual(new Set(['approver']))
    expect(resolveStepUpRoles('garbage')).toEqual(new Set(['approver']))
  })

  it('parses a config subset, ignoring unknown roles', () => {
    expect(resolveStepUpRoles('reviewer')).toEqual(new Set(['reviewer']))
    expect(resolveStepUpRoles('reviewer,approver')).toEqual(new Set(['reviewer', 'approver']))
    expect(resolveStepUpRoles('reviewer,admin')).toEqual(new Set(['reviewer']))
  })

  it('timeout defaults to 120s and accepts a sane override', () => {
    expect(stepUpTimeoutMs()).toBe(120_000)
    process.env['GATEWAY_STEPUP_TIMEOUT_MS'] = '5000'
    expect(stepUpTimeoutMs()).toBe(5000)
    process.env['GATEWAY_STEPUP_TIMEOUT_MS'] = 'bogus'
    expect(stepUpTimeoutMs()).toBe(120_000)
    delete process.env['GATEWAY_STEPUP_TIMEOUT_MS']
  })
})

// Silence unused-import lint when vi is only used implicitly above.
void vi
