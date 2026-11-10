/**
 * packages/mcp-gateway/src/index.ts
 *
 * OpenHiveOS mcp-gateway — MCP HTTP + SSE bridge.
 *
 * Exposes two transports:
 *   POST /mcp  — StreamableHTTP (MCP SDK 1.x) — VS Code / Copilot clients
 *   GET  /sse  — Legacy SSE (MCP SDK 0.x)     — Bridge / openBridge integrations
 *
 * ARCH-021 (per-request identity): Bearer token on /mcp is the agent's own
 * AGENT_TOKEN. The gateway resolves the agent slug via DB lookup and injects
 * it as __agentSlug into every callTool() call. The subprocess reads it
 * per-call in GATEWAY_MODE instead of using a boot-time identity closure.
 *
 * SEC-D1/D2: auth via per-agent Bearer token (DB lookup) on /mcp.
 *            Legacy /sse still uses MCP_GATEWAY_TOKEN for Bridge connections.
 * SEC-D3 [CRITICAL]: token is never logged.
 * SEC-D4: binds to 127.0.0.1 only — never 0.0.0.0.
 * SEC-D7: HEALTH_PORT injected into subprocess env (handled in gateway.ts).
 * SEC-D8: connections block until subprocess is ready (gateway.waitUntilReady).
 * SEC-D9: rate limits on all authenticated endpoints.
 * SEC-D10: only gateway-scoped env vars consumed here.
 * SEC-D11: last_used_at updated per resolved agent on each authenticated call.
 */
import express, { type Request, type Response, type NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import { timingSafeEqual } from 'crypto'
import { Pool } from 'pg'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ElicitResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { Gateway, resolveAgentSlug } from './gateway.js'
import { assertDevAuthAllowed, DEV_ACTOR_SLUG } from './dev-auth.js'
import { extractPersonaClaim, buildProvenanceMeta, META_AGENT_SLUG_KEY, META_CLAIMED_PERSONA_KEY, META_AUTH_STRENGTH_KEY, type IdentityAudit } from './auth-context.js'
import { SessionRegistry } from './session-state.js'

// ---------------------------------------------------------------------------
// S19-ARCH-01c: gateway session registry + step-up operator label.
// The gateway goes stateful (ARCH-028 trade-off 1): sessions live in process
// memory, bound to the bearer-resolved agent slug. GATEWAY_OPERATOR names the
// human for step-up audit rows — a LABEL, not a control (single-operator
// loopback premise). Unset → 'operator' with a boot warning.
// ---------------------------------------------------------------------------
const sessions = new SessionRegistry()
const OPERATOR_LABEL = (() => {
  const raw = process.env['GATEWAY_OPERATOR']
  if (raw && raw.length >= 1 && raw.length <= 64 && !/\s/.test(raw)) return raw
  console.error('[mcp-gateway] WARNING: GATEWAY_OPERATOR unset — step-up audit rows will record the generic label "operator"')
  return 'operator'
})()

// ---------------------------------------------------------------------------
// Boot-time validation (SEC-D2, SEC-D10)
// ---------------------------------------------------------------------------

// MCP_GATEWAY_TOKEN is still required for legacy /sse (Bridge) connections.
const rawToken = process.env['MCP_GATEWAY_TOKEN']
if (!rawToken || rawToken.length < 64) {
  console.error(
    '[mcp-gateway] FATAL: MCP_GATEWAY_TOKEN must be set and at least 64 hex characters (32 bytes CSPRNG)',
  )
  process.exit(1)
}
const TOKEN_BUF = Buffer.from(rawToken, 'utf8')

// ---------------------------------------------------------------------------
// MCP_GATEWAY_AUTH_DISABLED boot guard (S17-BE-06, task 2637 — Tier-3).
// Decision logic lives in dev-auth.ts (unit-tested); this boot check fails
// closed BEFORE listen, so a stale pm2-cached flag cannot silently re-enable
// dev-auth in production or on a non-loopback bind.
// ---------------------------------------------------------------------------
const devAuth = assertDevAuthAllowed({
  authDisabled: process.env['MCP_GATEWAY_AUTH_DISABLED'] === 'true',
  nodeEnv: process.env['NODE_ENV'],
  gatewayBind: process.env['GATEWAY_BIND'] ?? '127.0.0.1',
})
if (!devAuth.allowed) {
  console.error(devAuth.reason)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Database pool — used by resolveAgentSlug for per-request identity (ARCH-021)
// ---------------------------------------------------------------------------

const dbUrl = process.env['DATABASE_URL']
if (!dbUrl) {
  console.error('[mcp-gateway] FATAL: DATABASE_URL must be set')
  process.exit(1)
}
const pool = new Pool({ connectionString: dbUrl })

const PORT = parseInt(process.env['MCP_GATEWAY_PORT'] ?? '3006', 10)

// ---------------------------------------------------------------------------
// Subprocess + MCP client
// ---------------------------------------------------------------------------

const gateway = new Gateway()
await gateway.start()

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express()

// ---------------------------------------------------------------------------
// GET /health — subprocess readiness probe (two-layer health check, F9)
// No auth required — health is not a sensitive surface.
// 200 when subprocess is ready; 503 while starting.
// ---------------------------------------------------------------------------

app.get('/health', (_req: Request, res: Response) => {
  if (gateway.isReady()) {
    res.status(200).json({ status: 'ok' })
  } else {
    res.status(503).json({ status: 'starting' })
  }
})

// SEC-D9: rate limit on SSE connection endpoint.
// Operates on source IP. Returns 429 + Retry-After on breach.
const sseRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many SSE connection attempts. Retry later.' },
})

// SEC-FINDING-1 (fix): rate limit on POST /message.
// Authenticated surface only — but a stolen token must not enable request flooding.
// 120/min per IP ≈ 2 RPS sustained — generous for Bridge use, constraining for abuse.
const messageRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many message requests. Retry later.' },
})

// ---------------------------------------------------------------------------
// Tool invocation logging (fire-and-forget, Track 1 gateway instrumentation)
// ARCH-015 T1-2 + T1-3 — log all tool calls to tool_invocations table.
// S16-DB-03 (#2543) — analytics enrichment: session/request correlation,
// task/project attribution, client surface, actor tagging, arg analytics.
//
// Locksmith condition (#2543): argument VALUES are NEVER stored. Only the
// argument KEY NAMES (arg_keys) and a SHA-256 of the canonical values JSON
// (args_hash) are persisted — values routinely contain file contents, task
// notes, and tokens. arg_keys itself could leak data through key names that
// embed values (e.g. a dynamic key); those keys are generic in practice, and
// the hash covers the rest.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto'

interface ToolInvocationContext {
  sessionId: string | null
  requestId: string | null
  arguments: Record<string, unknown> | null
  responseBytes: number | null
}

/** Extract arg key names + canonical values hash. Never returns values. */
function argsFingerprint(args: Record<string, unknown> | null): { keys: string[]; hash: string | null } {
  if (!args || typeof args !== 'object') return { keys: [], hash: null }
  const keys = Object.keys(args).sort()
  // Canonical JSON: sorted keys, stable serialization — same args always hash equal.
  const canonical = JSON.stringify(args, Object.keys(args).sort())
  return { keys, hash: createHash('sha256').update(canonical).digest('hex') }
}

/** Extract task_id when the tool call carries one (task_id or task_id-bearing arg). */
function extractTaskId(args: Record<string, unknown> | null): number | null {
  if (!args) return null
  const raw = args['task_id'] ?? args['taskId']
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return parseInt(raw, 10)
  return null
}

/**
 * Client surface: VS Code Copilot clients announce via _meta (the gateway
 * harness sets __clientSurface); absence → the transport still identifies the
 * protocol surface. Session correlation uses the MCP protocol session id.
 */
function extractSurface(params: { _meta?: Record<string, unknown> }): string {
  const s = params._meta?.['__clientSurface']
  if (typeof s === 'string' && /^(vscode-copilot|claude-code|bridge|cli|cron|api)$/.test(s)) return s
  return 'unknown'
}

/**
 * Fire-and-forget INSERT to tool_invocations.
 * S16-DB-03: enriched signature — task attribution resolves project_id via a
 * single join at write time so budget/analytics rollups skip it at read time.
 * Failures in this function must NOT crash or corrupt the upstream
 * tool call response. Errors are logged to stderr for operator inspection.
 *
 * S19-ARCH-01b: also records protocol-level calls (tools/list) — the
 * discovery surface previously left no audit trace. These rows carry
 * tool_name='tools/list' so every row stays attributable to the auth path
 * that produced it; they have no task attribution (task_id/project_id NULL),
 * and /mcp rows have session_id NULL so the worklog derivation view
 * (v_session_active_time filters session_id IS NOT NULL) is unaffected.
 */
function logToolInvocation(
  agentSlug: string,
  toolName: string,
  transport: 'streamable_http' | 'sse',
  durationMs: number,
  success: boolean,
  errorClass: string | null,
  ctx: ToolInvocationContext = { sessionId: null, requestId: null, arguments: null, responseBytes: null },
  identity: IdentityAudit = { claimedPersona: null, authStrength: 'unverified' },
): void {
  const { keys, hash } = argsFingerprint(ctx.arguments)
  const taskId = extractTaskId(ctx.arguments)
  const surface = 'unknown' // resolved by caller from _meta

  // Resolve project_id only when a task is attributed (single indexed lookup;
  // skip entirely when no task — most calls have none).
  void (async () => {
    let projectId: number | null = null
    if (taskId !== null) {
      try {
        const res = await pool.query<{ project_id: number }>(
          'SELECT project_id FROM tasks WHERE id = $1 LIMIT 1',
          [taskId],
        )
        projectId = res.rows[0]?.project_id ?? null
      } catch {
        projectId = null
      }
    }

    return pool.query(
      `INSERT INTO tool_invocations
         (agent_slug, tool_name, transport, duration_ms, success, error_class,
          session_id, request_id, task_id, project_id, client_surface,
          actor_type, arg_keys, args_hash, error_message, response_bytes,
          claimed_persona, auth_strength)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        agentSlug,
        toolName,
        transport,
        durationMs,
        success,
        errorClass,
        ctx.sessionId,
        ctx.requestId,
        taskId,
        projectId,
        ctx.sessionId !== null ? surface : null,
        'agent', // gateway path is always agent-invoked; automation traffic enters via source != 'gateway'
        keys.length > 0 ? keys : null,
        hash,
        success ? null : errorClass,
        ctx.responseBytes,
        identity.claimedPersona, // S19-ARCH-01a: spoofable-by-design claim label (ARCH-026)
        identity.authStrength,   // S19-ARCH-01a: auth path that produced the attribution
      ],
    )
  })().catch((err) => {
    const safeErr = err instanceof Error ? err.message : String(err)
    console.warn(
      `[mcp-gateway] tool_invocations insert failed: agent_slug=${agentSlug} tool_name=${toolName} error=${safeErr}`,
    )
  })
}

/**
 * SEC-D1/D2/D3: validates ?token= query param with constant-time comparison.
 * Used by legacy /sse endpoint.
 */
function validateTokenQuery(req: Request, res: Response, next: NextFunction): void {
  const provided = req.query['token']
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete req.query['token']

  if (typeof provided !== 'string') {
    res.status(401).json({ error: 'Missing authentication token' })
    return
  }

  const providedBuf = Buffer.from(provided, 'utf8')
  if (
    providedBuf.length !== TOKEN_BUF.length ||
    !timingSafeEqual(providedBuf, TOKEN_BUF)
  ) {
    res.status(401).json({ error: 'Invalid authentication token' })
    return
  }

  next()
}

/**
 * ARCH-021: resolves the calling agent from the Bearer token via DB lookup.
 * Attaches the resolved agentSlug to res.locals for use in the /mcp handler.
 * SEC-D3: token value is never logged.
 *
 * For local development, MCP_GATEWAY_AUTH_DISABLED can be set to skip
 * authentication and use a default agent slug.
 */
async function resolveAgentFromBearer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Development mode: skip auth if MCP_GATEWAY_AUTH_DISABLED is set.
  // Boot guard above already ensured this is loopback + non-production.
  // S17-BE-06: dev callers map to a NON-PRIVILEGED identity. The old value
  // 'elizabeth' made every unauthenticated local call the APPROVER.
  // S19-ARCH-01a: the resolved path stamps the audit rows — bearer-verified
  // callers are 'bearer'; the dev-flag path is always 'dev' so the trail
  // shows when attribution came from the non-privileged dev identity.
  const authDisabled = process.env['MCP_GATEWAY_AUTH_DISABLED'] === 'true'
  if (authDisabled) {
    res.locals['agentSlug'] = DEV_ACTOR_SLUG
    res.locals['authStrength'] = 'dev'
    next()
    return
  }

  const authHeader = req.headers['authorization']

  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' })
    return
  }

  const rawBearerToken = authHeader.slice('Bearer '.length)
  const agentSlug = await resolveAgentSlug(pool, rawBearerToken)

  if (!agentSlug) {
    res.status(401).json({ error: 'Invalid authentication token' })
    return
  }

  res.locals['agentSlug'] = agentSlug
  res.locals['authStrength'] = 'bearer'
  next()
}

// ---------------------------------------------------------------------------
// POST /mcp — StreamableHTTP transport (VS Code / Copilot clients, MCP SDK 1.x)
// ---------------------------------------------------------------------------

const mcpRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Retry later.' },
})

// ---------------------------------------------------------------------------
// S19-ARCH-01c-R1 (FIND-2 fix): ONE Server+transport per SESSION, created at
// initialize and stored in the registry. StreamableHTTP stateful mode
// requires the same transport instance across every request of a session —
// a fresh instance rejects non-initialize requests (SDK validateSession:
// !initialized → 400 'Server not initialized'). POST and GET route through
// the STORED pair; onclose evicts the session.
// ---------------------------------------------------------------------------
async function createSessionPair(sessionId: string, agentSlug: string): Promise<void> {
  const client = gateway.getClient()

  const server = new Server(
    { name: `openhiveos-${agentSlug}`, version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    // S19-ARCH-01b: the discovery surface is now audited like invocations —
    // claim-provenance recording in tools/list is part of the Tier-3 scope.
    // No arguments to fingerprint; duration + response size + request id for
    // correlation; auth path is the resolved authStrength so every protocol
    // call is attributable.
    const start = Date.now()
    let success = true
    let errorClass: string | null = null
    let responseBytes: number | null = null
    try {
      const result = await client.listTools()
      responseBytes = JSON.stringify(result ?? {}).length
      return result
    } catch (err) {
      success = false
      errorClass = err instanceof Error ? err.constructor.name : 'UnknownError'
      throw err
    } finally {
      const requestIdRaw: unknown = (request as unknown as { id?: string | number }).id
      logToolInvocation(
        agentSlug,
        'tools/list',
        'streamable_http',
        Date.now() - start,
        success,
        errorClass,
        {
          sessionId: null,
          requestId: requestIdRaw !== undefined ? String(requestIdRaw) : null,
          arguments: null,
          responseBytes,
        },
        // R1: auth strength is per-session (registry map), refreshed per POST.
        { claimedPersona: null, authStrength: sessionAuthStrength.get(sessionId) ?? 'unverified' },
      )
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // ARCH-021: inject __agentSlug into _meta so the subprocess can resolve
    // identity per-call in GATEWAY_MODE without AGENT_TOKEN.
    // _meta is a protocol-level sideband — it is NOT subject to tool inputSchema
    // validation and will not be stripped by z.object() in the MCP SDK parse layer.
    //
    // S19-ARCH-01a/01b: buildProvenanceMeta assembles client _meta FIRST and
    // gateway claims LAST (client forgery always loses the merge).
    // S19-ARCH-01c: mint the step-up nonce — the subprocess echoes it back on
    // its elicitation so we can bind the prompt to THIS session.
    const rawArgs = (request.params.arguments ?? null) as Record<string, unknown> | null
    const claimedPersona = extractPersonaClaim(rawArgs)
    const stepUpNonce = request.params.name === 'update_task' ? sessions.mintNonce(sessionId, agentSlug) : null
    const augmentedParams = {
      ...request.params,
      // SDK type: arguments is object | undefined (never null)
      ...(rawArgs !== null ? { arguments: rawArgs } : {}),
      _meta: buildProvenanceMeta(request.params._meta, { claimedPersona, authStrength: sessionAuthStrength.get(sessionId) ?? 'unverified' }, agentSlug),
    }
    // R1: inject the step-up nonce AFTER provenance assembly (buildProvenance
    // Meta would not carry it). The subprocess echoes it back on its
    // elicitation so the relay can bind prompt → session (fail-closed).
    if (stepUpNonce !== null) {
      ;(augmentedParams._meta as Record<string, unknown>)['__stepUpNonce'] = stepUpNonce
    }

    // T1-2 + S16-DB-03: log tool invocation (fire-and-forget, enriched)
    const start = Date.now()
    let success = true
    let errorClass: string | null = null
    let responseBytes: number | null = null

    try {
      const result = await client.callTool(augmentedParams)
      responseBytes = JSON.stringify(result ?? {}).length
      return result
    } catch (err) {
      success = false
      errorClass = err instanceof Error ? err.constructor.name : 'UnknownError'
      throw err
    } finally {
      const durationMs = Date.now() - start
      const requestIdRaw: unknown = (request as unknown as { id?: string | number }).id
      logToolInvocation(
        agentSlug,
        request.params.name,
        'streamable_http',
        durationMs,
        success,
        errorClass,
        {
          sessionId,
          requestId: requestIdRaw !== undefined ? String(requestIdRaw) : null,
          arguments: rawArgs,
          responseBytes,
        },
        { claimedPersona, authStrength: sessionAuthStrength.get(sessionId) ?? 'unverified' },
      )
    }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transport = new (StreamableHTTPServerTransport as any)({
    sessionIdGenerator: () => sessionId,
    onsessioninitialized: (sid: string) => {
      void sid // registry session already created before connect
    },
  })
  transport.onclose = () => {
    sessions.end(sessionId)
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  await server.connect(transport)
  sessions.attachPair(sessionId, { server, transport })
}

// Auth strength for a stored session's callTool handler: captured at session
// creation (POST initialize) and refreshed on every authenticated POST for
// that session. Dev-flag sessions keep 'dev' stamped; bearer sessions update
// if the credential changes (rotation mid-session).
const sessionAuthStrength = new Map<string, IdentityAudit['authStrength']>()

// ---------------------------------------------------------------------------
// S19-ARCH-01c-R1 (FIND-1 fix): the step-up relay lives on the UPSTREAM
// client — elicitation/create flows SUBPROCESS → gateway client (the gateway
// is the subprocess's client). One handler serves ALL sessions: consume the
// nonce, route the prompt to the OWNING session's stored transport, stamp
// the operator label on accept. FAIL-CLOSED: unknown/expired/replayed nonce
// or dead session → decline (the subprocess treats that as a human "no").
// The gateway NEVER answers on the client's behalf; it only relays.
// ---------------------------------------------------------------------------
gateway.setElicitationRelay(async (request) => {
  // Route by NONCE ONLY. The subprocess's runStepUp echoes just __stepUpNonce
  // (it does not know the gateway's slug sideband) — and that is sufficient:
  // the nonce is 128-bit random, single-use (burn-on-any-attempt), 10-min
  // TTL, and the binding created at mint time DERIVES the owning {session,
  // agent}. The presenting agent is derived, not asserted — no spoofable
  // field in the loop.
  const nonce = (request.params?._meta as Record<string, unknown> | undefined)?.['__stepUpNonce']
  const bound = typeof nonce === 'string' ? sessions.consumeNonceByNonceOnly(nonce) : null
  if (!bound) return { action: 'decline' as const }

  const pair = sessions.getPair(bound.sessionId)
  if (!pair) return { action: 'decline' as const }

  try {
    // Forward via the SERVER's request() (Protocol API). Correlation lives on
    // the server, not the transport — and Protocol exposes request(), while
    // sendRequest() exists only on handler `extra`. relatedRequestId stays
    // unset: the elicitation is not tied to an inbound request on THIS
    // session, so the transport writes it to the standalone GET stream.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (pair.server as any).request(request, ElicitResultSchema, { timeout: 120_000 })
    if (result.action === 'accept') {
      // Stamp the operator label: the subprocess records it on the history
      // row (step_up_user). A LABEL for audit readability, not a control.
      result._meta = { ...(result._meta ?? {}), __stepUpUser: OPERATOR_LABEL }
    }
    return result
  } catch {
    // No GET stream / client went away / timeout → no human answered → decline.
    return { action: 'decline' as const }
  }
})

app.post('/mcp', mcpRateLimiter, resolveAgentFromBearer, express.json({ limit: '4mb' }), async (req: Request, res: Response) => {
  await gateway.waitUntilReady()

  // ARCH-021: agentSlug was resolved from the Bearer token by resolveAgentFromBearer.
  const agentSlug = res.locals['agentSlug'] as string
  // S19-ARCH-01a: auth path stamped by the same middleware — always present.
  const authStrength = (res.locals['authStrength'] as IdentityAudit['authStrength']) ?? 'unverified'

  // ---------------------------------------------------------------------------
  // S19-ARCH-01c: STATEFUL SESSIONS (ARCH-028 Decision 1).
  //   initialize → register session (+create pair), return Mcp-Session-Id.
  //   everything else → session header REQUIRED and must belong to the
  //   bearer-resolved agent (session-fixation guard).
  // ---------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bodyMethod = (req.body as any)?.method as string | undefined
  const isInitialize = bodyMethod === 'initialize'
  const presentedSessionId = req.headers['mcp-session-id']
  const presentedSession = typeof presentedSessionId === 'string' ? presentedSessionId : undefined

  if (isInitialize && presentedSession === undefined) {
    const session = sessions.register(agentSlug)
    sessionAuthStrength.set(session.sessionId, authStrength)
    await createSessionPair(session.sessionId, agentSlug)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await (sessions.getPair(session.sessionId)!.transport as any).handleRequest(req, res, req.body)
    return
  }

  if (presentedSession === undefined) {
    res.status(400).json({ error: 'Missing Mcp-Session-Id header. Initialize first.' })
    return
  }
  const session = sessions.assertSessionAccess(presentedSession, agentSlug)
  if (!session) {
    res.status(404).json({ error: 'Session not found. Re-initialize.' })
    return
  }
  sessionAuthStrength.set(session.sessionId, authStrength)
  const pair = sessions.getPair(session.sessionId)
  if (!pair) {
    res.status(404).json({ error: 'Session not found. Re-initialize.' })
    return
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await (pair.transport as any).handleRequest(req, res, req.body)
})

// ---------------------------------------------------------------------------
// GET /mcp — S19-ARCH-01c: open the session's SSE stream (server→client
// requests, i.e. elicitation delivery to VS Code). Requires a valid session
// bound to the bearer identity. Routes through the STORED per-session pair
// (FIND-2 fix — a fresh transport here would reject the stream request).
// Session-less GETs keep the legacy 405 (VS Code fallback probe).
// ---------------------------------------------------------------------------
app.get('/mcp', mcpRateLimiter, resolveAgentFromBearer, async (req: Request, res: Response) => {
  await gateway.waitUntilReady()

  const agentSlug = res.locals['agentSlug'] as string
  const presentedSessionId = req.headers['mcp-session-id']
  const sessionId = typeof presentedSessionId === 'string' ? presentedSessionId : undefined
  if (sessionId === undefined) {
    res.status(405).json({ error: 'SSE transport not supported without a session. Use POST /mcp (StreamableHTTP).' })
    return
  }
  const session = sessions.assertSessionAccess(sessionId, agentSlug)
  if (!session) {
    res.status(404).json({ error: 'Session not found. Re-initialize.' })
    return
  }
  const pair = sessions.getPair(session.sessionId)
  if (!pair) {
    res.status(404).json({ error: 'Session not found. Re-initialize.' })
    return
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await (pair.transport as any).handleRequest(req, res, req.body)
})

// ---------------------------------------------------------------------------
// DELETE /mcp — S19-ARCH-01c: client-initiated session termination.
// ---------------------------------------------------------------------------
app.delete('/mcp', mcpRateLimiter, resolveAgentFromBearer, async (req: Request, res: Response) => {
  const agentSlug = res.locals['agentSlug'] as string
  const presentedSessionId = req.headers['mcp-session-id']
  const sessionId = typeof presentedSessionId === 'string' ? presentedSessionId : undefined
  if (sessionId === undefined) {
    res.status(400).json({ error: 'Missing Mcp-Session-Id header.' })
    return
  }
  const session = sessions.assertSessionAccess(sessionId, agentSlug)
  if (!session) {
    res.status(404).json({ error: 'Session not found.' })
    return
  }
  sessions.end(sessionId)
  res.status(200).json({ status: 'session ended' })
})

// ---------------------------------------------------------------------------
// Session registry (one SSEServerTransport per active Bridge connection)
// ---------------------------------------------------------------------------

const transports = new Map<string, SSEServerTransport>()

// ---------------------------------------------------------------------------
// GET /sse — legacy SSE stream (openBridge / Telegram Bridge integrations)
// ---------------------------------------------------------------------------

app.get('/sse', sseRateLimiter, validateTokenQuery, async (req: Request, res: Response) => {
  // SEC-D8: block until subprocess is initialised and tool list is fetched.
  await gateway.waitUntilReady()

  const client = gateway.getClient()

  // ---------------------------------------------------------------------------
  // S19-ARCH-01e (#2778): OPTIONAL per-connection identity on the legacy /sse
  // handshake. ARCH-016 compatibility rule: the contract (GET /sse?token= +
  // POST /message?sessionId=, shared MCP_GATEWAY_TOKEN) is unchanged — agent
  // and persona query params are OPTIONAL and absent params behave exactly as
  // before (anonymous 'bridge' actor).
  //
  //   agent=<slug>    — resolved against the live agents table at handshake.
  //                     Unresolvable → connection proceeds ANONYMOUS (bridge
  //                     actor), never rejected: the shared token is the only
  //                     credential, so identity here grants no privilege —
  //                     it enriches the audit trail and the subprocess's
  //                     per-call context. Fail-open to label, fail-closed
  //                     to privilege.
  //   persona=<label> — claimed persona label (same spoofable-by-design
  //                     carve-out as the /mcp persona argument, ARCH-026).
  //
  // The binding lives for the life of the SSE connection and feeds BOTH the
  // tool_invocations identity columns AND the subprocess _meta injection —
  // closing the 'identity does not flow on /sse' gap end to end.
  // ---------------------------------------------------------------------------
  const rawAgent = req.query['agent']
  const rawPersona = req.query['persona']
  let sseAgent: string | null = null
  if (typeof rawAgent === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(rawAgent)) {
    try {
      const { rows } = await pool.query<{ slug: string }>(
        'SELECT slug FROM agents WHERE slug = $1 AND active = true LIMIT 1',
        [rawAgent],
      )
      if (rows.length > 0) sseAgent = rows[0]!.slug
    } catch {
      // DB hiccup → anonymous; never block the connection on identity.
    }
  }
  let ssePersona: string | null = null
  if (typeof rawPersona === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(rawPersona)) {
    ssePersona = rawPersona
  }
  if (rawAgent !== undefined && sseAgent === null) {
    console.warn(`[mcp-gateway] /sse handshake: agent='${String(rawAgent).slice(0, 40)}' not resolved — proceeding as anonymous bridge actor`)
  }

  // One Server instance per Bridge connection — proxies all tool calls upstream.
  const server = new Server(
    { name: 'mcp-gateway', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    // S19-ARCH-01b/01e: SSE discovery is audited too — shared_token strength,
    // bound handshake agent when provided (anonymous 'bridge' otherwise).
    // Same enrichment as the /mcp tools/list row.
    const start = Date.now()
    let success = true
    let errorClass: string | null = null
    let responseBytes: number | null = null
    try {
      const result = await client.listTools()
      responseBytes = JSON.stringify(result ?? {}).length
      return result
    } catch (err) {
      success = false
      errorClass = err instanceof Error ? err.constructor.name : 'UnknownError'
      throw err
    } finally {
      const requestIdRaw: unknown = (request as unknown as { id?: string | number }).id
      logToolInvocation(
        sseAgent ?? 'bridge',
        'tools/list',
        'sse',
        Date.now() - start,
        success,
        errorClass,
        {
          sessionId: null,
          requestId: requestIdRaw !== undefined ? String(requestIdRaw) : null,
          arguments: null,
          responseBytes,
        },
        { claimedPersona: ssePersona, authStrength: 'shared_token' },
      )
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // S19-ARCH-01e: identity now FLOWS on /sse. The handshake binding
    // (optional agent + persona) feeds both the audit row and the subprocess
    // _meta — the subprocess can resolve identity per-call on the Bridge path
    // exactly like /mcp (same sideband keys, same provenance model: the
    // gateway is the source, client input cannot forge it).
    const agentSlugForLogging = sseAgent ?? 'bridge'
    const start = Date.now()
    let success = true
    let errorClass: string | null = null

    // Inject identity into _meta (protocol sideband — same mechanism as /mcp).
    // Anonymous bridges keep the historical behavior: no _meta, subprocess
    // tools that require identity reject as before (fail-closed).
    const augmentedParams = sseAgent
      ? {
          ...request.params,
          _meta: {
            ...(request.params._meta ?? {}),
            __agentSlug: sseAgent,
            __claimedPersona: ssePersona,
            __authStrength: 'shared_token' as const,
          },
        }
      : request.params

    try {
      return await client.callTool(augmentedParams)
    } catch (err) {
      success = false
      errorClass = err instanceof Error ? err.constructor.name : 'UnknownError'
      throw err
    } finally {
      const durationMs = Date.now() - start
      // S19-ARCH-01a/01e: the shared /sse token is a single credential for
      // every integration — weaker than per-agent bearer, stamped as such.
      logToolInvocation(agentSlugForLogging, request.params.name, 'sse', durationMs, success, errorClass, undefined, {
        claimedPersona: ssePersona,
        authStrength: 'shared_token',
      })
    }
  })

  // S19-ARCH-01e: carry the shared token on the announced /message endpoint —
  // the SDK appends sessionId to this path, so SDK-based clients (which cannot
  // add query params to the POST themselves) authenticate /message without
  // any client change. The token is already known to the client (it just
  // passed ?token= on the handshake); this does not widen the surface.
  // SEC-D3: the token stays out of gateway logs (validateTokenQuery deletes
  // it from req.query before any logging path).
  const transport = new SSEServerTransport(`/message?token=${rawToken}`, res)
  const sessionId = transport.sessionId

  transports.set(sessionId, transport)

  res.on('close', () => {
    transports.delete(sessionId)
    console.log(`[mcp-gateway] SSE session closed: ${sessionId}`)
  })

  console.log(`[mcp-gateway] SSE session established: ${sessionId}`)
  await server.connect(transport)
})

// ---------------------------------------------------------------------------
// POST /message — receive messages from Bridge SSE client
// ---------------------------------------------------------------------------

app.post('/message', messageRateLimiter, validateTokenQuery, express.raw({ type: '*/*', limit: '1mb' }), async (req: Request, res: Response) => {
  const sessionId = req.query['sessionId']

  if (typeof sessionId !== 'string') {
    res.status(400).json({ error: 'Missing sessionId' })
    return
  }

  const transport = transports.get(sessionId)
  if (transport === undefined) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  // S19-ARCH-01e fix (pre-existing Sprint 6 bug surfaced by the 01e test):
  // express.raw() already consumed the request stream, so handlePostMessage's
  // internal getRawBody(req) hit 'stream is not readable' on every POST —
  // the legacy /sse path could never complete a real JSON-RPC call (consistent
  // with zero sse rows ever recorded in tool_invocations). Pass the body
  // through as PARSED JSON (parsedBody) — a raw Buffer would fail the
  // message schema on the other side.
  await transport.handlePostMessage(req, res, JSON.parse(req.body))
})

// ---------------------------------------------------------------------------
// Start
//
// SEC-D4: bind to loopback when running on host (default).
// When running inside Docker the host port mapping (127.0.0.1:PORT->PORT)
// enforces the loopback constraint at the Docker layer, so 0.0.0.0 is
// required inside the container for health checks and Compose routing.
// GATEWAY_BIND env var controls this: set to '0.0.0.0' in docker-compose.yml.
// ---------------------------------------------------------------------------

const BIND_HOST = process.env['GATEWAY_BIND'] ?? '127.0.0.1'

app.listen(PORT, BIND_HOST, () => {
  console.log(`[mcp-gateway] Listening on ${BIND_HOST}:${PORT} — /mcp (StreamableHTTP) + /sse (legacy SSE)`)
})
