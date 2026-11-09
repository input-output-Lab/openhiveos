// ---------------------------------------------------------------------------
// Audit types + thresholds — S18-QA-01 (#2567).
//
// SCOPE NOTE (co-owner contract): the L10 spec assigns threshold definition
// to Scout. Scout's tuned values are pending; the values below are Murphy's
// seeded defaults, centralized in this one file so Scout can retune WITHOUT
// touching any SQL or invariant logic. Every invariant reads its thresholds
// from THRESHOLDS — nothing is hardcoded in the queries.
// ---------------------------------------------------------------------------

export type Severity = 'info' | 'warn' | 'critical'

export interface InvariantResult {
  /** Stable identifier, e.g. 'contract.status-values'. */
  id: string
  severity: Severity
  pass: boolean
  /** Human-readable one-liner of what was checked and what was found. */
  evidence: string
  /** Row/occurrence count backing the check (0 for boolean checks). */
  count: number
}

/** Every invariant is a pure read-only check — no writes, no side effects. */
export type Invariant = () => Promise<InvariantResult>

export const THRESHOLDS = {
  /** Tasks sitting in review longer than this are workflow findings (matches aging ping 7d). */
  unassignedReviewDays: 2,
  /** Triage items older than this breach the intake SLA (ARCH-024). */
  triageSlaDays: 7,
  /** Crons not run (last_run_at) within this many multiples of schedule → stale. */
  cronStaleFactor: 2,
  /** sync_queue items in pending/error beyond this count → backlog finding. */
  syncQueueBacklog: 50,
  /** inbound_events pending/error older than this many days → stale intake. */
  inboundStaleDays: 2,
  /** Tool error rate (%) above this in the window → degraded. */
  toolErrorRatePct: 5,
  /** Tool p95 duration (ms) above this in the window → slow (informational). */
  toolP95Ms: 10_000,
  /** Minimum tool_invocations in window before error-rate is meaningful. */
  toolMinSamples: 20,
  /** Tool look-back window (days) for error rate / p95. */
  toolWindowDays: 7,
} as const

/**
 * Score: severity-weighted pass rate.
 *   critical = 3, warn = 1, info = 0 (informational checks don't hurt)
 * 100 only when every critical+warn passes.
 */
export function computeScore(results: InvariantResult[]): number {
  const weights: Record<Severity, number> = { critical: 3, warn: 1, info: 0 }
  let total = 0
  let earned = 0
  for (const r of results) {
    const w = weights[r.severity]
    total += w
    if (r.pass) earned += w
  }
  if (total === 0) return 100
  return Math.round((earned / total) * 10000) / 100
}
