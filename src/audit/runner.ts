import { pool } from '../db/client.js'
import { computeScore, type Invariant, type InvariantResult } from './types.js'
import {
  contractStatusValues,
  dataTaskProjectOrphans,
  dataAssigneeAgentsValid,
  dataWorklogTaskOrphans,
  livenessCronsFresh,
  livenessSyncQueueBacklog,
  livenessInboundEventsStale,
  workflowReviewAging,
  workflowUnassignedReview,
  workflowTriageSla,
  integrityGateAttribution,
  integritySealsPresent,
  toolErrorRateAndP95,
} from './invariants/index.js'

// ---------------------------------------------------------------------------
// Audit runner — S18-QA-01 (#2567).
//
// Executes the full invariant library (pure read-only checks), computes the
// severity-weighted score, and persists one audit_runs row. The runner is
// the ONLY writer; invariants never write.
// ---------------------------------------------------------------------------

/** The canonical library, in stable execution order. */
export const INVARIANTS: ReadonlyArray<Invariant> = [
  // Contract
  contractStatusValues,
  // Data integrity
  dataTaskProjectOrphans,
  dataAssigneeAgentsValid,
  dataWorklogTaskOrphans,
  // Liveness
  livenessCronsFresh,
  livenessSyncQueueBacklog,
  livenessInboundEventsStale,
  // Workflow
  workflowReviewAging,
  workflowUnassignedReview,
  workflowTriageSla,
  // Integrity
  integrityGateAttribution,
  integritySealsPresent,
  // Tool health
  toolErrorRateAndP95,
]

export interface AuditRunResult {
  run_id: number
  score: number
  duration_ms: number
  invariants_run: number
  findings: InvariantResult[]
}

/** A single invariant failing to EXECUTE (bug) becomes a critical failure — never swallowed. */
async function safeRun(invariant: Invariant): Promise<InvariantResult> {
  try {
    return await invariant()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Synthetic id (stable prefix + error hash-ish suffix) — the invariant's
    // own id is unknown when it throws before returning.
    return {
      id: `internal.invariant-error.${String(Math.abs(message.length * 31) % 100000)}`,
      severity: 'critical',
      pass: false,
      count: 1,
      evidence: `Invariant itself threw: ${message}`,
    }
  }
}

export async function runAudit(): Promise<AuditRunResult> {
  const start = Date.now()
  const findings: InvariantResult[] = []
  for (const invariant of INVARIANTS) {
    findings.push(await safeRun(invariant))
  }
  const durationMs = Date.now() - start
  const score = computeScore(findings)

  const insert = await pool.query<{ id: number }>(
    `INSERT INTO audit_runs (duration_ms, score, invariants_run, findings)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [durationMs, score, findings.length, JSON.stringify(findings)],
  )

  const runId = insert.rows[0]?.id
  if (runId === undefined) {
    throw new Error('audit_runs INSERT returned no id')
  }

  return {
    run_id: runId,
    score,
    duration_ms: durationMs,
    invariants_run: findings.length,
    findings,
  }
}
