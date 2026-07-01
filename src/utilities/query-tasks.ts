import { z } from 'zod'
import { queryTasks } from '../db/queries/tasks.js'

export const queryTasksSchema = z.object({
  project_id: z.number().int().positive().optional(),
  status: z.enum(['todo', 'wip', 'review', 'done', 'rework']).optional(),
  assignee_agent_slug: z.string().optional(),
  // JSONB containment filter — each key/value pair must be present in the task's
  // metadata. Uses Postgres @> operator. Array values must be passed as arrays.
  // Example: { "tags": ["backend"] } matches tasks where metadata contains that tag.
  metadata_filter: z.record(z.unknown()).optional(),
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
    parsed.metadata_filter as Record<string, unknown> | undefined,
  )
}
