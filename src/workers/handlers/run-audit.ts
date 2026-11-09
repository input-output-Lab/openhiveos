/**
 * src/workers/handlers/run-audit.ts
 *
 * Cron handler for 'run_audit' — S18-OPS-01 (#2569).
 *
 * Hourly job: execute the full hive invariant audit (same code path as the
 * audit_hive MCP tool — runAudit()), persist the audit_runs row, and alert
 * Slack when findings breach the severity threshold:
 *   - any CRITICAL failure → alert always
 *   - WARN failures → alert only when count ≥ WARN_ALERT_THRESHOLD
 *
 * Alerting is no-op-safe: without ALERT_SLACK_WEBHOOK_URL the handler still
 * runs the audit and persists the row — only the Slack POST is skipped.
 *
 * Security: server-side system path (withActor 'system:audit') — never
 * reachable via update_task or agent tool calls (same P3 posture as
 * task_aging / worklog_derive; SEC-26 deviation documented in tool-registry).
 *
 * Payload: {} — no operator overrides by design (audit is read-only and
 * stateless; there is nothing to parameterize safely).
 */
import type { RegisteredToolName } from '../../utilities/tool-registry.js'
import { withActor } from '../../db/client.js'
import { runAudit } from '../../audit/runner.js'
import { sendSlackAlert, renderAuditAlert } from '../../utilities/slack-alert.js'

/** Warn findings below this count do not alert (noise floor). */
const WARN_ALERT_THRESHOLD = 5

export async function runAuditHandler(
  _toolName: RegisteredToolName,
  _payload: Record<string, unknown> | null,
): Promise<void> {
  void _toolName
  void _payload
  // withActor stamps hive.actor → audit_runs writer + history attribution.
  // (runAudit itself is read-only over invariants; the only write is the
  // audit_runs row inside the runner.)
  const run = await withActor('system:audit', () => runAudit())

  const criticalFailures = run.findings.filter((f) => f.severity === 'critical' && !f.pass)
  const warnFailures = run.findings.filter((f) => f.severity === 'warn' && !f.pass)

  const alertText = renderAuditAlert(
    run.run_id,
    run.score,
    criticalFailures,
    warnFailures,
    WARN_ALERT_THRESHOLD,
  )
  if (alertText) {
    const result = await sendSlackAlert(alertText, process.env['ALERT_SLACK_WEBHOOK_URL'])
    if (!result.delivered) {
      // Log-but-never-throw: alert delivery failure must not fail the audit.
      console.error(
        `[run_audit] slack alert not delivered (reason=${result.reason ?? 'unknown'} status=${result.status === undefined ? 'n/a' : String(result.status)}) — run #${String(run.run_id)}`,
      )
    }
  }
}
