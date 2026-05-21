import { z } from 'zod'
import cronParser from 'cron-parser'
import { updateCron } from '../db/queries/crons.js'
import { REGISTERED_TOOL_NAMES } from './tool-registry.js'

// cron-parser is a CommonJS module — use default import (named exports unavailable in Node ESM)
const { parseExpression } = cronParser

// ---------------------------------------------------------------------------
// update_cron — ARCH-011
//
// SEC-26: tool_name validated against REGISTERED_TOOL_NAMES as const
// SEC-27: payload validated — plain object only, ≤16KB serialized, ≤5 nesting levels
// SEC-28: schedule validated via cron-parser at Zod refine (fires before DB write)
// SEC-29: owner_agent_slug is server-injected; not exposed as a mutable field;
//         not-found and not-owned both return { error: 'not_found_or_unauthorized' }
//
// status accepts 'active' | 'paused' only — soft deletion routes through delete_cron.
// ---------------------------------------------------------------------------

// SEC-27 payload helpers — reused in create-cron.ts
function countNestingDepth(value: unknown, depth = 0): number {
  if (depth > 6) return depth // short-circuit — already too deep
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const nested = Object.values(value as Record<string, unknown>)
    if (nested.length === 0) return depth
    return Math.max(...nested.map((v) => countNestingDepth(v, depth + 1)))
  }
  return depth
}

export function validatePayload(val: unknown): val is Record<string, unknown> {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) return false
  const serialized = JSON.stringify(val)
  if (serialized.length > 16_384) return false // 16KB limit
  if (countNestingDepth(val) > 5) return false
  return true
}

export const updateCronSchema = z.object({
  id:          z.number().int().positive(),
  name:        z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  // SEC-28: cron-parser validates the expression before any DB write
  schedule: z
    .string()
    .min(1)
    .refine(
      (val) => {
        try {
          parseExpression(val)
          return true
        } catch {
          return false
        }
      },
      { message: 'Invalid cron expression' },
    )
    .optional(),
  // SEC-26: tool_name must be in the registered tool allowlist
  tool_name: z
    .string()
    .refine(
      (val): val is (typeof REGISTERED_TOOL_NAMES)[number] =>
        (REGISTERED_TOOL_NAMES as readonly string[]).includes(val),
      { message: 'tool_name must be a registered MCP tool name' },
    )
    .optional(),
  // SEC-27: payload is a plain object, ≤16KB serialized, ≤5 nesting levels
  // Pass null explicitly to clear the payload field.
  payload: z
    .unknown()
    .refine((val) => val === null || validatePayload(val), {
      message: 'payload must be a plain object, ≤16KB, with no more than 5 nesting levels',
    })
    .optional(),
  // 'deleted' is not accepted here — use delete_cron to soft-delete
  status: z.enum(['active', 'paused']).optional(),
})

export type UpdateCronInput = z.infer<typeof updateCronSchema>

export async function handleUpdateCron(input: UpdateCronInput, agentSlug: string) {
  const parsed = updateCronSchema.parse(input)
  const result = await updateCron({
    id: parsed.id,
    owner_agent_slug: agentSlug,
    ...(parsed.name        !== undefined ? { name: parsed.name }               : {}),
    ...(parsed.description !== undefined ? { description: parsed.description } : {}),
    ...(parsed.schedule    !== undefined ? { schedule: parsed.schedule }        : {}),
    ...(parsed.tool_name   !== undefined ? { tool_name: parsed.tool_name }      : {}),
    ...(parsed.payload     !== undefined
      ? { payload: parsed.payload }
      : {}),
    ...(parsed.status !== undefined ? { status: parsed.status } : {}),
  })
  if (result.kind === 'not_found_or_unauthorized') {
    return {
      error: 'not_found_or_unauthorized',
      message: 'Cron not found or you do not own it.',
    }
  }
  return result.cron
}
