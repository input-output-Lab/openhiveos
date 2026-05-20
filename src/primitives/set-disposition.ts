import { z } from 'zod'
import { setDisposition } from '../db/queries/thoughts.js'

export const setDispositionSchema = z.object({
  // agent_slug intentionally absent — identity is resolved server-side from bearer token
  assertiveness: z.number().min(-1).max(1).optional(),
  energy: z.number().min(-1).max(1).optional(),
  patience: z.number().min(-1).max(1).optional(),
  formality: z.number().min(-1).max(1).optional(),
  candor_floor: z.number().min(0.2).max(1).optional(),
  updated_by: z.string().optional(),
})

export type SetDispositionInput = z.infer<typeof setDispositionSchema>

export async function handleSetDisposition(input: SetDispositionInput, agentSlug: string) {
  const parsed = setDispositionSchema.parse(input)
  return await setDisposition({
    agent_slug: agentSlug,
    ...(parsed.assertiveness !== undefined ? { assertiveness: parsed.assertiveness } : {}),
    ...(parsed.energy !== undefined ? { energy: parsed.energy } : {}),
    ...(parsed.patience !== undefined ? { patience: parsed.patience } : {}),
    ...(parsed.formality !== undefined ? { formality: parsed.formality } : {}),
    ...(parsed.candor_floor !== undefined ? { candor_floor: parsed.candor_floor } : {}),
    ...(parsed.updated_by !== undefined ? { updated_by: parsed.updated_by } : {}),
  })
}
