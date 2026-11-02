/**
 * S17-OPS-03 (#2572) — Weekly price-sync: fetch LiteLLM model DB, diff against
 * llm_model_prices current rows, write a staging diff report to logs/price-sync/.
 *
 * NEVER auto-applies. Locksmith SC-2: the price table is server-internal; wrong
 * prices silently corrupt budget reports. Applying is a human decision via
 * apply-prices.ts after the diff report is reviewed.
 *
 * Usage:
 *   npx tsx scripts/usage-collector/sync-prices.ts [--map <path>] [--out <dir>]
 *
 * Exit codes: 0 = no changes, 10 = diff found (report written), 1 = error.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Client } from 'pg'

interface SourceMap {
  source_url: string
  mapping: Record<string, string[]>
}

interface DiffRow {
  canonical_slug: string
  model_id: number
  current_input_per_mtok: string
  current_output_per_mtok: string
  source_input_per_mtok: number
  source_output_per_mtok: number
  source_key: string
  input_delta_pct: number
  output_delta_pct: number
}

interface UnmappedRow {
  canonical_slug: string
  reason: string
}

interface Report {
  generated_at: string
  source_url: string
  source_fetched_at: string
  summary: { total_models: number; changed: number; unchanged: number; unmapped: number }
  changed: DiffRow[]
  unchanged: { canonical_slug: string; input_per_mtok: number; output_per_mtok: number }[]
  unmapped: UnmappedRow[]
}

function parseArgs(argv: string[]): { map: string; out: string } {
  const args = { map: path.resolve('scripts/usage-collector/price-source-map.json'), out: path.resolve('logs/price-sync') }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--map') args.map = path.resolve(argv[++i] as string)
    else if (argv[i] === '--out') args.out = path.resolve(argv[++i] as string)
  }
  return args
}

function perMtok(perToken: unknown): number {
  const v = Number(perToken)
  if (!Number.isFinite(v) || v < 0) throw new Error(`invalid per-token price: ${String(perToken)}`)
  return v * 1_000_000
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const map: SourceMap = JSON.parse(await fs.readFile(args.map, 'utf8'))

  // 1. Fetch source.
  const resp = await fetch(map.source_url)
  if (!resp.ok) throw new Error(`source fetch failed: HTTP ${String(resp.status)}`)
  const db = (await resp.json()) as Record<string, Record<string, unknown>>
  const sourceFetchedAt = new Date().toISOString()

  // 2. Load current DB prices.
  const client = new Client({ connectionString: process.env['DATABASE_URL'] })
  await client.connect()
  try {
    const { rows } = await client.query<{
      id: number
      canonical_slug: string
      input_per_mtok: string
      output_per_mtok: string
    }>(
      `SELECT m.id, m.canonical_slug, p.input_per_mtok, p.output_per_mtok
         FROM llm_models m
         JOIN llm_model_prices p ON p.model_id = m.id AND p.effective_to IS NULL
        WHERE m.active = true
        ORDER BY m.canonical_slug`,
    )

    const report: Report = {
      generated_at: new Date().toISOString(),
      source_url: map.source_url,
      source_fetched_at: sourceFetchedAt,
      summary: { total_models: rows.length, changed: 0, unchanged: 0, unmapped: 0 },
      changed: [],
      unchanged: [],
      unmapped: [],
    }

    // 3. Diff, using the vendor-preference order in the mapping.
    for (const row of rows) {
      const candidates = map.mapping[row.canonical_slug]
      if (candidates === undefined) {
        report.unmapped.push({ canonical_slug: row.canonical_slug, reason: 'no mapping in price-source-map.json' })
        continue
      }
      const hitKey = candidates.find((k) => db[k]?.['input_cost_per_token'] != null && db[k]?.['output_cost_per_token'] != null)
      if (hitKey === undefined) {
        report.unmapped.push({ canonical_slug: row.canonical_slug, reason: `mapped keys absent/priceless in source: ${candidates.join(', ')}` })
        continue
      }
      const src = db[hitKey]
      const srcIn = perMtok(src['input_cost_per_token'])
      const srcOut = perMtok(src['output_cost_per_token'])
      const curIn = Number(row.input_per_mtok)
      const curOut = Number(row.output_per_mtok)

      const inDelta = curIn === 0 ? (srcIn === 0 ? 0 : Infinity) : ((srcIn - curIn) / curIn) * 100
      const outDelta = curOut === 0 ? (srcOut === 0 ? 0 : Infinity) : ((srcOut - curOut) / curOut) * 100

      // Material change: >0.5% on either side (float-noise threshold).
      if (Math.abs(inDelta) > 0.5 || Math.abs(outDelta) > 0.5) {
        report.changed.push({
          canonical_slug: row.canonical_slug,
          model_id: row.id,
          current_input_per_mtok: row.input_per_mtok,
          current_output_per_mtok: row.output_per_mtok,
          source_input_per_mtok: srcIn,
          source_output_per_mtok: srcOut,
          source_key: hitKey,
          input_delta_pct: Number(inDelta.toFixed(2)),
          output_delta_pct: Number(outDelta.toFixed(2)),
        })
      } else {
        report.unchanged.push({ canonical_slug: row.canonical_slug, input_per_mtok: srcIn, output_per_mtok: srcOut })
      }
    }
    report.summary.changed = report.changed.length
    report.summary.unchanged = report.unchanged.length
    report.summary.unmapped = report.unmapped.length

    // 4. Write staging report (never applied).
    await fs.mkdir(args.out, { recursive: true })
    const stamp = report.generated_at.replace(/[:.]/g, '-').slice(0, 19)
    const file = path.join(args.out, `price-diff-${stamp}.json`)
    await fs.writeFile(file, JSON.stringify(report, null, 2))
    await fs.writeFile(path.join(args.out, 'latest-diff.json'), JSON.stringify(report, null, 2))

    console.log(`diff report: ${file}`)
    console.log(`summary: ${report.summary.changed} changed, ${report.summary.unchanged} unchanged, ${report.summary.unmapped} unmapped (of ${report.summary.total_models})`)
    for (const c of report.changed) {
      console.log(`  CHANGED ${c.canonical_slug}: in ${c.current_input_per_mtok} -> ${c.source_input_per_mtok.toFixed(4)} (${c.input_delta_pct > 0 ? '+' : ''}${String(c.input_delta_pct)}%), out ${c.current_output_per_mtok} -> ${c.source_output_per_mtok.toFixed(4)} (${c.output_delta_pct > 0 ? '+' : ''}${String(c.output_delta_pct)}%) [${c.source_key}]`)
    }
    for (const u of report.unmapped) console.log(`  UNMAPPED ${u.canonical_slug}: ${u.reason}`)

    process.exitCode = report.changed.length > 0 ? 10 : 0
  } finally {
    await client.end()
  }
}

main().catch((err: unknown) => {
  console.error('sync-prices failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
