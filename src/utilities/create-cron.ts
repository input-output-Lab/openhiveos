import { z } from 'zod'
import cronParser from 'cron-parser'
import { createCron } from '../db/queries/crons.js'
import { REGISTERED_TOOL_NAMES } from './tool-registry.js'
import { validatePayload } from './update-cron.js'

// cron-parser is a CommonJS module — use default import (named exports unavailable in Node ESM)
const { parseExpression } = cronParser

// ---------------------------------------------------------------------------
// create_cron — ARCH-011
//
// SEC-26: tool_name validated against REGISTERED_TOOL_NAMES as const
//         (tool-registry.ts delivered; Locksmith validates match to index.ts at S4-06)
// SEC-27: payload validated — plain object only, ≤16KB serialized, ≤5 nesting levels
// SEC-28: schedule validated via cron-parser at Zod refine (fires before DB write)
// SEC-29: owner_agent_slug is server-injected from the bearer token;
//         project ownership pre-flight SELECT verifies caller owns the project before INSERT
//
// owner_agent_slug is never accepted from the caller (ARCH-001 / ARCH-008 Decision 7).
// ---------------------------------------------------------------------------

export const createCronSchema = z.object({
  project_id: z.number().int().positive(),
  name:       z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  // SEC-28: cron-parser validates the expression before any DB write
  schedule: z.string().min(1).refine(
    (val) => {
      try {
        parseExpression(val)
        return true
      } catch {
        return false
      }
    },
    { message: 'Invalid cron expression' },
  ),
  // SEC-26: tool_name must be in the registered tool allowlist
  tool_name: z
    .string()
    .refine(
      (val): val is (typeof REGISTERED_TOOL_NAMES)[number] =>
        (REGISTERED_TOOL_NAMES as readonly string[]).includes(val),
      { message: 'tool_name must be a registered MCP tool name' },
    ),
  // SEC-27: payload is a plain object, ≤16KB serialized, ≤5 nesting levels
  payload: z
    .unknown()
    .refine((val) => validatePayload(val), {
      message: 'payload must be a plain object, ≤16KB, with no more than 5 nesting levels',
    })
    .optional(),
})

export type CreateCronInput = z.infer<typeof createCronSchema>

export async function handleCreateCron(input: CreateCronInput, agentSlug: string) {
  const parsed = createCronSchema.parse(input)
  const result = await createCron({
    project_id:      parsed.project_id,
    owner_agent_slug: agentSlug,
    name:            parsed.name,
    ...(parsed.description !== undefined ? { description: parsed.description } : {}),
    schedule:        parsed.schedule,
    tool_name:       parsed.tool_name,
    ...(parsed.payload !== undefined ? { payload: parsed.payload } : {}),
  })
  if (!result.authorized) {
    return {
      error: 'not_found_or_unauthorized',
      message: 'Project not found or you do not own it.',
    }
  }
  return result.cron
}
