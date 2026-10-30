import { Router } from 'express'
import { z } from 'zod'
import { squadApiPool } from '../db.js'

// ---------------------------------------------------------------------------
// Internal ingestion router — ARCH-015
//
// POST /internal/usage — accepts LLM token/cost records from Bridge.
//
// Auth:      ingestionAuthMiddleware (OPENHIVEOS_INGESTION_TOKEN — SEC-C8)
// Rate:      ingestionRateLimit (60 req/min — SEC-C3)
// Mount:     app.use('/internal', ingestionRateLimit, ingestionAuthMiddleware, internalRouter)
//
// Security conditions implemented here:
//   SEC-C4  — Zod validates all fields; .strict() rejects unknown fields.
//             Invalid payload → 400. Parse runs before any DB write.
//   SEC-C5  — session_id regex: ^[a-z][a-z0-9_-]*:[^:]+:\d{13}$
//             Mirrors the opensquad session_id format exactly. Malformed → 400.
//   SEC-C6  — UNIQUE (session_id, loop_index) in DB. Duplicate insert → 409.
//             Not a security incident — expected Bridge retry behaviour.
//   SEC-C7  — every ingestion attempt logged; Authorization header redacted.
//   SEC-C8  — does NOT reference the agents table. Separate code path from auth.ts.
//   SEC-C9  — cost_usd required. Absent → 422 (Unprocessable Entity).
//             No server-side pricing computation. llm_model_pricing NOT included.
//
// OQ-2 resolved: loop_index is required (not optional). Optional loop_index
// would allow multiple NULL rows per session_id — NULL != NULL in PostgreSQL
// UNIQUE index comparisons, defeating the replay guard entirely.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Zod payload schema — SEC-C4, SEC-C5
// ---------------------------------------------------------------------------

const SESSION_ID_REGEX = /^[a-z][a-z0-9_-]*:[^:]+:\d{13}$/

// .strict() rejects any fields not listed here (SEC-C4: unknown fields rejected)
// S17-DB-01 (#2553): new optional fields mirror migration 022. All optional —
// legacy Bridge payloads remain valid. cost_usd stays required (SEC-C9:
// caller-supplied cost; server-side pricing is #2554's change alone).
const UsagePayloadSchema = z
  .object({
    session_id:            z.string().regex(SESSION_ID_REGEX),
    loop_index:            z.number().int().min(0),
    agent_slug:            z.string().min(1).max(64),
    model:                 z.string().min(1).max(256),
    provider:              z.string().min(1).max(128),
    prompt_tokens:         z.number().int().min(0),
    completion_tokens:     z.number().int().min(0),
    cost_usd:              z.number().min(0),
    cache_read_tokens:     z.number().int().min(0).optional(),
    cache_creation_tokens: z.number().int().min(0).optional(),
    task_id:               z.number().int().positive().optional(),
    project_id:            z.number().int().positive().optional(),
    client_surface:        z.enum(['vscode-copilot', 'claude-code', 'bridge', 'cli', 'cron', 'api']).optional(),
    requested_at:          z.string().datetime({ offset: true }).optional(),
    request_id:            z.string().min(1).max(256).optional(),
    reasoning_tokens:      z.number().int().min(0).optional(),
    prompt_token_details:  z
      .array(
        z.object({
          label:              z.string().min(1).max(128),
          percentageOfPrompt: z.number().min(0).max(100),
        }),
      )
      .max(32)
      .optional(),
  })
  .strict()

// ---------------------------------------------------------------------------
// INSERT SQL — parameterized; no user input ever interpolated into the string.
// ---------------------------------------------------------------------------

const INSERT_SQL = `
  INSERT INTO llm_usage (
    session_id, loop_index, agent_slug, model, provider,
    prompt_tokens, completion_tokens, cost_usd,
    cache_read_tokens, cache_creation_tokens, task_id,
    project_id, client_surface, requested_at, request_id,
    reasoning_tokens, prompt_token_details
  ) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8,
    $9, $10, $11,
    $12, $13, $14, $15,
    $16, $17
  )
`

// request_id (S17-DB-01) is a collector correlation key — deliberately NOT
// UNIQUE and never mapped onto loop_index: overloading it would corrupt the
// SEC-C6 replay guard, which keys on (session_id, loop_index) only.

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const internalRouter = Router()

// POST /internal/usage
internalRouter.post('/usage', async (req, res) => {
  // SEC-C7: log every ingestion attempt — Authorization header redacted.
  console.log(
    '[internal/usage] Ingestion attempt:',
    JSON.stringify({
      method:    req.method,
      path:      req.path,
      ip:        req.ip,
      auth:      req.headers['authorization'] ? '[redacted]' : 'absent',
      timestamp: new Date().toISOString(),
    }),
  )

  // SEC-C9: cost_usd must be present in the raw body. Return 422 before the
  // full Zod parse so the error code is semantically distinct from a 400
  // (missing business field vs invalid input format).
  const body: unknown = req.body
  if (
    typeof body !== 'object' ||
    body === null ||
    !('cost_usd' in body)
  ) {
    res.status(422).json({
      error: 'cost_usd is required — Bridge must supply the cost value; server-side pricing is not supported (SEC-C9)',
    })
    return
  }

  // Full schema validation — SEC-C4, SEC-C5.
  const parsed = UsagePayloadSchema.safeParse(body)
  if (!parsed.success) {
    res.status(400).json({
      error:   'Invalid payload',
      details: parsed.error.flatten().fieldErrors,
    })
    return
  }

  const {
    session_id,
    loop_index,
    agent_slug,
    model,
    provider,
    prompt_tokens,
    completion_tokens,
    cost_usd,
    cache_read_tokens,
    cache_creation_tokens,
    task_id,
    project_id,
    client_surface,
    requested_at,
    request_id,
    reasoning_tokens,
    prompt_token_details,
  } = parsed.data

  // Direct pool write — NOT via withReaderRole(). The ingestion endpoint
  // requires INSERT; withReaderRole() downgrades to SELECT-only (SEC-C8).
  const client = await squadApiPool.connect()
  try {
    await client.query(INSERT_SQL, [
      session_id,
      loop_index,
      agent_slug,
      model,
      provider,
      prompt_tokens,
      completion_tokens,
      cost_usd,
      cache_read_tokens ?? null,
      cache_creation_tokens ?? null,
      task_id ?? null,
      project_id ?? null,
      client_surface ?? null,
      requested_at ?? null,
      request_id ?? null,
      reasoning_tokens ?? null,
      prompt_token_details ? JSON.stringify(prompt_token_details) : null,
    ])

    console.log(
      '[internal/usage] Recorded:',
      JSON.stringify({ session_id, loop_index, agent_slug }),
    )

    res.status(201).json({ recorded: true })
  } catch (err) {
    // SEC-C6: UNIQUE (session_id, loop_index) conflict → 409, not 500.
    // Bridge fire-and-forget retries produce this on the second attempt for
    // a successfully delivered record. This is expected, not an error.
    const pgCode = (err as { code?: string }).code
    if (pgCode === '23505') {
      console.log(
        '[internal/usage] Duplicate ignored (SEC-C6):',
        JSON.stringify({ session_id, loop_index }),
      )
      res.status(409).json({
        error: 'Duplicate usage record — (session_id, loop_index) already exists',
      })
      return
    }

    // Structural log only — no payload values (session_id is the safe identifier)
    console.error(
      '[internal/usage] Insert failed:',
      err instanceof Error ? err.message : 'unknown error',
    )
    res.status(500).json({ error: 'Internal server error' })
  } finally {
    client.release()
  }
})
