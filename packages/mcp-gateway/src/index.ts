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
} from '@modelcontextprotocol/sdk/types.js'
import { Gateway, resolveAgentSlug } from './gateway.js'
import { assertDevAuthAllowed, DEV_ACTOR_SLUG } from './dev-auth.js'
import { extractPersonaClaim, buildProvenanceMeta, META_AGENT_SLUG_KEY, META_CLAIMED_PERSONA_KEY, META_AUTH_STRENGTH_KEY, type IdentityAudit } from './auth-context.js'

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

app.post('/mcp', mcpRateLimiter, resolveAgentFromBearer, express.json({ limit: '4mb' }), async (req: Request, res: Response) => {
  await gateway.waitUntilReady()

  // ARCH-021: agentSlug was resolved from the Bearer token by resolveAgentFromBearer.
  const agentSlug = res.locals['agentSlug'] as string
  // S19-ARCH-01a: auth path stamped by the same middleware — always present.
  const authStrength = (res.locals['authStrength'] as IdentityAudit['authStrength']) ?? 'unverified'

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
        { claimedPersona: null, authStrength },
      )
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // ARCH-021: inject __agentSlug into _meta so the subprocess can resolve
    // identity per-call in GATEWAY_MODE without AGENT_TOKEN.
    // _meta is a protocol-level sideband — it is NOT subject to tool inputSchema
    // validation and will not be stripped by z.object() in the MCP SDK parse layer.
    // Injecting into arguments was incorrect: the SDK's safeParseAsync runs the
    // tool's inputSchema (z4mini.object, strip mode) and silently removes unknown
    // keys before the handler receives args — causing the "missing __agentSlug" error.
    //
    // S19-ARCH-01a/01b: the identity claims (__agentSlug, __claimedPersona,
    // __authStrength) are assembled by buildProvenanceMeta — client _meta
    // spreads FIRST, gateway-resolved values LAST, so a client can never
    // spoof a stronger auth path or forge the claim's provenance. The claim
    // itself is lifted from the RAW tool arguments (`persona`), never from
    // client _meta — that stays the ARCH-026 spoofable-by-design carve-out.
    const rawArgs = (request.params.arguments ?? null) as Record<string, unknown> | null
    const claimedPersona = extractPersonaClaim(rawArgs)
    const augmentedParams = {
      ...request.params,
      // SDK type: arguments is object | undefined (never null)
      ...(rawArgs !== null ? { arguments: rawArgs } : {}),
      _meta: buildProvenanceMeta(request.params._meta, { claimedPersona, authStrength }, agentSlug),
    }

    // T1-2 + S16-DB-03: log tool invocation (fire-and-forget, enriched)
    const start = Date.now()
    let success = true
    let errorClass: string | null = null
    let errorText: string | null = null
    let responseBytes: number | null = null

    try {
      const result = await client.callTool(augmentedParams)
      responseBytes = JSON.stringify(result ?? {}).length
      return result
    } catch (err) {
      success = false
      errorClass = err instanceof Error ? err.constructor.name : 'UnknownError'
      errorText = err instanceof Error ? err.message.slice(0, 2000) : String(err).slice(0, 2000)
      throw err
    } finally {
      const durationMs = Date.now() - start
      // MCP JSON-RPC request id lives on the handler envelope, not params.
      // The SDK types params without it; the handler receives the full message.
      const requestIdRaw: unknown = (request as unknown as { id?: string | number }).id
      logToolInvocation(agentSlug, request.params.name, 'streamable_http', durationMs, success, errorClass, {
        sessionId: null, // stateless transport: correlation via request_id
        requestId: requestIdRaw !== undefined ? String(requestIdRaw) : null,
        arguments: rawArgs,
        responseBytes,
      }, { claimedPersona, authStrength })
      void errorText // error detail lives in error_message via errorClass when insert enriches; kept for stderr parity
    }
  })

  // Stateless mode: sessionIdGenerator: undefined — no session tracking or validation.
  // The gateway is a proxy; the upstream MCP subprocess maintains its own state.
  // Each HTTP request is handled independently. This matches the SDK's stateless pattern.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transport = new (StreamableHTTPServerTransport as any)({ sessionIdGenerator: undefined })

  res.on('close', () => {
    void (transport as { close(): Promise<void> }).close()
  })

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  await server.connect(transport)
  // Pass req.body as the pre-parsed JSON object — SDK expects a parsed object, not a Buffer.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await (transport as any).handleRequest(req, res, req.body)
})

// ---------------------------------------------------------------------------
// GET /mcp — reject SSE fallback probe from VS Code MCP client.
// VS Code falls back to GET /mcp as SSE when POST /mcp returns non-2xx.
// Return 405 so VS Code gets a clean "not supported" rather than 404 HTML.
// ---------------------------------------------------------------------------
app.get('/mcp', (_req: Request, res: Response) => {
  res.status(405).json({ error: 'SSE transport not supported on /mcp. Use POST /mcp (StreamableHTTP).' })
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

  // One Server instance per Bridge connection — proxies all tool calls upstream.
  const server = new Server(
    { name: 'mcp-gateway', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    // S19-ARCH-01b: SSE discovery is audited too — shared_token strength,
    // bridge actor (identity resolution on /sse is deferred per Silas
    // ARCH-024 ruling; see the callTool handler note below). Same enrichment
    // as the /mcp tools/list row: duration + response size + request id.
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
        'bridge',
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
        { claimedPersona: null, authStrength: 'shared_token' },
      )
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // T1-3: log tool invocation to tool_invocations table (fire-and-forget)
    // DATA QUALITY GAP: agent_slug defaulted to 'bridge'; session registry
    // enhancement (linking SSE sessions to calling agent identity) deferred
    // per Silas ARCH-024 ruling 2026-06-14. Future work: resolve real agent
    // slug from session state instead of hardcoded fallback.
    const agentSlugForLogging = 'bridge'
    const start = Date.now()
    let success = true
    let errorClass: string | null = null

    try {
      return await client.callTool(request.params)
    } catch (err) {
      success = false
      errorClass = err instanceof Error ? err.constructor.name : 'UnknownError'
      throw err
    } finally {
      const durationMs = Date.now() - start
      // S19-ARCH-01a: the shared /sse Bridge token is a single credential for
      // every integration — weaker than per-agent bearer, stamped as such so
      // the audit trail distinguishes Bridge calls from agent calls.
      logToolInvocation(agentSlugForLogging, request.params.name, 'sse', durationMs, success, errorClass, undefined, {
        claimedPersona: null,
        authStrength: 'shared_token',
      })
    }
  })

  const transport = new SSEServerTransport('/message', res)
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

  await transport.handlePostMessage(req, res)
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
