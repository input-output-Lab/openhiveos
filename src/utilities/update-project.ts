import { z } from 'zod'
import { applyPortfolioUpdate } from '../db/queries/projects.js'

/**
 * S11-BE-03: update_project MCP utility
 *
 * Updates portfolio matrix fields on a project. Any authenticated agent may call
 * this tool (no ownership restriction — tool-assignment is the access gate).
 *
 * ARCH-021: Value domain 1/3/5 categorical for all four fields.
 * ARCH-021: ROI score computed on read, never stored.
 *
 * SEC-31: Field allowlist — only portfolio matrix fields may be updated.
 * Mass assignment is impossible.
 */

export const updateProjectSchema = z.object({
  project_id: z.number().int().positive('project_id must be a positive integer'),
  business_value: z
    .union([z.literal(1), z.literal(3), z.literal(5)])
    .nullable()
    .optional(),
  strategic_fit: z
    .union([z.literal(1), z.literal(3), z.literal(5)])
    .nullable()
    .optional(),
  effort: z
    .union([z.literal(1), z.literal(3), z.literal(5)])
    .nullable()
    .optional(),
  risk_index: z
    .union([z.literal(1), z.literal(3), z.literal(5)])
    .nullable()
    .optional(),
})

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>

/**
 * Handle an update_project MCP tool call.
 *
 * Any agent with update_project in their tool list can call this.
 * No ownership restriction — any project may be updated by any authenticated agent.
 *
 * The access gate is tool-assignment in squad.manifest.json, not project ownership.
 *
 * Returns the updated project row with computed roi_score.
 * Throws if project_id does not exist.
 */
export async function handleUpdateProject(input: UpdateProjectInput) {
  const parsed = updateProjectSchema.parse(input)

  // SEC-31: Validate that at least one field is provided (no-op updates rejected)
  const hasUpdate = [
    parsed.business_value !== undefined,
    parsed.strategic_fit !== undefined,
    parsed.effort !== undefined,
    parsed.risk_index !== undefined,
  ].some(Boolean)

  if (!hasUpdate) {
    throw new Error('At least one portfolio matrix field must be provided')
  }

  try {
    const project = await applyPortfolioUpdate({
      project_id: parsed.project_id,
      ...(parsed.business_value !== undefined ? { business_value: parsed.business_value } : {}),
      ...(parsed.strategic_fit !== undefined ? { strategic_fit: parsed.strategic_fit } : {}),
      ...(parsed.effort !== undefined ? { effort: parsed.effort } : {}),
      ...(parsed.risk_index !== undefined ? { risk_index: parsed.risk_index } : {}),
    })

    return {
      kind: 'success' as const,
      project,
      roi_score: project.roi_score ?? null,
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return {
        kind: 'not_found' as const,
        message: `Project ${String(parsed.project_id)} not found`,
      }
    }
    throw err
  }
}
