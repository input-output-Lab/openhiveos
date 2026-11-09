/**
 * S18-BE-01 (#2564) — Usage ingestion: persist collected VS Code Copilot usage
 * into llm_usage with idempotent dedup.
 *
 * Spike S16-SPK-01 (task 2544) selected the VS Code local session store as the
 * primary surface; collectUsage() (S16-BE-02) already reads it. This module is
 * the write path: collector output → llm_usage rows.
 *
 * Semantics:
 *  - Dedup: UNIQUE (session_id, loop_index) — INSERT ... ON CONFLICT DO NOTHING,
 *    so replays of overlapping --since windows are free.
 *  - session_id stores the raw VS Code session GUID (stable per surface).
 *  - client_surface = 'vscode-copilot' (DB check constraint value).
 *  - cost_usd = 0 with cost_source='estimated': tokens are exact, price
 *    application is downstream (llm_model_prices), never fabricated here.
 *  - task_id stays NULL until gateway enrichment maps sessions → tasks.
 */
import { Client } from 'pg'
import { collectUsage, type SessionUsage } from './collector.js'

export interface IngestResult {
  sessionsScanned: number
  sessionsWithUsage: number
  rowsInserted: number
  rowsSkipped: number
}

export interface IngestOptions {
  since?: string
  workspaceHash?: string
  databaseUrl?: string
  /** Test seam: inject usage instead of running the real collector. */
  sessions?: SessionUsage[]
}

function loopTimestampToRequestedAt(entry: {
  timestamp: number | null
}): Date | null {
  if (entry.timestamp === null || !Number.isFinite(entry.timestamp)) return null
  return new Date(entry.timestamp)
}

/** provider is NOT NULL in llm_usage; the collector can emit null for
 *  un-prefixed model ids. Absorb at the boundary (system-boundary pattern). */
function providerOrUnknown(provider: string | null, canonicalModel: string): string {
  return provider ?? canonicalModel.split('/')[0] ?? 'unknown'
}

export async function ingestUsage(options: IngestOptions = {}): Promise<IngestResult> {
  const result =
    options.sessions !== undefined
      ? { generatedAt: new Date().toISOString(), machine: 'injected', sessions: options.sessions, summary: { sessionsScanned: options.sessions.length, sessionsWithUsage: options.sessions.filter((s) => s.usage.length > 0).length, totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0 } }
      : await collectUsage({
          ...(options.since !== undefined ? { since: options.since } : {}),
          ...(options.workspaceHash !== undefined ? { workspaceHash: options.workspaceHash } : {}),
        })

  const client = new Client({ connectionString: options.databaseUrl ?? process.env['DATABASE_URL'] })
  await client.connect()

  let rowsInserted = 0
  let rowsSkipped = 0

  try {
    for (const session of result.sessions) {
      for (let index = 0; index < session.usage.length; index++) {
        const usageEntry = session.usage[index]
        if (usageEntry === undefined) continue // defensive: array mutated mid-run by a live session
        const requestedAt = loopTimestampToRequestedAt(usageEntry)

        // Counting without xmax internals: RETURNING ctid is non-null only for
        // inserted rows; ON CONFLICT DO NOTHING returns zero rows on conflict.
        const inserted = await client.query<{ inserted: boolean }>(
          `INSERT INTO llm_usage (
             session_id, loop_index, agent_slug, model, provider,
             prompt_tokens, completion_tokens, cost_usd, cost_source,
             client_surface, requested_at, request_id, reasoning_tokens, prompt_token_details
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'estimated', 'vscode-copilot', $9, $10, NULL, $11)
           ON CONFLICT (session_id, loop_index) DO NOTHING
           RETURNING true AS inserted`,
          [
            session.sessionId,
            index,
            'vscode-copilot-local', // local-store surface; gateway self-reports use real agent slugs
            usageEntry.canonicalModel,
            providerOrUnknown(usageEntry.provider, usageEntry.canonicalModel),
            usageEntry.promptTokens,
            usageEntry.completionTokens,
            0,
            requestedAt,
            usageEntry.requestId,
            usageEntry.promptCategories === null ? null : JSON.stringify(usageEntry.promptCategories),
          ],
        )

        if (inserted.rows.length > 0) rowsInserted += 1
        else rowsSkipped += 1
      }
    }
  } finally {
    await client.end()
  }

  return {
    sessionsScanned: result.summary.sessionsScanned,
    sessionsWithUsage: result.summary.sessionsWithUsage,
    rowsInserted,
    rowsSkipped,
  }
}
