// ---------------------------------------------------------------------------
// step-up — S19-ARCH-01c (#2776): human step-up via MCP elicitation.
// ARCH-028 (draft, Tier-3): the human confirmation for gated transitions.
//
// Contract with the gateway:
//   - The gateway stamps _meta.__stepUpNonce on every proxied callTool and
//     registers { nonce → session } in its pending map.
//   - This module echoes the nonce back in the elicitation request _meta.
//     The gateway routes by nonce; unknown/expired nonce → decline, which
//     this module treats exactly like a human "no" (fail-closed).
//   - On approval the gateway stamps the RESULT _meta.__stepUpUser with the
//     operator label; standalone mode falls back to 'direct-client' (the
//     directly connected client answered, typically the human's own CLI).
//
// FAIL-CLOSED RULE: approval requires action === 'accept' AND
// content.approve === true. Decline, cancel, timeout, transport error,
// malformed answer — all identical: not approved.
// ---------------------------------------------------------------------------

import { ElicitResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { ElicitRequest } from '@modelcontextprotocol/sdk/types.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'

/** Roles that require a human step-up before the transition proceeds. */
export const DEFAULT_STEPUP_ROLES: ReadonlySet<string> = new Set(['approver'])

/**
 * Resolve the gated-role set from HIVE_STEPUP_ROLES (comma-separated subset
 * of reviewer,approver). Unknown or empty values fall back to the default
 * (approver only). Widening is config, not code (ARCH-028 Decision 3).
 */
export function resolveStepUpRoles(envValue: string | undefined): Set<string> {
  if (!envValue || envValue.trim() === '') return new Set(DEFAULT_STEPUP_ROLES)
  const allowed = new Set(['reviewer', 'approver'])
  const parsed = new Set(
    envValue
      .split(',')
      .map((s) => s.trim())
      .filter((s) => allowed.has(s)),
  )
  return parsed.size > 0 ? parsed : new Set(DEFAULT_STEPUP_ROLES)
}

export interface StepUpContext {
  taskId: number
  taskTitle: string
  fromStatus: string
  toStatus: string
  callerAgentSlug: string
  /** Nonce the gateway injected into this call's _meta (absent in standalone). */
  stepUpNonce: string | null
}

export interface StepUpOutcome {
  approved: boolean
  /** Operator label recorded on the history row when approved. */
  stepUpUser: string
  reason: string
}

const STEPUP_NONCE_META_KEY = '__stepUpNonce'
const STEPUP_USER_META_KEY = '__stepUpUser'
const DEFAULT_TIMEOUT_MS = 120_000

export function stepUpTimeoutMs(): number {
  const raw = process.env['GATEWAY_STEPUP_TIMEOUT_MS']
  const parsed = raw !== undefined ? parseInt(raw, 10) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
}

export function stepUpUserFallback(): string {
  return process.env['HIVE_OPERATOR'] ?? 'direct-client'
}

interface ElicitContent {
  approve?: unknown
}

/**
 * Run the human step-up for one gated transition. Sends elicitation/create
 * over the session the tool call arrived on (extra.sendRequest binds it to
 * the calling session — session affinity by construction) and returns the
 * STRICT approval decision. Never throws: every failure mode collapses to
 * { approved: false }.
 */
export async function runStepUp(
  ctx: StepUpContext,
  extra: Pick<RequestHandlerExtra<ElicitRequest, never>, 'sendRequest' | 'signal'>,
): Promise<StepUpOutcome> {
  const message =
    `HUMAN STEP-UP REQUIRED — approve task #${String(ctx.taskId)} "${ctx.taskTitle}" ` +
    `transition ${ctx.fromStatus} → ${ctx.toStatus} (requested by agent "${ctx.callerAgentSlug}")?`

  const requestMeta: Record<string, unknown> = {}
  if (ctx.stepUpNonce !== null) {
    // Nonce round-trip: lets the gateway bind THIS elicitation to THIS
    // session. A fabricated nonce gets declined at the gateway.
    requestMeta[STEPUP_NONCE_META_KEY] = ctx.stepUpNonce
  }

  try {
    const result = await extra.sendRequest(
      {
        method: 'elicitation/create',
        params: {
          message,
          requestedSchema: {
            type: 'object' as const,
            properties: {
              approve: { type: 'boolean', title: 'Approve', description: 'Approve this transition?' },
            },
            required: ['approve'],
          },
          _meta: requestMeta,
        },
      },
      ElicitResultSchema,
      { timeout: stepUpTimeoutMs() },
    )

    // STRICT gate: accept + explicit true. Anything else — decline, cancel,
    // malformed content, absent flag — is NOT an approval.
    const content = (result as { content?: ElicitContent }).content
    const approved = result.action === 'accept' && content?.approve === true
    if (!approved) {
      return {
        approved: false,
        stepUpUser: '',
        reason: `step-up not approved (action=${result.action})`,
      }
    }
    // Gateway stamps the operator label on the result _meta. Standalone
    // fallback names the directly connected client as the answering party.
    const resultMeta = (result as { _meta?: Record<string, unknown> })._meta
    const rawUser = resultMeta?.[STEPUP_USER_META_KEY]
    const stepUpUser =
      typeof rawUser === 'string' && rawUser.length >= 1 && rawUser.length <= 64 && !/\s/.test(rawUser)
        ? rawUser
        : stepUpUserFallback()

    return { approved: true, stepUpUser, reason: 'human approved via elicitation' }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { approved: false, stepUpUser: '', reason: `step-up failed: ${detail.slice(0, 200)}` }
  }
}
