import { z } from 'zod'
import { updateTask } from '../db/queries/tasks.js'
import { isValidAgentSlug } from '../squad/manifest.js'

export const updateTaskSchema = z.object({
  task_id: z.number().int().positive(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  // ARCH-023: `pending-close` is the assignee terminal step. `done` requires
  // owner approval and is blocked on the assignee path by the M3 gate below.
  status: z.enum(['todo', 'wip', 'review', 'done', 'rework', 'pending-close']).optional(),
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
// WHERE clause.
//
// Model C (decided 2026-05-21): hybrid permission.
//   - Project owner: may update ALL fields.
//   - Assignee: may update the `status` field ONLY on tasks assigned to them.
//
// The field gate is enforced here: allowAssigneePath is true only when the
// request contains no owner-only fields. The DB enforces the row gate via an
// extended WHERE (owner subquery OR assignee_agent_slug = $callerSlug).
// Both gates must hold — neither alone is sufficient.
export async function handleUpdateTask(input: UpdateTaskInput, agentSlug: string) {
  const parsed = updateTaskSchema.parse(input)

  // Owner-only fields: anything except status. If any are present, only the
  // project owner path is valid.
  const ownerOnlyFieldsPresent =
    parsed.title !== undefined ||
    parsed.description !== undefined ||
    parsed.unassign !== undefined ||
    parsed.assignee_agent_slug !== undefined ||
    parsed.github_pr_url !== undefined ||
    parsed.notes !== undefined

  const allowAssigneePath = !ownerOnlyFieldsPresent

  // M3 gate (ARCH-023 — SEC-21 extension): On the assignee path, `done` is not
  // a valid target status. Assignees submit `pending-close`; only the project
  // owner may approve the pending-close → done transition. The DB does not
  // enforce status-value scope on the assignee path independently — this gate
  // is the only enforcement layer. Changes here are Tier 3 / require Locksmith review.
  if (allowAssigneePath && parsed.status === 'done') {
    return {
      error: 'not_found_or_unauthorized',
      message: 'Task not found or you are not authorized to update it.',
    }
  }

  const result = await updateTask({
    task_id: parsed.task_id,
    owner_agent_slug: agentSlug,
    allowAssigneePath,
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
      message: 'Task not found or you are not authorized to update it.',
    }
  }
  return result
}
