import { z } from 'zod'

// ---------------------------------------------------------------------------
// Environment schema — validated at process startup.
// Any missing required variable throws immediately and prevents the MCP server
// from starting in a degraded state.
// ---------------------------------------------------------------------------

const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  // HTTP port for the health endpoint (separate from MCP stdio transport)
  HEALTH_PORT: z.coerce.number().int().positive().default(3000),
})

export type Config = z.infer<typeof ConfigSchema>

const result = ConfigSchema.safeParse(process.env)

if (!result.success) {
  const missing = result.error.issues
    .map((issue) => issue.path.join('.'))
    .join(', ')
  throw new Error(
    `[config] Missing or invalid required environment variables: ${missing}`,
  )
}

export const config: Config = result.data
