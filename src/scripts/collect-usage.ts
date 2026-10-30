import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { collectUsage, reportChecksum } from './usage-collector/collector.js'

// CLI entry — S16-BE-02. Read-only collection of local VS Code Copilot usage.
//   tsx scripts/collect-usage.ts [--since ISO] [--workspace HASH] [--out DIR]

interface Args {
  since?: string
  workspace?: string
  out?: string
  pretty?: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = {}
  const set = (key: 'since' | 'workspace' | 'out', value: string | undefined): void => {
    if (value !== undefined) args[key] = value
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--since') set('since', argv[++i])
    else if (a === '--workspace') set('workspace', argv[++i])
    else if (a === '--out') set('out', argv[++i])
    else if (a === '--pretty') args.pretty = true
    else if (a === '--help' || a === '-h') {
      console.log('Usage: tsx src/scripts/collect-usage.ts [--since ISO] [--workspace HASH] [--out DIR] [--pretty]')
      process.exit(0)
    }
  }
  return args
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const result = await collectUsage({
    ...(args.since !== undefined ? { since: args.since } : {}),
    ...(args.workspace !== undefined ? { workspaceHash: args.workspace } : {}),
  })

  console.log('=== VS Code Copilot usage collection ===')
  console.log(`machine: ${result.machine}  generated: ${result.generatedAt}`)
  console.log(
    `scanned ${String(result.summary.sessionsScanned)} session files → ${String(result.summary.sessionsWithUsage)} with usage`,
  )
  console.log(
    `requests: ${String(result.summary.totalRequests)}  prompt tok: ${result.summary.totalPromptTokens.toLocaleString()}  completion tok: ${result.summary.totalCompletionTokens.toLocaleString()}`,
  )
  console.log(`checksum: ${reportChecksum(result)}`)
  console.log('')

  for (const s of result.sessions.slice(0, 10)) {
    const t = s.timing
    console.log(
      `  ${s.sessionId.slice(0, 8)}…  reqs=${String(s.totals.requests)}  prompt=${s.totals.promptTokens.toLocaleString()}  completion=${s.totals.completionTokens.toLocaleString()}` +
        (t ? `  span=${String(t.spanHours)}h  userMsgs=${String(t.userMessages)}  toolCalls=${String(t.toolCalls)}` : ''),
    )
    for (const [model, m] of Object.entries(s.byModel)) {
      console.log(`      ${model}: ${String(m.requests)} reqs, ${m.promptTokens.toLocaleString()} in / ${m.completionTokens.toLocaleString()} out`)
    }
  }
  if (result.sessions.length > 10) console.log(`  … ${String(result.sessions.length - 10)} more sessions`)

  if (args.out) {
    const dir = args.out
    await fs.mkdir(dir, { recursive: true })
    const stamp = result.generatedAt.replace(/[:.]/g, '-').slice(0, 19)
    const file = path.join(dir, `usage-${stamp}.json`)
    await fs.writeFile(file, JSON.stringify(result, null, args.pretty ? 2 : undefined))
    console.log(`\nwritten: ${file}`)
  }
}

main().catch((err: unknown) => {
  console.error('collect-usage failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
