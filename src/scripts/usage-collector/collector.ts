import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'

// ---------------------------------------------------------------------------
// S16-BE-02 (#2570): Local usage collector — VS Code Copilot stores → JSON
//
// Read-only. Parsed sources (verified by spike S16-SPK-01 / #2544):
//   chatSessions/<sessionId>.jsonl — per-request usage ledger:
//     v-list entries with modelId, promptTokens, completionTokens, elapsedMs,
//     requestId, timestamp, promptTokenDetails, modelConfiguration
//   transcripts/<sessionId>.jsonl — event ledger:
//     user.message / assistant.turn_start / assistant.turn_end /
//     tool.execution_start / tool.execution_complete with ISO timestamps
//
// Out of scope here: DB ingestion (S17-DB-01), pricing (S17-SEC-01),
// GitHub billing (needs org token).
// ---------------------------------------------------------------------------

export interface ModelUsageEntry {
  requestId: string | null
  modelId: string
  provider: string | null
  canonicalModel: string
  promptTokens: number
  completionTokens: number
  elapsedMs: number | null
  timestamp: number | null // epoch ms
  reasoningEffort: string | null
  promptCategories: { label: string; percentageOfPrompt: number }[] | null
}

export interface SessionTiming {
  sessionId: string
  startedAt: string | null // ISO
  lastEventAt: string | null // ISO
  userMessages: number
  assistantTurns: number
  toolCalls: number
  spanHours: number | null
}

export interface SessionUsage {
  sessionId: string
  workspaceHint: string | null
  usage: ModelUsageEntry[]
  totals: {
    requests: number
    promptTokens: number
    completionTokens: number
    activeMs: number
  }
  byModel: Record<string, { requests: number; promptTokens: number; completionTokens: number; elapsedMs: number }>
  timing: SessionTiming | null
}

export interface CollectResult {
  generatedAt: string
  machine: string
  sessions: SessionUsage[]
  summary: {
    sessionsScanned: number
    sessionsWithUsage: number
    totalRequests: number
    totalPromptTokens: number
    totalCompletionTokens: number
  }
}

// Model alias normalization (spike: 4 observed variants). S17-DB-01 will move
// this into the models registry table; kept local until then.
const PROVIDER_PREFIXES: { pattern: RegExp; provider: string }[] = [
  { pattern: /^openrouter\/OpenRouter\//, provider: 'openrouter' },
  { pattern: /^openrouter\//, provider: 'openrouter' },
  { pattern: /^copilot\//, provider: 'github-copilot' },
  { pattern: /^copilotcli\//, provider: 'github-copilot-cli' },
]

export function normalizeModelId(modelId: string): { provider: string | null; canonicalModel: string } {
  for (const { pattern, provider } of PROVIDER_PREFIXES) {
    if (pattern.test(modelId)) {
      return { provider, canonicalModel: modelId.replace(pattern, '') }
    }
  }
  // Raw form (e.g. 'z-ai/glm-5.3-flashx') — vendor/model, provider = vendor
  const slash = modelId.indexOf('/')
  if (slash > 0) {
    return { provider: modelId.slice(0, slash), canonicalModel: modelId }
  }
  return { provider: null, canonicalModel: modelId }
}

// JSONL iteration that survives mid-line writes (VS Code may be live)
async function* readJsonl(filePath: string): AsyncGenerator<Record<string, unknown>> {
  let handle
  try {
    handle = await fs.open(filePath, 'r')
  } catch {
    return
  }
  try {
    const buffer: string[] = []
    const stream = handle.createReadStream({ encoding: 'utf-8' })
    for await (const chunk of stream) {
      buffer.push(chunk as string)
    }
    const text = buffer.join('')
    // tolerate trailing partial line: only parse complete \n-terminated lines,
    // plus a final line if the file happens to be newline-terminated
    const lines = text.split('\n')
    const last = lines.length - 1
    for (let i = 0; i <= last; i++) {
      const line = lines[i]
      if (line === undefined) continue
      if (i === last && line.length > 0 && !text.endsWith('\n')) continue // partial tail
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        yield JSON.parse(trimmed) as Record<string, unknown>
      } catch {
        // corrupted line — skip, do not abort the session
      }
    }
  } finally {
    await handle.close()
  }
}

// Extract usage-bearing request nodes from a chatSessions JSONL entry.
// Structure (verified): top-level {kind, v} where v is a dict keyed by request
// index in older versions, or a list — either way request nodes are dicts
// containing 'modelId' with token/elapsed siblings.
function* findUsageNodes(node: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(node)) {
    for (const item of node) yield* findUsageNodes(item)
    return
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>
    if (typeof obj['modelId'] === 'string') {
      yield obj
      return
    }
    for (const value of Object.values(obj)) yield* findUsageNodes(value)
  }
}

async function parseChatSession(filePath: string, workspaceHint: string | null): Promise<SessionUsage> {
  const sessionId = path.basename(filePath, '.jsonl')
  const usage: ModelUsageEntry[] = []
  const byModel: SessionUsage['byModel'] = {}
  let promptTotal = 0
  let completionTotal = 0
  let activeMs = 0

  for await (const entry of readJsonl(filePath)) {
    const v = entry['v'] ?? entry
    for (const node of findUsageNodes(v)) {
      const modelId = node['modelId'] as string
      const prompt = typeof node['promptTokens'] === 'number' ? (node['promptTokens']) : 0
      const completion = typeof node['completionTokens'] === 'number' ? (node['completionTokens']) : 0
      const elapsed = typeof node['elapsedMs'] === 'number' ? (node['elapsedMs']) : null
      const ts = typeof node['timestamp'] === 'number' ? (node['timestamp']) : null
      const { provider, canonicalModel } = normalizeModelId(modelId)
      const details = Array.isArray(node['promptTokenDetails'])
        ? (node['promptTokenDetails'] as { label: string; percentageOfPrompt: number }[]).map((d) => ({
            label: d.label,
            percentageOfPrompt: d.percentageOfPrompt,
          }))
        : null
      const config = node['modelConfiguration'] as Record<string, unknown> | undefined
      const requestId = typeof node['requestId'] === 'string' ? (node['requestId']) : null

      usage.push({
        requestId,
        modelId,
        provider,
        canonicalModel,
        promptTokens: prompt,
        completionTokens: completion,
        elapsedMs: elapsed,
        timestamp: ts,
        reasoningEffort: config && typeof config['reasoningEffort'] === 'string' ? (config['reasoningEffort']) : null,
        promptCategories: details,
      })

      promptTotal += prompt
      completionTotal += completion
      if (elapsed !== null) activeMs += elapsed
      const bucket = (byModel[modelId] ??= { requests: 0, promptTokens: 0, completionTokens: 0, elapsedMs: 0 })
      bucket.requests += 1
      bucket.promptTokens += prompt
      bucket.completionTokens += completion
      bucket.elapsedMs += elapsed ?? 0
    }
  }

  return {
    sessionId,
    workspaceHint,
    usage,
    totals: {
      requests: usage.length,
      promptTokens: promptTotal,
      completionTokens: completionTotal,
      activeMs,
    },
    byModel,
    timing: null,
  }
}

async function parseTranscript(filePath: string): Promise<SessionTiming> {
  const sessionId = path.basename(filePath, '.jsonl')
  let startedAt: string | null = null
  let lastEventAt: string | null = null
  let userMessages = 0
  let assistantTurns = 0
  let toolCalls = 0

  for await (const entry of readJsonl(filePath)) {
    const type = entry['type'] as string | undefined
    const ts = entry['timestamp'] as string | undefined
    if (typeof ts === 'string') {
      if (startedAt === null) startedAt = ts
      lastEventAt = ts
    }
    if (type === 'user.message') userMessages++
    else if (type === 'assistant.turn_start') assistantTurns++
    else if (type === 'tool.execution_start') toolCalls++
  }

  let spanHours: number | null = null
  if (startedAt && lastEventAt) {
    const a = Date.parse(startedAt)
    const b = Date.parse(lastEventAt)
    if (!Number.isNaN(a) && !Number.isNaN(b)) spanHours = Math.round(((b - a) / 3_600_000) * 100) / 100
  }

  return { sessionId, startedAt, lastEventAt, userMessages, assistantTurns, toolCalls, spanHours }
}

export interface CollectOptions {
  /** Only include sessions whose last event is on/after this ISO date */
  since?: string
  /** Limit to one workspace-storage hash (defaults to all workspaces) */
  workspaceHash?: string
  /** Root of VS Code user data (defaults to standard macOS path) */
  codeUserDir?: string
}

export async function collectUsage(options: CollectOptions = {}): Promise<CollectResult> {
  const userDir = options.codeUserDir ?? path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User')
  const workspaceRoot = path.join(userDir, 'workspaceStorage')
  const sinceMs = options.since ? Date.parse(options.since) : null

  const sessions: SessionUsage[] = []
  let sessionsScanned = 0
  let sessionsWithUsage = 0
  let totalRequests = 0
  let totalPromptTokens = 0
  let totalCompletionTokens = 0

  let workspaceDirs: string[]
  try {
    const all = await fs.readdir(workspaceRoot)
    workspaceDirs = all.filter((d) => !options.workspaceHash || d === options.workspaceHash)
  } catch {
    workspaceDirs = []
  }

  for (const hash of workspaceDirs) {
    // workspace.json names the project ({"folder":"file://..."} or config path)
    let workspaceHint: string | null = null
    try {
      const wsRaw = await fs.readFile(path.join(workspaceRoot, hash, 'workspace.json'), 'utf-8')
      workspaceHint = (JSON.parse(wsRaw) as { folder?: string; config?: string }).folder ?? null
    } catch {
      /* not a folder workspace */
    }

    // chatSessions (usage ledger) lives beside GitHub.copilot-chat in the workspace dir
    const chatSessionsDir = path.join(workspaceRoot, hash, 'chatSessions')
    let sessionFiles: string[] = []
    try {
      sessionFiles = (await fs.readdir(chatSessionsDir)).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(chatSessionsDir, f))
    } catch {
      continue
    }

    for (const file of sessionFiles) {
      sessionsScanned++
      const su = await parseChatSession(file, workspaceHint)
      if (su.usage.length === 0) continue
      sessionsWithUsage++
      totalRequests += su.totals.requests
      totalPromptTokens += su.totals.promptTokens
      totalCompletionTokens += su.totals.completionTokens

      // join transcript timing when present
      const transcriptPath = path.join(workspaceRoot, hash, 'GitHub.copilot-chat', 'transcripts', path.basename(file))
      try {
        await fs.access(transcriptPath)
        su.timing = await parseTranscript(transcriptPath)
        if (su.timing.lastEventAt === null) su.timing = null
      } catch {
        /* no transcript for this session */
      }

      if (sinceMs !== null) {
        const ref = su.timing?.lastEventAt ? Date.parse(su.timing.lastEventAt) : su.usage[su.usage.length - 1]?.timestamp
        if (typeof ref !== 'number' || ref < sinceMs) continue
      }
      sessions.push(su)
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    machine: os.hostname(),
    sessions,
    summary: {
      sessionsScanned,
      sessionsWithUsage,
      totalRequests,
      totalPromptTokens,
      totalCompletionTokens,
    },
  }
}

// content hash for dedup/audit of emitted reports
export function reportChecksum(result: CollectResult): string {
  return createHash('sha256').update(JSON.stringify(result.summary)).digest('hex').slice(0, 16)
}
