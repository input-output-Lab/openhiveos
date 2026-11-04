/**
 * GitHub PR-merge webhook — POST /webhooks/github (S18-BE-02, task 2559)
 *
 * Tier 3 (auth-adjacent): GitHub's PR-merged event auto-transitions the linked
 * task (matched by github_pr_url) from `review` to `pending-close`.
 *
 * Follows the ARCH-024 ClickUp webhook pattern exactly:
 *  - G1: invalid/absent HMAC → 401, no DB write
 *  - G2: valid but non-transitioning event → 200, no task mutation
 *  - G3: payload never logged at INFO/DEBUG
 *  - SEC-C1: express.raw() before express.json() (mount in server.ts handles it)
 *  - SEC-C2: shared webhook rate limiter
 *  - SEC-C3: replay guard via inbound_events UNIQUE(provider, provider_event_id)
 *
 * Fail-closed transition rules:
 *  1. Only `pull_request` events with action=closed AND merged=true.
 *  2. Only tasks whose github_pr_url matches the PR's html_url exactly.
 *  3. Only tasks currently in status='review' (anything else → no-op, 200).
 *  4. changed_by='github-webhook:<login>' in the audit history — the merge IS
 *     the reviewer evidence; no agent reviewer identity is fabricated.
 */

import { Router } from 'express'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { squadApiPool } from '../squad-api/db.js'
import { withActor } from '../db/client.js'

// G1: HMAC-SHA256 over the raw body, X-Hub-Signature-256: "sha256=<hex>"
export function verifyGithubSignature(rawBody: Buffer, signature: string | undefined): boolean {
  const secret = process.env['GITHUB_WEBHOOK_SECRET']
  if (!secret) {
    console.warn('[webhooks/github] GITHUB_WEBHOOK_SECRET not configured')
    return false
  }
  if (!signature) {
    console.warn('[webhooks/github] X-Hub-Signature-256 header missing')
    return false
  }
  const [scheme, digest] = signature.split('=')
  if (scheme !== 'sha256' || !digest) {
    console.warn('[webhooks/github] Invalid signature scheme or format')
    return false
  }
  const hmac = createHmac('sha256', secret)
  hmac.update(rawBody)
  const expected = Buffer.from(hmac.digest('hex'), 'hex')
  try {
    const received = Buffer.from(digest, 'hex')
    return timingSafeEqual(expected, received)
  } catch {
    return false
  }
}

interface PrMergePayload {
  action: string
  pull_request: {
    merged: boolean
    html_url: string
    merged_by?: { login?: string } | null
  }
}

export function parsePrMergedPayload(body: unknown): PrMergePayload | null {
  if (typeof body !== 'object' || body === null) return null
  const obj = body as Record<string, unknown>
  const pr = obj['pull_request']
  if (typeof obj['action'] !== 'string') return null
  if (typeof pr !== 'object' || pr === null) return null
  const prObj = pr as Record<string, unknown>
  if (typeof prObj['merged'] !== 'boolean' || typeof prObj['html_url'] !== 'string') return null
  const mergedBy =
    typeof prObj['merged_by'] === 'object' && prObj['merged_by'] !== null
      ? (prObj['merged_by'] as Record<string, unknown>)
      : null
  return {
    action: obj['action'],
    pull_request: {
      merged: prObj['merged'],
      html_url: prObj['html_url'],
      merged_by:
        mergedBy && typeof mergedBy['login'] === 'string' ? { login: mergedBy['login'] } : null,
    },
  }
}

export const githubWebhookRouter = Router()

githubWebhookRouter.post('/github', async (req, res) => {
  const rawBody = req.body as Buffer
  if (!Buffer.isBuffer(rawBody)) {
    res.status(400).json({ error: 'Expected raw body' })
    return
  }

  // ---- G1: signature gate (before any parsing or DB access) --------------
  const signature = req.headers['x-hub-signature-256'] as string | undefined
  if (!verifyGithubSignature(rawBody, signature)) {
    res.status(401).json({ error: 'Invalid signature' })
    return
  }

  // ---- Parse (only after signature trust is established) -----------------
  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(rawBody.toString('utf8'))
  } catch {
    res.status(400).json({ error: 'Invalid JSON' })
    return
  }
  const payload = parsePrMergedPayload(parsedBody)
  const deliveryId = req.headers['x-github-delivery'] as string | undefined

  // G2: non-actionable events (opened, synchronize, closed-without-merge,
  // issues, push, ping) → 200 accepted, zero mutation, zero log noise.
  if (payload === null || payload.action !== 'closed' || !payload.pull_request.merged) {
    res.status(200).json({ status: 'ignored' })
    return
  }

  if (deliveryId === undefined || deliveryId === '') {
    // GitHub always sends X-GitHub-Delivery; absence means a non-GitHub client.
    res.status(400).json({ error: 'Missing delivery id' })
    return
  }

  const prUrl = payload.pull_request.html_url
  const mergedByLogin = payload.pull_request.merged_by?.login ?? 'unknown'

  // ---- SEC-C3: replay guard (UNIQUE(provider, provider_event_id)) --------
  try {
    const stored = await squadApiPool.query<{ id: bigint }>(
      `INSERT INTO inbound_events (provider, provider_event_id, event_type, payload, status)
       VALUES ('github', $1, 'pull_request.closed.merged', $2, 'processed')
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING id`,
      [deliveryId, JSON.stringify({ pr_url: prUrl, merged_by: mergedByLogin })], // G3: minimal payload, never full body
    )

    if (stored.rows.length === 0) {
      console.log(`[webhooks/github] Delivery ${deliveryId} already processed — deduplicated`)
      res.status(200).json({ status: 'duplicate' })
      return
    }

    // ---- Fail-closed transition: review → pending-close ------------------
    // Attribution via migration 024's audit trigger: it reads hive.actor
    // (SET LOCAL inside withActor's transaction) and writes the history row
    // itself. Never insert history rows manually — the trigger is the single
    // audit writer. Actor pattern: 'system:<name>' per withActor's regex;
    // the merged-by login is embedded so the audit names the human evidence.
    const actorSlug = `system:github-webhook-${mergedByLogin.replace(/[^a-z0-9_-]/gi, '')}`
    const transitioned = await withActor(actorSlug, async (tx) => {
      const result = await tx.query<{ id: bigint; title: string }>(
        `UPDATE tasks
            SET status = 'pending-close',
                updated_at = now()
          WHERE github_pr_url = $1
            AND status = 'review'
          RETURNING id, title`,
        [prUrl],
      )
      return result.rows
    })

    if (transitioned.length === 0) {
      console.log(`[webhooks/github] PR ${prUrl} merged — no task in review with this PR URL (no-op)`)
      res.status(200).json({ status: 'no_matching_task' })
      return
    }

    for (const task of transitioned) {
      console.log(`[webhooks/github] Task ${String(task.id)} (${task.title}) review→pending-close (PR merged by ${mergedByLogin})`)
    }

    res.status(200).json({ status: 'transitioned', tasks: transitioned.map((t) => String(t.id)) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[webhooks/github] Failed to process merge event:', message)
    res.status(500).json({ error: 'Internal server error' })
  }
})
