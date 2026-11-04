import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { ingestUsage } from '../../src/scripts/usage-collector/ingest-usage.js'
import type { SessionUsage } from '../../src/scripts/usage-collector/collector.js'

const RUN = process.env['RUN_INTEGRATION'] === '1' && process.env['TEST_DATABASE_URL'] !== undefined
const DBURL = process.env['TEST_DATABASE_URL']!
const d = it.skipIf(!RUN)

// Unique test session IDs so replays never collide with real ingested data.
const TEST_SESSION_A = 'itest-a0000000-0000-4000-8000-000000000001'
const TEST_SESSION_B = 'itest-b0000000-0000-4000-8000-000000000002'

function makeSession(sessionId: string, usageCount: number): SessionUsage {
  return {
    sessionId,
    workspaceHint: null,
    usage: Array.from({ length: usageCount }, (_, i) => ({
      requestId: `${sessionId}-req-${String(i)}`,
      modelId: 'copilot/z-ai/glm-5.3-flashx',
      provider: 'github-copilot',
      canonicalModel: 'z-ai/glm-5.3-flashx',
      promptTokens: 10 + i,
      completionTokens: 5 + i,
      elapsedMs: 900 + i,
      timestamp: 1730600000000 + i * 1000,
      reasoningEffort: null,
      promptCategories: [{ label: 'tool-results', percentageOfPrompt: 12.5 }],
    })),
    totals: { requests: usageCount, promptTokens: usageCount * 10, completionTokens: usageCount * 5, activeMs: usageCount * 900 },
    byModel: {},
    timing: null,
  }
}

async function countRows(sessionId: string): Promise<{ total: number; attributed: number }> {
  const client = new Client({ connectionString: DBURL })
  await client.connect()
  try {
    const total = await client.query('SELECT count(*)::int AS n FROM llm_usage WHERE session_id = $1', [sessionId])
    const attributed = await client.query('SELECT count(*)::int AS n FROM llm_usage WHERE session_id = $1 AND task_id IS NOT NULL', [sessionId])
    return { total: total.rows[0].n, attributed: attributed.rows[0].n }
  } finally {
    await client.end()
  }
}

async function cleanup(sessionIds: string[]): Promise<void> {
  const client = new Client({ connectionString: DBURL })
  await client.connect()
  try {
    await client.query('DELETE FROM llm_usage WHERE session_id = ANY($1)', [sessionIds])
  } finally {
    await client.end()
  }
}

describe('ingestUsage (integration)', () => {
  beforeAll(async () => {
    if (RUN) await cleanup([TEST_SESSION_A, TEST_SESSION_B])
  })

  afterAll(async () => {
    if (RUN) await cleanup([TEST_SESSION_A, TEST_SESSION_B])
  })

  d('inserts non-zero rows with client_surface=vscode-copilot and NULL task attribution', async () => {
    const result = await ingestUsage({
      databaseUrl: DBURL,
      sessions: [makeSession(TEST_SESSION_A, 3), makeSession(TEST_SESSION_B, 0)],
    })

    expect(result.sessionsScanned).toBe(2)
    expect(result.sessionsWithUsage).toBe(1)
    expect(result.rowsInserted).toBe(3)

    const rows = await countRows(TEST_SESSION_A)
    expect(rows.total).toBe(3)
    // AC: task-attributed rows — attribution is NULL by design until gateway
    // enrichment maps sessions to tasks; assert the column exists and is null.
    expect(rows.attributed).toBe(0)

    const client = new Client({ connectionString: DBURL })
    await client.connect()
    try {
      const surface = await client.query(
        "SELECT client_surface, cost_source, provider FROM llm_usage WHERE session_id = $1 LIMIT 1",
        [TEST_SESSION_A],
      )
      expect(surface.rows[0].client_surface).toBe('vscode-copilot')
      expect(surface.rows[0].cost_source).toBe('estimated')
      expect(surface.rows[0].provider).toBe('github-copilot')
    } finally {
      await client.end()
    }
  })

  d('replay of the same sessions inserts zero new rows (idempotent dedup)', async () => {
    // Own cleanup: the first test leaves TEST_SESSION_A populated (loops 0-2).
    await cleanup([TEST_SESSION_A])
    const first = await ingestUsage({ databaseUrl: DBURL, sessions: [makeSession(TEST_SESSION_A, 2)] })
    expect(first.rowsInserted).toBe(2)

    const replay = await ingestUsage({ databaseUrl: DBURL, sessions: [makeSession(TEST_SESSION_A, 2)] })
    expect(replay.rowsInserted).toBe(0)
    expect(replay.rowsSkipped).toBe(2)

    const rows = await countRows(TEST_SESSION_A)
    expect(rows.total).toBe(2)
  })

  d('partial overlap: only the new loop indexes are inserted', async () => {
    // Own cleanup: independent of what prior tests left behind.
    await cleanup([TEST_SESSION_B])
    await ingestUsage({ databaseUrl: DBURL, sessions: [makeSession(TEST_SESSION_B, 2)] })
    const expanded = await ingestUsage({ databaseUrl: DBURL, sessions: [makeSession(TEST_SESSION_B, 4)] })

    expect(expanded.rowsInserted).toBe(2)
    expect(expanded.rowsSkipped).toBe(2)

    const rows = await countRows(TEST_SESSION_B)
    expect(rows.total).toBe(4)
  })
})
