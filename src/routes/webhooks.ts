/**
 * src/routes/webhooks.ts
 *
 * Inbound webhook routes for external integrations (ClickUp, JIRA, etc).
 *
 * Mounted at /webhooks (raw path, NOT under /api) with:
 * - express.raw({ type: 'application/json' }) to capture raw body
 * - Dedicated HMAC verification middleware (per provider)
 * - 200 req/min rate limiter (per SEC-C2)
 *
 * Security gates (Locksmith pre-merge):
 * - G1: Invalid or absent HMAC → 401, no DB write
 * - G2: Valid HMAC but echo-loop detection (updated_by == bot) → 200, no task mutation
 * - G3: sync_queue.payload never appears in logs at INFO or DEBUG
 *
 * CRITICAL (SEC-C1): express.raw() MUST run before express.json() globally.
 * If JSON parse runs first, re-serialization breaks HMAC verification.
 * The webhook route is mounted in server.ts BEFORE app.use(express.json()).
 */

import { Router } from 'express'
import { createHmac, timingSafeEqual } from 'crypto'
import { squadApiPool } from '../squad-api/db.js'

// Rate limiter for webhook endpoints (200 req/min per SEC-C2)
import rateLimit from 'express-rate-limit'

const webhookRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // 200 requests per window (SEC-C2)
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many webhook requests — retry after rate limit window' },
  skip: () => process.env['NODE_ENV'] === 'test',
})

export const webhooksRouter = Router()

// ============================================================================
// ClickUp Webhook — POST /webhooks/clickup
// ============================================================================

/**
 * Verify ClickUp HMAC signature (SEC-C1: raw body buffer, crypto.timingSafeEqual)
 *
 * ClickUp signs each webhook payload with HMAC-SHA256 using the registered
 * webhook secret. The signature is sent in the X-Signature header.
 *
 * Signature format: "sha256=<hex-digest>"
 * We verify against the CLICKUP_WEBHOOK_SECRET from .env.
 */
function verifyClickUpSignature(rawBody: Buffer, signature: string | undefined): boolean {
  const secret = process.env['CLICKUP_WEBHOOK_SECRET']
  if (!secret) {
    console.warn('[webhooks/clickup] CLICKUP_WEBHOOK_SECRET not configured')
    return false
  }

  if (!signature) {
    console.warn('[webhooks/clickup] X-Signature header missing')
    return false
  }

  // Signature format: "sha256=<hex-digest>"
  const [scheme, digest] = signature.split('=')
  if (scheme !== 'sha256' || !digest) {
    console.warn('[webhooks/clickup] Invalid signature scheme or format')
    return false
  }

  // Compute expected signature
  const hmac = createHmac('sha256', secret)
  hmac.update(rawBody)
  const expectedDigest = hmac.digest('hex')

  // Compare using timingSafeEqual to prevent timing attacks (SEC-A02)
  try {
    const expected = Buffer.from(expectedDigest, 'hex')
    const received = Buffer.from(digest, 'hex')
    return timingSafeEqual(expected, received)
  } catch (err) {
    console.warn('[webhooks/clickup] Signature comparison failed:', err instanceof Error ? err.message : String(err))
    return false
  }
}

/**
 * Parse and validate ClickUp webhook event payload
 *
 * ClickUp sends:
 * ```json
 * {
 *   "event": "taskUpdated" | "taskCreated" | "taskDeleted" | ...,
 *   "event_id": "<uuid>",
 *   "timestamp": 1234567890000,
 *   "data": {
 *     "id": "<task_id>",
 *     "name": "Task title",
 *     "status": { "status": "In Progress" },
 *     "updated_by": { "id": "<user_id>" },
 *     ...
 *   }
 * }
 * ```
 */
interface ClickUpWebhookPayload {
  event: string
  event_id: string
  timestamp: number
  data: {
    id: string
    name?: string
    status?: { status: string }
    updated_by?: { id: string }
    [key: string]: unknown
  }
}

function parseClickUpPayload(body: unknown): ClickUpWebhookPayload | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }

  const obj = body as Record<string, unknown>
  if (
    typeof obj.event !== 'string' ||
    typeof obj.event_id !== 'string' ||
    typeof obj.timestamp !== 'number' ||
    typeof obj.data !== 'object' ||
    obj.data === null
  ) {
    return null
  }

  return obj as unknown as ClickUpWebhookPayload
}

/**
 * POST /webhooks/clickup
 *
 * Inbound webhook from ClickUp for task updates.
 * - Verifies HMAC signature (SEC-C1, SEC-A02)
 * - Deduplicates on event_id (SEC-C3)
 * - Prevents echo loops: if updated_by == CLICKUP_BOT_USER_ID, returns 200 without processing (SEC-G2)
 * - Returns 200 on duplicate (never 4xx) so ClickUp doesn't retry (SEC-C3)
 */
webhooksRouter.post('/clickup', webhookRateLimit, async (req, res) => {
  // req.rawBody is populated by server.ts express.raw() middleware
  const rawBody = (req as { rawBody?: Buffer }).rawBody
  if (!rawBody) {
    console.warn('[webhooks/clickup] Raw body not available (express.raw not applied?)')
    res.status(400).json({ error: 'Bad request' })
    return
  }

  // ======================================================================
  // SEC-C1: Verify HMAC signature on raw buffer
  // ======================================================================
  const signature = req.headers['x-signature'] as string | undefined
  if (!verifyClickUpSignature(rawBody, signature)) {
    console.warn('[webhooks/clickup] HMAC verification failed (G1 gate)')
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  // ======================================================================
  // Parse payload
  // ======================================================================
  let payload: ClickUpWebhookPayload | null
  try {
    payload = parseClickUpPayload(JSON.parse(rawBody.toString('utf-8')))
    if (!payload) {
      console.warn('[webhooks/clickup] Invalid payload structure')
      res.status(400).json({ error: 'Bad request' })
      return
    }
  } catch (err) {
    console.warn('[webhooks/clickup] JSON parse error:', err instanceof Error ? err.message : String(err))
    res.status(400).json({ error: 'Bad request' })
    return
  }

  // ======================================================================
  // SEC-C3: Deduplication on clickup_event_id (UNIQUE constraint)
  // The inbound_events table has a UNIQUE(provider, provider_event_id) constraint.
  // Attempting to insert a duplicate will error; we catch and return 200 (never 4xx).
  // ======================================================================

  // ======================================================================
  // SEC-G2: Echo loop detection
  // If the update was made by the ClickUp bot account, drop it silently
  // (combined with event_id dedup for replay defence)
  // ======================================================================
  const botUserId = process.env['CLICKUP_BOT_USER_ID']
  if (botUserId && payload.data.updated_by?.id === botUserId) {
    console.log(`[webhooks/clickup] Echo loop detected (event ${payload.event_id}) — dropping`)
    res.status(200).json({ status: 'accepted' })
    return
  }

  // ======================================================================
  // Store event in inbound_events table
  // Status: 'pending' (awaiting processing by inbound handler)
  // Provider-specific processors poll this table and handle task linking/creation
  // ======================================================================
  try {
    const result = await squadApiPool.query<{ id: bigint }>(
      `
      INSERT INTO inbound_events (provider, provider_event_id, event_type, payload, status)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (provider, provider_event_id) DO NOTHING
      RETURNING id
      `,
      [
        'clickup',
        payload.event_id,
        payload.event,
        JSON.stringify(payload), // SEC-G3: payload stored but never logged at INFO/DEBUG
        'pending',
      ],
    )

    const row = result.rows[0]
    if (row) {
      console.log(`[webhooks/clickup] Event ${payload.event_id} stored (inbound_events row ${String(row.id)})`)
    } else {
      // Duplicate (UPSERT did not insert — already in table)
      console.log(`[webhooks/clickup] Event ${payload.event_id} already in queue — deduplicated`)
    }
    res.status(200).json({ status: 'accepted' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[webhooks/clickup] Failed to store event:', message)
    res.status(500).json({ error: 'Internal server error' })
  }
})
