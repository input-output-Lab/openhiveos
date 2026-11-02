/**
 * S17-OPS-03 (#2572) — Reviewed apply for price diffs. Run ONLY after a human
 * (Founder/Murphy) has reviewed the diff report produced by sync-prices.ts.
 *
 * For each --slug: supersedes the current row (effective_to = NOW()) and inserts
 * a new version (price_version + 1) in a single transaction, preserving the
 * single-current-row constraint (uq_llm_model_prices_current) and the no-overlap
 * exclusion constraint (exllm_model_prices_no_overlap).
 *
 * Usage:
 *   npx tsx scripts/usage-collector/apply-prices.ts --report logs/price-sync/latest-diff.json \
 *       --slug z-ai/glm-5.3-flashx [--slug ...] [--dry-run]
 *
 * Safety:
 *   - Refuses to apply slugs that are not in the report's `changed` list.
 *   - Refuses slugs whose report values were superseded (report older than the
 *     current row's created_at).
 *   - --dry-run prints planned SQL and exits 0 without writing.
 */
import * as fs from 'node:fs/promises'
import { Client } from 'pg'

interface DiffRow {
  canonical_slug: string
  model_id: number
  current_input_per_mtok: string
  current_output_per_mtok: string
  source_input_per_mtok: number
  source_output_per_mtok: number
  source_key: string
}

interface Report {
  generated_at: string
  changed: DiffRow[]
}

function parseArgs(argv: string[]): { report: string; slugs: string[]; dryRun: boolean } {
  const args = { report: '', slugs: [] as string[], dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--report') args.report = argv[++i] as string
    else if (argv[i] === '--slug') args.slugs.push(argv[++i] as string)
    else if (argv[i] === '--dry-run') args.dryRun = true
  }
  if (args.report === '' || args.slugs.length === 0) {
    console.error('usage: apply-prices.ts --report <latest-diff.json> --slug <canonical_slug> [--slug ...] [--dry-run]')
    process.exit(1)
  }
  return args
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const report = JSON.parse(await fs.readFile(args.report, 'utf8')) as Report

  const client = new Client({ connectionString: process.env['DATABASE_URL'] })
  await client.connect()
  try {
    for (const slug of args.slugs) {
      const entry = report.changed.find((c) => c.canonical_slug === slug)
      if (entry === undefined) {
        console.error(`REFUSED ${slug}: not in report's changed list (nothing to apply or slug unmapped)`)
        process.exitCode = 1
        continue
      }

      // Staleness guard: refuse if the current row changed after the report ran.
      const cur = await client.query<{ created_at: Date; input_per_mtok: string; output_per_mtok: string }>(
        `SELECT p.created_at, p.input_per_mtok::text, p.output_per_mtok::text
           FROM llm_model_prices p
           JOIN llm_models m ON m.id = p.model_id
          WHERE m.canonical_slug = $1 AND p.effective_to IS NULL`,
        [slug],
      )
      if (cur.rowCount === 0) {
        console.error(`REFUSED ${slug}: no current price row`)
        process.exitCode = 1
        continue
      }
      const c = cur.rows[0]
      if (Number(c.input_per_mtok) !== Number(entry.current_input_per_mtok) || Number(c.output_per_mtok) !== Number(entry.current_output_per_mtok)) {
        console.error(`REFUSED ${slug}: current row changed since report (${c.input_per_mtok}/${c.output_per_mtok} vs report ${entry.current_input_per_mtok}/${entry.current_output_per_mtok}). Re-run sync-prices.ts first.`)
        process.exitCode = 1
        continue
      }

      const nextIn = entry.source_input_per_mtok.toFixed(6)
      const nextOut = entry.source_output_per_mtok.toFixed(6)
      const nowIso = new Date().toISOString()

      if (args.dryRun) {
        console.log(`DRY-RUN ${slug}: version+1, in ${c.input_per_mtok} -> ${nextIn}, out ${c.output_per_mtok} -> ${nextOut}, effective ${nowIso}, source '${entry.source_key}'`)
        continue
      }

      await client.query('BEGIN')
      try {
        await client.query(`UPDATE llm_model_prices SET effective_to = $1 WHERE model_id = $2 AND effective_to IS NULL`, [nowIso, entry.model_id])
        await client.query(
          `INSERT INTO llm_model_prices (model_id, price_version, effective_from, input_per_mtok, output_per_mtok, currency, source)
           VALUES ($1,
                   (SELECT COALESCE(MAX(price_version), 0) + 1 FROM llm_model_prices WHERE model_id = $1),
                   $2, $3, $4, 'USD', $5)`,
          [entry.model_id, nowIso, nextIn, nextOut, `price-sync:${entry.source_key}`],
        )
        await client.query('COMMIT')
        console.log(`APPLIED ${slug}: version+1, in ${c.input_per_mtok} -> ${nextIn}, out ${c.output_per_mtok} -> ${nextOut}, effective ${nowIso}, source '${entry.source_key}'`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
  } finally {
    await client.end()
  }
}

main().catch((err: unknown) => {
  console.error('apply-prices failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
