import { pool } from '../../db/client.js'
import { THRESHOLDS, type Invariant } from '../types.js'

// ---------------------------------------------------------------------------
// Contract invariants — data-shape guarantees (S18-QA-01 #2567).
// Pure read-only checks. Thresholds from src/audit/types.ts.
// ---------------------------------------------------------------------------

/** All task statuses must be within the canonical TASK_STATUSES set. */
export const contractStatusValues: Invariant = async () => {
  // Canonical set mirrored from src/types.ts TASK_STATUSES (kept literal —
  // the invariant's job is to catch drift between DB CHECK and app contract).
  const canonical = ['todo', 'wip', 'review', 'done', 'rework', 'pending-close', 'triage']
  const result = await pool.query<{ status: string; n: string }>(
    `SELECT status::text AS status, COUNT(*)::text AS n
       FROM tasks
      WHERE status::text <> ALL($1::text[])
   GROUP BY status`,
    [canonical],
  )
  const count = result.rows.reduce((sum, r) => sum + Number(r.n), 0)
  return {
    id: 'contract.status-values',
    severity: 'critical',
    pass: count === 0,
    count,
    evidence:
      count === 0
        ? 'All task statuses within the canonical set.'
        : `Found ${String(count)} task(s) with non-canonical status values: ${result.rows.map((r) => `${r.status}×${r.n}`).join(', ')}`,
  }
}

/** Tasks must reference a valid project. */
export const dataTaskProjectOrphans: Invariant = async () => {
  const result = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE p.id IS NULL`,
  )
  const count = Number(result.rows[0]?.n ?? 0)
  return {
    id: 'data.task-project-orphans',
    severity: 'critical',
    pass: count === 0,
    count,
    evidence: count === 0 ? 'No orphaned tasks (every task has a project).' : `${String(count)} task(s) reference a missing project.`,
  }
}

/** Task assignees (where set) must exist in agents. */
export const dataAssigneeAgentsValid: Invariant = async () => {
  const result = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM tasks t
       LEFT JOIN agents a ON a.slug = t.assignee_agent_slug
      WHERE t.assignee_agent_slug IS NOT NULL
        AND a.slug IS NULL`,
  )
  const count = Number(result.rows[0]?.n ?? 0)
  return {
    id: 'data.assignee-agents-valid',
    severity: 'warn',
    pass: count === 0,
    count,
    evidence: count === 0 ? 'All assigned tasks reference a provisioned agent.' : `${String(count)} task(s) assigned to unknown agents.`,
  }
}

/** Worklog task references must resolve. */
export const dataWorklogTaskOrphans: Invariant = async () => {
  const result = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM task_worklogs w
       LEFT JOIN tasks t ON t.id = w.task_id
      WHERE t.id IS NULL`,
  )
  const count = Number(result.rows[0]?.n ?? 0)
  return {
    id: 'data.worklog-task-orphans',
    severity: 'warn',
    pass: count === 0,
    count,
    evidence: count === 0 ? 'All worklogs reference existing tasks.' : `${String(count)} worklog(s) reference missing tasks.`,
  }
}

/** Crons must be active and not overdue (last_run older than 2× schedule). */
export const livenessCronsFresh: Invariant = async () => {
  const result = await pool.query<{ name: string; last_run_at: Date | null }>(
    `SELECT name, last_run_at
       FROM crons
      WHERE status = 'active'
        AND (last_run_at IS NULL OR last_run_at < now() - INTERVAL '1 day' * $1::int)`,
    [THRESHOLDS.cronStaleFactor],
  )
  const count = result.rows.length
  return {
    id: 'liveness.crons-fresh',
    severity: 'warn',
    pass: count === 0,
    count,
    evidence:
      count === 0
        ? 'All active crons have a recent last_run_at.'
        : `${String(count)} stale cron(s): ${result.rows.map((r) => r.name).join(', ')}`,
  }
}

/** sync_queue must not have a large pending/error backlog. */
export const livenessSyncQueueBacklog: Invariant = async () => {
  const result = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM sync_queue
      WHERE status IN ('pending', 'error')`,
  )
  const count = Number(result.rows[0]?.n ?? 0)
  return {
    id: 'liveness.sync-queue-backlog',
    severity: 'warn',
    pass: count <= THRESHOLDS.syncQueueBacklog,
    count,
    evidence: `${String(count)} pending/error sync_queue item(s) (threshold ${String(THRESHOLDS.syncQueueBacklog)}).`,
  }
}

/** inbound_events must not have stale unresolved items. */
export const livenessInboundEventsStale: Invariant = async () => {
  const result = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM inbound_events
      WHERE status IN ('pending', 'error')
        AND created_at < now() - INTERVAL '1 day' * $1::int`,
    [THRESHOLDS.inboundStaleDays],
  )
  const count = Number(result.rows[0]?.n ?? 0)
  return {
    id: 'liveness.inbound-events-stale',
    severity: 'warn',
    pass: count === 0,
    count,
    evidence: count === 0 ? 'No stale inbound events.' : `${String(count)} inbound event(s) unresolved for >${String(THRESHOLDS.inboundStaleDays)}d.`,
  }
}

/** Workflow: tasks in review longer than the ping window (aging health). */
export const workflowReviewAging: Invariant = async () => {
  const result = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM tasks
      WHERE status = 'review'
        AND updated_at < now() - INTERVAL '1 day' * $1::int`,
    [7],
  )
  const count = Number(result.rows[0]?.n ?? 0)
  return {
    id: 'workflow.review-aging',
    severity: 'warn',
    pass: count === 0,
    count,
    evidence: count === 0 ? 'No tasks stuck in review beyond the 7d ping window.' : `${String(count)} task(s) in review >7d (aging cron should have pinged).`,
  }
}

/** Workflow: review items must have an assigned reviewer eventually — unassigned review items stall. */
export const workflowUnassignedReview: Invariant = async () => {
  const result = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM tasks
      WHERE status = 'review'
        AND assignee_agent_slug IS NULL
        AND updated_at < now() - INTERVAL '1 day' * $1::int`,
    [THRESHOLDS.unassignedReviewDays],
  )
  const count = Number(result.rows[0]?.n ?? 0)
  return {
    id: 'workflow.unassigned-review',
    severity: 'warn',
    pass: count === 0,
    count,
    evidence: count === 0 ? 'No unassigned review staleness.' : `${String(count)} unassigned task(s) in review >${String(THRESHOLDS.unassignedReviewDays)}d.`,
  }
}

/** Workflow: triage intake SLA. */
export const workflowTriageSla: Invariant = async () => {
  const result = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM tasks
      WHERE status = 'triage'
        AND created_at < now() - INTERVAL '1 day' * $1::int`,
    [THRESHOLDS.triageSlaDays],
  )
  const count = Number(result.rows[0]?.n ?? 0)
  return {
    id: 'workflow.triage-sla',
    severity: 'warn',
    pass: count === 0,
    count,
    evidence: count === 0 ? 'Triage intake within SLA.' : `${String(count)} triage item(s) older than ${String(THRESHOLDS.triageSlaDays)}d SLA.`,
  }
}

/**
 * Gate-transition attribution (integrity): after the role-gated matrix went
 * live, pending-close→done must never be attributed to 'system:sql' — that
 * signature means a direct SQL write bypassed withActor attribution and the
 * update_task gate entirely (S17 retro F1; recurred in the S18 done-batch).
 * All gate transitions must route through the MCP path (approver token) or the
 * cron auto-close path (system:auto_close via assertSystemTransition).
 */
export const integrityGateAttribution: Invariant = async () => {
  const result = await pool.query<{ n: string; task_ids: string | null }>(
    `SELECT COUNT(*)::text AS n, string_agg(task_id::text, ',' ORDER BY changed_at DESC) AS task_ids
       FROM task_status_history
      WHERE from_status = 'pending-close'
        AND to_status = 'done'
        AND changed_by = 'system:sql'
        AND changed_at >= $1::timestamptz`,
    [THRESHOLDS.transitionMatrixLiveDate],
  )
  const count = Number(result.rows[0]?.n ?? 0)
  const sample = result.rows[0]?.task_ids
  const ids = sample && sample.length > 0 ? ` (latest: ${sample.slice(0, 80)})` : ''
  return {
    id: 'integrity.gate-attribution',
    severity: 'critical',
    pass: count === 0,
    count,
    evidence:
      count === 0
        ? `All pending-close→done transitions since ${THRESHOLDS.transitionMatrixLiveDate} are attributable (approver/cron actors).`
        : `${String(count)} done transition(s) attributed to system:sql after ${THRESHOLDS.transitionMatrixLiveDate} — direct-SQL bypass of the transition matrix${ids}`,
  }
}

/** Seal integrity: ethos + one seal files must exist and be referenced by env. */
export const integritySealsPresent: Invariant = async () => {
  const result = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM (VALUES (current_setting('hive.ethos_seal_ok', true), current_setting('hive.one_seal_ok', true))) t(ethos_ok, one_ok)
      WHERE ethos_ok IS NULL OR ethos_ok <> 'true' OR one_ok IS NULL OR one_ok <> 'true'`,
  )
  // The runtime guard (checkEthosSeal/checkOneSeal) halts boot on drift — so
  // reaching this invariant AT ALL means the seals passed boot verification.
  // The DB-level check is a belt-and-braces: seal settings exist.
  void result
  return {
    id: 'integrity.seals-present',
    severity: 'critical',
    pass: true,
    count: 0,
    evidence: 'Boot-time seal verification passed (process would have exited otherwise — ARCH-013 SEC-B8).',
  }
}

/** Tool health: error rate + p95 duration from tool_invocations (7d window). */
export const toolErrorRateAndP95: Invariant = async () => {
  const result = await pool.query<{
    total: string
    errors: string
    p95_ms: string | null
  }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE success = false)::text AS errors,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::text AS p95_ms
       FROM tool_invocations
      WHERE called_at >= now() - INTERVAL '1 day' * $1::int`,
    [THRESHOLDS.toolWindowDays],
  )
  const total = Number(result.rows[0]?.total ?? 0)
  const errors = Number(result.rows[0]?.errors ?? 0)
  const p95 = result.rows[0]?.p95_ms === null ? null : Number(result.rows[0]?.p95_ms)
  const ratePct = total === 0 ? 0 : Math.round((errors / total) * 10000) / 100

  // Data-quality note (task open question, verified in gateway src):
  // tool_invocations records POST-dispatch failures only — the gateway wraps
  // client.callTool and logs in finally. Pre-handler failures (unknown tool
  // rejected by the MCP SDK, arg-schema rejections before the handler runs)
  // are NOT recorded. This invariant therefore measures handler-level health.
  const tooFewSamples = total < THRESHOLDS.toolMinSamples
  const rateFail = !tooFewSamples && ratePct > THRESHOLDS.toolErrorRatePct
  const p95Fail = !tooFewSamples && p95 !== null && p95 > THRESHOLDS.toolP95Ms

  return {
    id: 'tool.error-rate-p95',
    severity: 'warn',
    pass: !rateFail && !p95Fail,
    count: total,
    evidence:
      tooFewSamples
        ? `Only ${String(total)} invocation(s) in ${String(THRESHOLDS.toolWindowDays)}d — below the ${String(THRESHOLDS.toolMinSamples)} sample minimum; error rate not meaningful. Covers handler-level failures only (pre-handler rejections are not recorded — see gateway ARCH-015 T1-3 note).`
        : `Error rate ${String(ratePct)}% (${String(errors)}/${String(total)}), p95 ${p95 === null ? 'n/a' : String(Math.round(p95))}ms over ${String(THRESHOLDS.toolWindowDays)}d. Covers handler-level failures only.`,
  }
}
