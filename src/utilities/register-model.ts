import { z } from 'zod'
import { withActor } from '../db/client.js'
import {
  CANONICAL_SLUG_RE,
  addAliases,
  upsertModel,
  AliasConflictError,
} from '../db/queries/llm-registry.js'

// ---------------------------------------------------------------------------
// register_model / add_model_alias — S17-BE-05 (#2573)
//
// Gap 1 of 2 (Founder, 2026-10-29): registry growth mechanism. New models
// appear constantly; before these tools, adding one required a manual SQL
// insert. Any authenticated agent may register — bearer auth IS the
// authorization (SEC posture from the #2553 ruling); every call is audited
// via tool_invocations by the gateway.
//
// register_model: creates the model + aliases atomically (single tx).
//   Idempotent on canonical_slug — a re-register returns the existing row,
//   tops up missing aliases, and never duplicates.
// add_model_alias: for when a known model surfaces under a new name (the
//   normalization gap Locksmith flagged in the #2553 ruling). Alias
//   uniqueness is enforced by PK; re-pointing an alias bound elsewhere is
//   an explicit error, never a silent rewrite of cost attribution.
//
// Validation: canonical_slug must match ^[a-z0-9-]+\/[a-z0-9._-]+$
// (migration 022 seed shape). Alias: non-empty, ≤200 chars, no whitespace
// (aliases are surface forms — whitespace can never be emitted by a model id).
// ---------------------------------------------------------------------------

const ALIAS_RE = /^\S{1,200}$/

const aliasArray = z
  .array(z.string().regex(ALIAS_RE, 'alias must be 1-200 chars with no whitespace'))
  .max(50)
  .optional()

export const registerModelSchema = z
  .object({
    canonical_slug: z
      .string()
      .regex(CANONICAL_SLUG_RE, 'canonical_slug must match vendor/model lowercase form'),
    provider_slug: z.string().min(1).max(100),
    display_name: z.string().min(1).max(200).optional(),
    aliases: aliasArray,
  })
  .strict()

export const addModelAliasSchema = z
  .object({
    alias: z.string().regex(ALIAS_RE, 'alias must be 1-200 chars with no whitespace'),
    canonical_slug: z.string().regex(CANONICAL_SLUG_RE),
  })
  .strict()

export type RegisterModelInput = z.infer<typeof registerModelSchema>
export type AddModelAliasInput = z.infer<typeof addModelAliasSchema>

export type RegisterModelResult =
  | {
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
  | { error: 'alias_conflict'; message: string }
  | { error: 'invalid_input'; message: string }

export async function handleRegisterModel(
  input: unknown,
  agentSlug: string,
): Promise<RegisterModelResult> {
  const parsed = registerModelSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'invalid_input', message: parsed.error.issues[0]?.message ?? 'invalid input' }
  }
  const aliases = dedupe(parsed.data.aliases ?? [])
  try {
    return await withActor(agentSlug, async (tx) => {
      const model = await upsertModel(tx, parsed.data)
      const { added, skipped } = await addAliases(tx, model.id, aliases)
      return {
        model: {
          id: model.id,
          canonical_slug: model.canonical_slug,
          provider_slug: model.provider_slug,
          display_name: model.display_name,
          created: model.created,
        },
        aliases_added: added,
        aliases_skipped_existing: skipped,
      }
    })
  } catch (err) {
    if (err instanceof AliasConflictError) {
      return { error: 'alias_conflict', message: err.message }
    }
    throw err
  }
}

function dedupe(aliases: string[]): string[] {
  return [...new Set(aliases)]
}
