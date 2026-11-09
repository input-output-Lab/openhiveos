import { z } from 'zod'
import { runAudit, INVARIANTS } from '../audit/runner.js'
import { computeScore, THRESHOLDS, type InvariantResult } from '../audit/types.js'

// ---------------------------------------------------------------------------
// audit_hive — S18-QA-01 (#2567).
//
// Runs the full read-only invariant library, persists one audit_runs row,
// and returns score + findings. The ONLY write is the audit_runs history
// row (by design — the audit record must exist beyond the response).
//
// Co-owner: Scout (invariant definitions + thresholds). Thresholds live in
// src/audit/types.ts THRESHOLDS for Scout to tune without touching SQL.
// ---------------------------------------------------------------------------

/** MCP-facing shape. Kept a plain ZodObject so `.shape` is available. */
export const auditHiveSchema = z.object({
  include_passing: z.boolean().optional(),
})

export type AuditHiveArgs = z.infer<typeof auditHiveSchema>

export async function handleAuditHive(args: AuditHiveArgs) {
  const includePassing = args.include_passing ?? true

  try {
    const run = await runAudit()
    const findings = includePassing
      ? run.findings
      : run.findings.filter((f: InvariantResult) => !f.pass)

    const critical = run.findings.filter((f) => f.severity === 'critical' && !f.pass)
    const warns = run.findings.filter((f) => f.severity === 'warn' && !f.pass)

    const summary = [
      `Hive audit run #${String(run.run_id)}: score ${String(run.score)}/100 (${String(run.invariants_run)} invariants, ${String(run.duration_ms)}ms).`,
      `${String(critical.length)} critical failure(s), ${String(warns.length)} warning(s).`,
      'Thresholds: src/audit/types.ts THRESHOLDS (Scout-tunable).',
    ].join(' ')

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              run_id: run.run_id,
              score: run.score,
              duration_ms: run.duration_ms,
              invariants_run: run.invariants_run,
              critical_failures: critical.length,
              warnings: warns.length,
              summary,
              findings,
            },
            null,
            2,
          ),
        },
      ],
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: 'audit_failed', message }) }],
      isError: true,
    }
  }
}

// Exposed for tests / Scout's threshold review.
export { INVARIANTS, computeScore, THRESHOLDS }
