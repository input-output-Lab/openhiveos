import { z } from 'zod'
import { config } from '../config.js'

// ---------------------------------------------------------------------------
// report_usage — ARCH-015 (LLM usage ingestion)
//
// Publishes LLM token consumption and cost data from Bridge to the squad-api
// /internal/usage endpoint. Called by Bridge after each agent loop with the
// model name and cost values extracted from the VS Code chat footer
// ("Claude Sonnet 4.6 • 39.9 credits").
//
// SEC-C4  — Zod validates all fields; .strict() rejects unknown fields.
// SEC-C5  — session_id regex: ^[a-z][a-z0-9_-]*:[^:]+:\d{13}$
// SEC-C9  — REVISED v2 (ruling #1096): cost_usd optional; server estimates
//           when absent. cost_source is server-owned and not caller-settable.
// SEC-C10 — OPENHIVEOS_INGESTION_TOKEN is optional; POST fails gracefully if token unavailable.
// ---------------------------------------------------------------------------

const SESSION_ID_REGEX = /^[a-z][a-z0-9_-]*:[^:]+:\d{13}$/

// Payload schema mirrors the internal.ts UsagePayloadSchema
// .strict() rejects any fields not listed here (SEC-C4: unknown fields rejected)
// S17-DB-01 (#2553): mirrors the new optional migration-022 fields so MCP
// callers (agents, collector tooling) can attribute usage the same way.
export const reportUsageSchema = z
  .object({
    session_id: z.string().regex(SESSION_ID_REGEX),
    loop_index: z.number().int().min(0),
    agent_slug: z.string().min(1).max(64),
    model: z.string().min(1).max(256),
    provider: z.string().min(1).max(128),
    prompt_tokens: z.number().int().min(0),
    completion_tokens: z.number().int().min(0),
    // SEC-C9 v2 (ruling #1096): optional — server estimates when absent.
    cost_usd: z.number().min(0).optional(),
    cache_read_tokens: z.number().int().min(0).optional(),
    cache_creation_tokens: z.number().int().min(0).optional(),
    task_id: z.number().int().positive().optional(),
    project_id: z.number().int().positive().optional(),
    client_surface: z.enum(['vscode-copilot', 'claude-code', 'bridge', 'cli', 'cron', 'api']).optional(),
    requested_at: z.string().datetime({ offset: true }).optional(),
    request_id: z.string().min(1).max(256).optional(),
    reasoning_tokens: z.number().int().min(0).optional(),
    prompt_token_details: z
      .array(
        z.object({
          label: z.string().min(1).max(128),
          percentageOfPrompt: z.number().min(0).max(100),
        }),
      )
      .max(32)
      .optional(),
  })
  .strict()

export type ReportUsageInput = z.infer<typeof reportUsageSchema>

export async function handleReportUsage(input: ReportUsageInput): Promise<{
  success: boolean
  message: string
  statusCode?: number
}> {
  const parsed = reportUsageSchema.parse(input)

  // SEC-C10: token is optional; fail gracefully if unavailable
  if (!config.OPENHIVEOS_INGESTION_TOKEN) {
    return {
      success: false,
      message:
        'LLM usage reporting is not configured (OPENHIVEOS_INGESTION_TOKEN not set). Data was not ingested.',
    }
  }

  try {
    const response = await fetch(`${config.SQUAD_API_URL}/internal/usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.OPENHIVEOS_INGESTION_TOKEN}`,
      },
      body: JSON.stringify(parsed),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      return {
        success: false,
        message: `Squad API returned ${String(response.status)}: ${errorBody}`,
        statusCode: response.status,
      }
    }

    return {
      success: true,
      message: `LLM usage reported successfully (${parsed.model})`,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      message: `Failed to report LLM usage: ${errorMsg}. Check SQUAD_API_URL configuration.`,
    }
  }
}
