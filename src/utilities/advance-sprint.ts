import { z } from 'zod'
import { advanceSprint } from '../db/queries/tasks.js'

export const advanceSprintSchema = z.object({
  project_id: z.number().int().positive(),
  sprint_goal: z.string().max(2000).optional(),
})

export type AdvanceSprintInput = z.infer<typeof advanceSprintSchema>

// SEC-21: owner_agent_slug is server-injected — callers cannot advance sprints
// on projects they do not own.
// SEC-23: the UNIQUE(project_id, sprint_number) constraint is the idempotency
// guard. A concurrent advance_sprint call produces PG error 23505, which the
// DB layer catches and returns as { conflict: true }. This handler surfaces
// that as a structured retryable error — not a 500.
export async function handleAdvanceSprint(input: AdvanceSprintInput, agentSlug: string) {
  const parsed = advanceSprintSchema.parse(input)
  const result = await advanceSprint({
    project_id: parsed.project_id,
    owner_agent_slug: agentSlug,
    ...(parsed.sprint_goal !== undefined ? { sprint_goal: parsed.sprint_goal } : {}),
  })

  if (result.kind === 'unauthorized') {
    return {
      error: 'not_found_or_unauthorized',
      message: 'Project not found or you do not own it.',
    }
  }

  if (result.kind === 'conflict') {
    return {
      error: 'sprint_conflict',
      retryable: true,
      message:
        'A concurrent sprint advance was recorded for this project. Fetch the current sprint and retry if needed.',
    }
  }

  return result.sprint
}
