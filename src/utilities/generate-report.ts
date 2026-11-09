import { z } from 'zod'
import { generateReport } from '../services/reports/index.js'

// ---------------------------------------------------------------------------
// generate_report — S18-BE-03 (#2562).
//
// MCP-facing wrapper over the report service (src/services/reports/):
//   scope: 'project' (requires project_id) | 'hive' (portfolio)
//   period: analysis window in days, 1..90, default 14 (sprint)
//   format: 'md' (paste-ready for docs/minutes) | 'json' (programmatic)
//
// Every rendered section labels its data source + coverage — the report is
// honest about what backs each number (AC). Zero side effects: this tool
// only reads. No actor/permission gating beyond caller authentication —
// reports contain internal metrics already readable via query_projects /
// query_tasks by any authenticated agent.
// ---------------------------------------------------------------------------

/** MCP-facing shape. Kept a plain ZodObject so `.shape` is available. */
export const generateReportSchema = z.object({
  scope: z.enum(['project', 'hive']),
  project_id: z.number().int().positive().optional(),
  period: z.number().int().min(1).max(90).optional(),
  format: z.enum(['md', 'json']).optional(),
})

export type GenerateReportArgs = z.infer<typeof generateReportSchema>

export async function handleGenerateReport(args: GenerateReportArgs) {
  const scope = args.scope
  const periodDays = args.period ?? 14
  const format = args.format ?? 'md'

  if (scope === 'project' && !args.project_id) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: 'invalid_request',
            message: 'scope=project requires project_id.',
          }),
        },
      ],
      isError: true,
    }
  }

  try {
    // exactOptionalPropertyTypes: only pass projectId when defined.
    const { report, markdown } = await generateReport({
      scope,
      periodDays,
      ...(args.project_id !== undefined ? { projectId: args.project_id } : {}),
    })

    if (format === 'json') {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }],
      }
    }

    return {
      content: [{ type: 'text' as const, text: markdown }],
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: 'report_failed', message }) }],
      isError: true,
    }
  }
}
