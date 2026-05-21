import { z } from 'zod'

// ---------------------------------------------------------------------------
// Squad API environment schema — validated at startup.
// Intentionally separate from src/config.ts: that file requires AGENT_TOKEN
// (MCP server identity). The squad-api is a distinct process with different
// runtime requirements.
// ---------------------------------------------------------------------------

const SquadApiConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // HTTP port for the squad-api (default: 3005 per ARCH-012)
  SQUAD_API_PORT: z.coerce.number().int().positive().default(3005),
  // Ingestion token for POST /internal/usage — ARCH-015 SEC-C1.
  // Must be exactly 64 hex characters (32 bytes CSPRNG entropy).
  // Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  // Never commit a real value. Store in .env and 1Password only.
  OPENHIVEOS_INGESTION_TOKEN: z.string().min(64),
})

export type SquadApiConfig = z.infer<typeof SquadApiConfigSchema>

const result = SquadApiConfigSchema.safeParse(process.env)

if (!result.success) {
  const missing = result.error.issues.map((issue) => issue.path.join('.')).join(', ')
  throw new Error(
    `[squad-api/config] Missing or invalid environment variables: ${missing}`,
  )
}

export const squadApiConfig: SquadApiConfig = result.data
