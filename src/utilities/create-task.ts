import { z } from 'zod'
import { createTask } from '../db/queries/tasks.js'
import { isValidAgentSlug } from '../squad/manifest.js'
import { resolveReviewer } from './task-transitions.js'

// S16-DB-02 (#2542): numeric estimate fields — Founder D2 "numeric values
// always". Envelope sanity (low <= expected <= high) is enforced at DB level
// (chk_tasks_estimates_bounds) and pre-checked here for a clean 400 instead
// of a 500. Arty rule (D10): no task without an estimate.
export const estimateFieldsSchema = {
  estimated_hours: z.number().positive().max(999),
  billing_low: z.number().min(0).max(999),
  billing_high: z.number().positive().max(999),
  estimate_confidence: z.enum(['low', 'medium', 'high']),
}

const estimateEnvelopeCheck = (val: { estimated_hours: number; billing_low: number; billing_high: number }): boolean =>
  val.billing_low <= val.estimated_hours && val.estimated_hours <= val.billing_high

export const createTaskSchema = z.object({
  project_id: z.number().int().positive(),
  title: z.string().min(1).max(500),
  ...estimateFieldsSchema,
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
  github_pr_url: z.url().optional(),
  notes: z.string().max(5000).optional(),
  // Operator-defined classification metadata. Domain-agnostic JSONB — keys and
  // values are set by the operator or agent. See docs/capabilities-reference.md
  // for recommended (non-enforced) key conventions.
  metadata: z.record(z.string(), z.unknown()).optional(),
})

// Arty rule enforcement: validate envelope AFTER object construction
createTaskSchema.superRefine((val, ctx) => {
  if (!estimateEnvelopeCheck(val)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Invalid estimate envelope: billing_low must be <= estimated_hours <= billing_high',
      path: ['billing_high'],
    })
  }
})

export type CreateTaskInput = z.infer<typeof createTaskSchema>

// SEC-21: owner_agent_slug is server-injected. The DB layer performs an explicit
// pre-flight SELECT to verify ownership before the INSERT — not a subquery
// inside the INSERT. This is the Locksmith-required pattern for auditability.
export async function handleCreateTask(input: CreateTaskInput, agentSlug: string) {
  const parsed = createTaskSchema.parse(input)

  // S17-BE-01 (#2555, D6): stamp the resolved reviewer at creation so the
  // domain-default reviewer (qa→scout etc.) has row visibility for the
  // review→pending-close gate. Fail-closed chain lives in task-transitions;
  // owner may re-assign reviewer_agent_slug later via update_task.
  const reviewer = resolveReviewer({
    task: {
      status: 'todo',
      assignee_agent_slug: parsed.assignee_agent_slug ?? null,
      reviewer_agent_slug: null,
      project_owner_agent_slug: agentSlug,
      metadata_domain:
        typeof parsed.metadata?.['domain'] === 'string' ? parsed.metadata['domain'] : undefined,
    },
    callerAgentSlug: agentSlug,
  })

  const result = await createTask({
    project_id: parsed.project_id,
    owner_agent_slug: agentSlug,
    title: parsed.title,
    estimated_hours: parsed.estimated_hours,
    billing_low: parsed.billing_low,
    billing_high: parsed.billing_high,
    estimate_confidence: parsed.estimate_confidence,
    ...(parsed.description !== undefined ? { description: parsed.description } : {}),
    ...(parsed.assignee_agent_slug !== undefined ? { assignee_agent_slug: parsed.assignee_agent_slug } : {}),
    reviewer_agent_slug: reviewer,
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
