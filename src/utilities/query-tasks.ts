import { z } from 'zod'
import { queryTasks } from '../db/queries/tasks.js'

export const queryTasksSchema = z.object({
  project_id: z.number().int().positive().optional(),
  status: z.enum(['todo', 'wip', 'review', 'done', 'rework']).optional(),
  assignee_agent_slug: z.string().optional(),
})

export type QueryTasksInput = z.infer<typeof queryTasksSchema>

// agentSlug is always passed to the DB layer to scope results to projects
// owned by the calling agent (implicit data isolation guard).
export async function handleQueryTasks(input: QueryTasksInput, agentSlug: string) {
  const parsed = queryTasksSchema.parse(input)
  return await queryTasks(
    {
      ...(parsed.project_id !== undefined ? { project_id: parsed.project_id } : {}),
      ...(parsed.status !== undefined ? { status: parsed.status } : {}),
      ...(parsed.assignee_agent_slug !== undefined
        ? { assignee_agent_slug: parsed.assignee_agent_slug }
        : {}),
    },
    agentSlug,
  )
}
