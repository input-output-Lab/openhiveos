/**
 * src/utilities/slack-alert.ts — S18-OPS-01 (#2569).
 *
 * Slack incoming-webhook alerting for cron-driven operational alerts.
 *
 * Design (per io_website alerting pattern, memory 3146, adapted):
 *   - NO-OP SAFE: without ALERT_SLACK_WEBHOOK_URL, sendSlackAlert returns
 *     { delivered: false, reason: 'no_webhook' } — alerting can never break
 *     the calling path (cron handlers must not fail because Slack is down
 *     or unconfigured).
 *   - Fire-and-forget semantics from the caller's perspective: 5s
 *     AbortSignal.timeout bounds the HTTP call; errors are caught and
 *     returned, never thrown.
 *   - Plain webhook POST (no SDK, no new deps — Locksmith SEC-17 posture).
 */

const SLACK_TIMEOUT_MS = 5_000

export interface SlackAlertResult {
  delivered: boolean
  reason?: 'no_webhook' | 'http_error' | 'timeout'
  status?: number
}

export async function sendSlackAlert(
  text: string,
  webhookUrl: string | undefined,
): Promise<SlackAlertResult> {
  if (!webhookUrl) {
    return { delivered: false, reason: 'no_webhook' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, SLACK_TIMEOUT_MS)
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    })
    if (!res.ok) {
      return { delivered: false, reason: 'http_error', status: res.status }
    }
    return { delivered: true }
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    return { delivered: false, reason: isAbort ? 'timeout' : 'http_error' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Render audit findings into a Slack-ready message. Critical findings always
 * alert; warns only when they exceed the warn threshold. Passing runs below
 * the alert threshold produce null (caller skips the POST entirely).
 */
export function renderAuditAlert(
  runId: number,
  score: number,
  criticalFailures: ReadonlyArray<{ id: string; evidence: string }>,
  warnFailures: ReadonlyArray<{ id: string; evidence: string }>,
  warnAlertThreshold: number,
): string | null {
  if (criticalFailures.length === 0 && warnFailures.length < warnAlertThreshold) {
    return null
  }
  // eslint restrict-template-expressions: coerce numbers before interpolation.
  const id = String(runId)
  const scoreStr = String(score)
  const lines: string[] = []
  if (criticalFailures.length > 0) {
    lines.push(
      `:rotating_light: *Hive audit run #${id}: ${String(criticalFailures.length)} critical failure(s), score ${scoreStr}/100*`,
    )
    for (const f of criticalFailures.slice(0, 5)) {
      lines.push(`• \`${f.id}\` — ${f.evidence}`)
    }
    if (criticalFailures.length > 5) {
      lines.push(`• …and ${String(criticalFailures.length - 5)} more (see audit_runs)`)
    }
  } else {
    lines.push(
      `:warning: *Hive audit run #${id}: ${String(warnFailures.length)} warnings, score ${scoreStr}/100*`,
    )
    for (const f of warnFailures.slice(0, 5)) {
      lines.push(`• \`${f.id}\` — ${f.evidence}`)
    }
  }
  return lines.join('\n')
}
