import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { collectUsage, normalizeModelId } from '../../src/scripts/usage-collector/collector.js'

// ---------------------------------------------------------------------------
// S16-BE-02: collector unit tests — synthetic fixtures mirroring the exact
// structures verified in spike #2544 (chatSessions v-list entries with
// modelId/promptTokens/completionTokens/elapsedMs; transcript event ledger).
// ---------------------------------------------------------------------------

async function makeTempWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-collector-test-'))
  return root
}

async function writeWorkspaceFixture(
  root: string,
  hash: string,
  opts: {
    sessionFile: string
    chatSessionLines: unknown[]
    transcriptLines?: unknown[]
  },
): Promise<void> {
  const ws = path.join(root, 'workspaceStorage', hash)
  await fs.mkdir(path.join(ws, 'chatSessions'), { recursive: true })
  await fs.mkdir(path.join(ws, 'GitHub.copilot-chat', 'transcripts'), { recursive: true })
  await fs.writeFile(path.join(ws, 'chatSessions', opts.sessionFile), opts.chatSessionLines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  if (opts.transcriptLines) {
    await fs.writeFile(
      path.join(ws, 'GitHub.copilot-chat', 'transcripts', opts.sessionFile),
      opts.transcriptLines.map((l) => JSON.stringify(l)).join('\n') + '\n',
    )
  }
}

// mirror of a real chatSessions line: {kind, v:{'0': requestNode, ...}}
function chatLine(requests: Record<string, unknown>[]): unknown {
  const v: Record<string, unknown> = {}
  requests.forEach((r, i) => {
    v[String(i)] = r
  })
  return { kind: 0, v }
}

describe('normalizeModelId', () => {
  it('resolves openrouter/OpenRouter/ prefix', () => {
    expect(normalizeModelId('openrouter/OpenRouter/z-ai/glm-5.3-flashx')).toEqual({
      provider: 'openrouter',
      canonicalModel: 'z-ai/glm-5.3-flashx',
    })
  })

  it('resolves copilot/ prefix', () => {
    expect(normalizeModelId('copilot/claude-opus-5.5')).toEqual({
      provider: 'github-copilot',
      canonicalModel: 'claude-opus-5.5',
    })
  })

  it('resolves copilotcli/ prefix', () => {
    expect(normalizeModelId('copilotcli/claude-sonnet-4.6')).toEqual({
      provider: 'github-copilot-cli',
      canonicalModel: 'claude-sonnet-4.6',
    })
  })

  it('treats raw vendor/model as its own provider', () => {
    expect(normalizeModelId('z-ai/glm-5.3-flashx')).toEqual({
      provider: 'z-ai',
      canonicalModel: 'z-ai/glm-5.3-flashx',
    })
  })

  it('handles model with no slash', () => {
    expect(normalizeModelId('gpt-5.6-luna')).toEqual({ provider: null, canonicalModel: 'gpt-5.6-luna' })
  })

  it('openrouter alias canonicalizes to the raw vendor form (spike: 4 variants → one model)', () => {
    const a = normalizeModelId('openrouter/OpenRouter/z-ai/glm-5.3-flashx')
    const b = normalizeModelId('z-ai/glm-5.3-flashx')
    expect(a.canonicalModel).toBe(b.canonicalModel)
  })
})

describe('collectUsage', () => {
  let root: string

  beforeAll(async () => {
    root = await makeTempWorkspace()

    // workspace A: two sessions — one with usage + transcript, one empty
    await writeWorkspaceFixture(root, 'hashA', {
      sessionFile: '11111111-1111-1111-1111-111111111111.jsonl',
      chatSessionLines: [
        { kind: 0, v: { version: 3, creationDate: 1, requests: [], pendingRequests: [] } },
        chatLine([
          {
            requestId: 'request_aaa',
            modelId: 'openrouter/OpenRouter/z-ai/glm-5.3-flashx',
            promptTokens: 1000,
            completionTokens: 100,
            elapsedMs: 2000,
            timestamp: 1730000000000,
            modelConfiguration: { reasoningEffort: 'max' },
            promptTokenDetails: [{ label: 'System Instructions', percentageOfPrompt: 50 }],
          },
          {
            requestId: 'request_bbb',
            modelId: 'copilot/claude-opus-5.5',
            promptTokens: 500,
            completionTokens: 50,
            elapsedMs: 1000,
            timestamp: 1730000600000,
          },
        ]),
      ],
      transcriptLines: [
        { type: 'session.start', timestamp: '2026-10-29T10:00:00.000Z' },
        { type: 'user.message', timestamp: '2026-10-29T10:00:01.000Z' },
        { type: 'tool.execution_start', timestamp: '2026-10-29T10:00:02.000Z' },
        { type: 'tool.execution_complete', timestamp: '2026-10-29T10:00:03.000Z' },
        { type: 'assistant.turn_start', timestamp: '2026-10-29T10:00:04.000Z' },
        { type: 'assistant.turn_end', timestamp: '2026-10-29T10:00:05.000Z' },
      ],
    })

    await writeWorkspaceFixture(root, 'hashA', {
      sessionFile: '22222222-2222-2222-2222-222222222222.jsonl',
      chatSessionLines: [{ kind: 0, v: { version: 3, requests: [] } }],
    })

    // workspace B: session with no transcript (timing join must be optional)
    await writeWorkspaceFixture(root, 'hashB', {
      sessionFile: '33333333-3333-3333-3333-333333333333.jsonl',
      chatSessionLines: [
        chatLine([
          {
            requestId: 'request_ccc',
            modelId: 'z-ai/glm-5.3-flashx',
            promptTokens: 2000,
            completionTokens: 200,
            elapsedMs: 3000,
            timestamp: 1730001200000,
          },
        ]),
      ],
    })

    // corrupted line inside a session must not abort the parse
    const ws = path.join(root, 'workspaceStorage', 'hashC', 'chatSessions')
    await fs.mkdir(ws, { recursive: true })
    await fs.writeFile(
      path.join(ws, '44444444-4444-4444-4444-444444444444.jsonl'),
      [
        JSON.stringify(chatLine([{ modelId: 'copilot/claude-haiku-4.5', promptTokens: 10, completionTokens: 5 }])),
        '{corrupted json line',
        JSON.stringify(chatLine([{ modelId: 'copilot/claude-haiku-4.5', promptTokens: 20, completionTokens: 10 }])),
      ].join('\n') + '\n',
    )
  })

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('collects per-request usage across workspaces with correct totals', async () => {
    const result = await collectUsage({ codeUserDir: root })
    // hashA(2 sessions) + hashB(1) + hashC(1) = 4 scanned
    // the empty hashA session is scanned but has zero usage → not counted
    expect(result.summary.sessionsScanned).toBe(4)
    expect(result.summary.sessionsWithUsage).toBe(3)
    // hashA(2 reqs) + hashB(1) + hashC(2 — one per surviving line around the corrupted one)
    expect(result.summary.totalRequests).toBe(5)
    expect(result.summary.totalPromptTokens).toBe(1000 + 500 + 2000 + 30)
    expect(result.summary.totalCompletionTokens).toBe(100 + 50 + 200 + 15)
  })

  it('joins transcript timing and counts event classes', async () => {
    const result = await collectUsage({ codeUserDir: root })
    const withTiming = result.sessions.find((s) => s.sessionId.startsWith('11111111'))
    expect(withTiming?.timing).not.toBeNull()
    expect(withTiming?.timing?.userMessages).toBe(1)
    expect(withTiming?.timing?.toolCalls).toBe(1)
    expect(withTiming?.timing?.assistantTurns).toBe(1)
    // 5-second span rounded to 2dp in the collector = 0 hours; assert raw math instead
    expect(withTiming?.timing?.lastEventAt).toBe('2026-10-29T10:00:05.000Z')
    const spanMs = Date.parse(withTiming!.timing!.lastEventAt!) - Date.parse(withTiming!.timing!.startedAt!)
    expect(spanMs).toBe(5000)
  })

  it('session without transcript has null timing but valid usage', async () => {
    const result = await collectUsage({ codeUserDir: root })
    const noTiming = result.sessions.find((s) => s.sessionId.startsWith('33333333'))
    expect(noTiming?.timing).toBeNull()
    expect(noTiming?.totals.requests).toBe(1)
  })

  it('normalizes provider from modelId', async () => {
    const result = await collectUsage({ codeUserDir: root })
    const s = result.sessions.find((x) => x.sessionId.startsWith('11111111'))!
    const providers = s.usage.map((u) => u.provider)
    expect(providers).toContain('openrouter')
    expect(providers).toContain('github-copilot')
    const gpt = s.usage.find((u) => u.reasoningEffort === 'max')
    expect(gpt?.promptCategories?.[0]?.label).toBe('System Instructions')
  })

  it('survives corrupted JSONL lines without aborting the session', async () => {
    const result = await collectUsage({ codeUserDir: root })
    const resilient = result.sessions.find((s) => s.sessionId.startsWith('44444444'))
    expect(resilient?.totals.requests).toBe(2)
  })

  it('--since filters out sessions older than the cutoff', async () => {
    const result = await collectUsage({ codeUserDir: root, since: '2026-12-01' })
    expect(result.sessions.length).toBe(0)
  })

  it('respects workspaceHash filter', async () => {
    const result = await collectUsage({ codeUserDir: root, workspaceHash: 'hashB' })
    expect(result.summary.sessionsScanned).toBe(1)
    expect(result.sessions[0]?.sessionId.startsWith('33333333')).toBe(true)
  })
})
