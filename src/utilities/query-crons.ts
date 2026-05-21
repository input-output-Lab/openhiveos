import { z } from 'zod'
import { queryCrons, ALLOWED_CRON_FILTERS } from '../db/queries/crons.js'

// ---------------------------------------------------------------------------
// query_crons — ARCH-011 (read, open with filter whitelist)
//
// SEC-30: ALLOWED_CRON_FILTERS as const — Zod schema is generated directly
// from the whitelist, so unknown filter keys produce a Zod parse error before
// any SQL is constructed. Error does not leak column names.
//
// Cross-agent enumeration gap: documented in ARCH-011 Tech Debt #2.
// Callers may filter by owner_agent_slug to scope to their own crons.
// Full caller-scoping deferred to post-v0.1.
//
// Soft-delete default: deleted crons are hidden unless status='deleted' is passed.
// ---------------------------------------------------------------------------

export const queryCronsSchema = z.object({
  project_id:       z.number().int().positive().optional(),
  status:           z.enum(['active', 'paused', 'deleted']).optional(),
  owner_agent_slug: z.string().min(1).max(100).optional(),
})

// Compile-time check: every key in ALLOWED_CRON_FILTERS must appear in the schema (SEC-30).
// If this fails, a filter key was added to ALLOWED_CRON_FILTERS without a matching Zod field.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _exhaustiveCheck: (typeof ALLOWED_CRON_FILTERS)[number] extends keyof z.infer<typeof queryCronsSchema>
  ? true
  : never = true as const

export type QueryCronsInput = z.infer<typeof queryCronsSchema>

export async function handleQueryCrons(input: QueryCronsInput) {
  const parsed = queryCronsSchema.parse(input)
  return await queryCrons({
    ...(parsed.project_id       !== undefined ? { project_id: parsed.project_id }             : {}),
    ...(parsed.status           !== undefined ? { status: parsed.status }                       : {}),
    ...(parsed.owner_agent_slug !== undefined ? { owner_agent_slug: parsed.owner_agent_slug }  : {}),
  })
}
