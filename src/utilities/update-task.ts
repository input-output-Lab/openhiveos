import { z } from 'zod'
import { updateTask } from '../db/queries/tasks.js'
import { isValidAgentSlug } from '../squad/manifest.js'

export const updateTaskSchema = z.object({
  task_id: z.number().int().positive(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(['todo', 'wip', 'review', 'done', 'rework']).optional(),
  // unassign=true clears the assignee to NULL. Takes precedence over assignee_agent_slug.
  unassign: z.boolean().optional(),
  // SEC-22: validated against squad.manifest.json — prevents raw PG 23503 FK
  // violations from surfacing to the caller. Established pattern: isValidAgentSlug.
  assignee_agent_slug: z
    .string()
    .refine(isValidAgentSlug, { message: 'Unknown agent slug' })
    .optional(),
  // SEC-ACCEPTED-F3 (Locksmith, 2026-05-20): github_pr_url accepts any valid URL
  // with no domain restriction. Same risk acceptance as create-task.ts.
  github_pr_url: z.string().url().optional(),
  notes: z.string().max(5000).optional(),
})

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>

// SEC-21: owner_agent_slug is server-injected. Ownership is verified in the DB
// WHERE clause — the UPDATE silently affects 0 rows if the agent does not own
// the parent project. This handler surfaces that as a structured error.
export async function handleUpdateTask(input: UpdateTaskInput, agentSlug: string) {
  const parsed = updateTaskSchema.parse(input)
  const result = await updateTask({
    task_id: parsed.task_id,
    owner_agent_slug: agentSlug,
    ...(parsed.title !== undefined ? { title: parsed.title } : {}),
    ...(parsed.description !== undefined ? { description: parsed.description } : {}),
    ...(parsed.status !== undefined ? { status: parsed.status } : {}),
    ...(parsed.unassign !== undefined ? { unassign: parsed.unassign } : {}),
    ...(parsed.assignee_agent_slug !== undefined ? { assignee_agent_slug: parsed.assignee_agent_slug } : {}),
    ...(parsed.github_pr_url !== undefined ? { github_pr_url: parsed.github_pr_url } : {}),
    ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
  })
  if (!result) {
    return {
      error: 'not_found_or_unauthorized',
      message: 'Task not found or you do not own the parent project.',
    }
  }
  return result
}
