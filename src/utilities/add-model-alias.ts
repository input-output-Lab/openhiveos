import { z } from 'zod'
import { withActor } from '../db/client.js'
import { addSingleAlias, AliasConflictError } from '../db/queries/llm-registry.js'

// add_model_alias — S17-BE-05 (#2573): bind a new surface form to an
// already-registered canonical model. Normalization-gap closure (Locksmith,
// #2553 ruling): when a known model appears under a new provider prefix,
// registering the alias here keeps per-model cost rollups from splitting.
// Fails closed: unknown canonical_slug, alias bound elsewhere, or alias
// already bound to this model are all explicit errors.

export const addModelAliasSchema = z
  .object({
    alias: z.string().regex(/^\S{1,200}$/, 'alias must be 1-200 chars with no whitespace'),
    canonical_slug: z.string().regex(/^[a-z0-9-]+\/[a-z0-9._-]+$/),
  })
  .strict()

export type AddModelAliasInput = z.infer<typeof addModelAliasSchema>

export type AddModelAliasResult =
  | { alias: string; model_id: string }
  | { error: 'alias_conflict' | 'unknown_model' | 'already_bound' | 'invalid_input'; message: string }

export async function handleAddModelAlias(
  input: unknown,
  agentSlug: string,
): Promise<AddModelAliasResult> {
  const parsed = addModelAliasSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'invalid_input', message: parsed.error.issues[0]?.message ?? 'invalid input' }
  }
  try {
    return await withActor(agentSlug, (tx) =>
      addSingleAlias(tx, parsed.data.alias, parsed.data.canonical_slug),
    )
  } catch (err) {
    if (err instanceof AliasConflictError) {
      return { error: 'alias_conflict', message: err.message }
    }
    if (err instanceof Error && err.message.startsWith('Unknown canonical_slug')) {
      return { error: 'unknown_model', message: err.message }
    }
    if (err instanceof Error && err.message.includes('already bound to this model')) {
      return { error: 'already_bound', message: err.message }
    }
    throw err
  }
}
