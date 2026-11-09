/**
 * S18-BE-01 (#2564) — CLI entry: collect from the VS Code session store and
 * ingest into llm_usage.
 *
 *   tsx src/scripts/ingest-usage.ts [--since ISO] [--workspace HASH]
 *
 * Output path: writes nothing to disk — inserts into llm_usage directly.
 * Safe to re-run: ON CONFLICT DO NOTHING makes every replay idempotent.
 */
import { ingestUsage } from './usage-collector/ingest-usage.js'

interface Args {
  since?: string
  workspace?: string
  help?: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--since' && typeof value === 'string') args.since = value
    else if (flag === '--workspace' && typeof value === 'string') args.workspace = value
    else if (flag === '--help' || flag === '-h') args.help = true
  }
  return args
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: tsx src/scripts/ingest-usage.ts [--since ISO] [--workspace HASH]')
    process.exit(0)
  }

  console.log('=== llm_usage ingestion (VS Code Copilot session store) ===')
  const result = await ingestUsage({
    ...(args.since !== undefined ? { since: args.since } : {}),
    ...(args.workspace !== undefined ? { workspaceHash: args.workspace } : {}),
  })

  console.log(`scanned ${String(result.sessionsScanned)} sessions → ${String(result.sessionsWithUsage)} with usage`)
  console.log(`rows inserted: ${String(result.rowsInserted)}  (skipped as duplicates: ${String(result.rowsSkipped)})`)
  if (result.rowsInserted > 0 && result.rowsSkipped === 0) {
    console.log('all rows new — first ingest or fully fresh window')
  }
}

main().catch((err: unknown) => {
  console.error('ingest-usage failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
