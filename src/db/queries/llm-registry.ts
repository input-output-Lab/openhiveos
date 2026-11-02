import type { PoolClient } from 'pg'

// ---------------------------------------------------------------------------
// llm-registry.ts — S17-BE-05 (#2573): agent-callable registry expansion.
//
// register_model / add_model_alias write to llm_models + llm_model_aliases
// (migration 022). Feeds cost estimation (#2554): an unregistered model has
// cost_source 'unknown', so every registration directly improves budget
// coverage. Caller wraps in withActor(agentSlug, ...) — the tool layer owns
// authorization (bearer auth = agent identity); this layer owns atomicity.
//
// Idempotency contract (L10 gap-1 spec):
//   - register_model on an existing canonical_slug returns the existing row
//     plus newly-added aliases; never duplicates (canonical UNIQUE).
//   - add_model_alias is idempotent per alias PK; re-pointing an existing
//     alias is an ERROR (aliases must be explicitly detached, not silently
//     re-pointed — silent re-point would rewrite cost history attribution).
// ---------------------------------------------------------------------------

/** Matches migration 022 seed shape: 'vendor/model-lowercase'. */
export const CANONICAL_SLUG_RE = /^[a-z0-9-]+\/[a-z0-9._-]+$/

export interface RegisterModelInput {
  canonical_slug: string
  provider_slug: string
  display_name?: string | null | undefined
  aliases?: string[] | undefined
}

export interface AliasRow {
  alias: string
  model_id: string
}

export interface RegisterModelResult {
  model: {
    id: string
    canonical_slug: string
    provider_slug: string
    display_name: string | null
    created: boolean
  }
  aliases_added: string[]
  aliases_skipped_existing: string[]
}

export class AliasConflictError extends Error {
  readonly alias: string
  readonly currentModelId: string
  constructor(alias: string, currentModelId: string) {
    super(
      `Alias "${alias}" is already bound to model id ${currentModelId}. ` +
        'Aliases are not silently re-pointed — detach explicitly first.',
    )
    this.name = 'AliasConflictError'
    this.alias = alias
    this.currentModelId = currentModelId
  }
}

export async function upsertModel(
  tx: PoolClient,
  input: RegisterModelInput,
): Promise<RegisterModelResult['model'] & { created: boolean }> {
  const result = await tx.query<{
    id: string
    canonical_slug: string
    provider_slug: string
    display_name: string | null
    created: boolean
  }>(
    `INSERT INTO llm_models (canonical_slug, provider_slug, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (canonical_slug) DO UPDATE
       SET display_name = COALESCE(EXCLUDED.display_name, llm_models.display_name)
     RETURNING id::text AS id, canonical_slug, provider_slug, display_name,
               (xmax = 0) AS created`,
    [input.canonical_slug, input.provider_slug, input.display_name ?? null],
  )
  const row = result.rows[0]
  if (!row) throw new Error('upsertModel: INSERT returned no row')
  return row
}

/**
 * addAliases — bind each alias to model_id. Idempotent: an alias already
 * bound to THIS model is skipped (reported in aliases_skipped_existing);
 * an alias bound to a DIFFERENT model throws AliasConflictError.
 */
export async function addAliases(
  tx: PoolClient,
  modelId: string,
  aliases: string[],
): Promise<{ added: string[]; skipped: string[] }> {
  const added: string[] = []
  const skipped: string[] = []
  for (const alias of aliases) {
    const existing = await tx.query<{ model_id: string }>(
      `SELECT model_id::text AS model_id FROM llm_model_aliases WHERE alias = $1`,
      [alias],
    )
    if (existing.rows[0]) {
      if (existing.rows[0].model_id === modelId) {
        skipped.push(alias)
        continue
      }
      throw new AliasConflictError(alias, existing.rows[0].model_id)
    }
    await tx.query(
      `INSERT INTO llm_model_aliases (alias, model_id) VALUES ($1, $2::bigint)`,
      [alias, modelId],
    )
    added.push(alias)
  }
  return { added, skipped }
}

/** add_model_alias single-alias path (S17-BE-05 normalization gap). */
export async function addSingleAlias(
  tx: PoolClient,
  alias: string,
  canonicalSlug: string,
): Promise<AliasRow> {
  const model = await tx.query<{ id: string }>(
    `SELECT id::text AS id FROM llm_models WHERE canonical_slug = $1`,
    [canonicalSlug],
  )
  const row = model.rows[0]
  if (!row) {
    throw new Error(`Unknown canonical_slug "${canonicalSlug}" — register the model first.`)
  }
  const { added } = await addAliases(tx, row.id, [alias])
  if (added.length === 0) {
    throw new Error(`Alias "${alias}" already bound to this model — nothing to do.`)
  }
  return { alias, model_id: row.id }
}
