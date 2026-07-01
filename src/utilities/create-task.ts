import { z } from 'zod'
import { createTask } from '../db/queries/tasks.js'
import { isValidAgentSlug } from '../squad/manifest.js'

export const createTaskSchema = z.object({
  project_id: z.number().int().positive(),
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  // SEC-22: validated against squad.manifest.json — prevents raw PG 23503 FK
  // violations from surfacing to the caller. Established pattern: isValidAgentSlug.
  assignee_agent_slug: z
    .string()
    .refine(isValidAgentSlug, { message: 'Unknown agent slug' })
    .optional(),
  // SEC-ACCEPTED-F3 (Locksmith, 2026-05-20): github_pr_url accepts any valid URL
  // with no domain restriction. Risk: an agent could store a non-GitHub URL.
  // Mitigations: field is named github_pr_url (intent is clear), all callers are
  // authenticated agents, field is not rendered in any public-facing surface.
  // If this field is ever surfaced in a UI, add domain allowlist validation.
  github_pr_url: z.string().url().optional(),
  notes: z.string().max(5000).optional(),
  // Operator-defined classification metadata. Domain-agnostic JSONB — keys and
  // values are set by the operator or agent. See docs/capabilities-reference.md
  // for recommended (non-enforced) key conventions.
  metadata: z.record(z.unknown()).optional(),
})

export type CreateTaskInput = z.infer<typeof createTaskSchema>

// SEC-21: owner_agent_slug is server-injected. The DB layer performs an explicit
// pre-flight SELECT to verify ownership before the INSERT — not a subquery
// inside the INSERT. This is the Locksmith-required pattern for auditability.
export async function handleCreateTask(input: CreateTaskInput, agentSlug: string) {
  const parsed = createTaskSchema.parse(input)
  const result = await createTask({
    project_id: parsed.project_id,
    owner_agent_slug: agentSlug,
    title: parsed.title,
    ...(parsed.description !== undefined ? { description: parsed.description } : {}),
    ...(parsed.assignee_agent_slug !== undefined ? { assignee_agent_slug: parsed.assignee_agent_slug } : {}),
    ...(parsed.github_pr_url !== undefined ? { github_pr_url: parsed.github_pr_url } : {}),
    ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
    ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
  })
  if (!result.authorized) {
    return {
      error: 'not_found_or_unauthorized',
      message: 'Project not found or you do not own it.',
    }
  }
  return result.task
}
