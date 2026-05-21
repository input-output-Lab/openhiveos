import { z } from 'zod'
import { deleteCron } from '../db/queries/crons.js'

// ---------------------------------------------------------------------------
// delete_cron — ARCH-011 (soft delete)
//
// SEC-29: owner_agent_slug is server-injected from the bearer token.
//         not-found and not-owned return the same error variant — no existence leak.
//
// Hard delete is not supported (ARCH-011 Decision 1, Richo 2026-05-20).
// Sets status='deleted'. The row remains in the DB for audit purposes.
// ---------------------------------------------------------------------------

export const deleteCronSchema = z.object({
  id: z.number().int().positive(),
})

export type DeleteCronInput = z.infer<typeof deleteCronSchema>

export async function handleDeleteCron(input: DeleteCronInput, agentSlug: string) {
  const parsed = deleteCronSchema.parse(input)
  const result = await deleteCron({ id: parsed.id, owner_agent_slug: agentSlug })

  switch (result.kind) {
    case 'not_found_or_unauthorized':
      return {
        error: 'not_found_or_unauthorized',
        message: 'Cron not found or you do not own it.',
      }
    case 'already_deleted':
      return {
        error: 'already_deleted',
        message: 'Cron is already deleted.',
      }
    case 'success':
      return result.cron
  }
}
