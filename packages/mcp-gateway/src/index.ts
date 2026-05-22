/**
 * packages/mcp-gateway/src/index.ts
 *
 * OpenHiveOS mcp-gateway — Express SSE bridge.
 *
 * Exposes the MCP server subprocess as an SSE endpoint for external
 * Bridge integrations (e.g. nova-telegram-bridge, openBridge).
 *
 * SEC-D1/D2: MCP_GATEWAY_TOKEN auth via ?token= query param, timingSafeEqual.
 * SEC-D3 [CRITICAL]: token is redacted from URL before any log line is written.
 * SEC-D4: binds to 127.0.0.1 only — never 0.0.0.0.
 * SEC-D7: HEALTH_PORT injected into subprocess env (handled in gateway.ts).
 * SEC-D8: SSE connections block until subprocess is ready (gateway.waitUntilReady).
 * SEC-D9: Rate limit SSE attempts — 10/min per IP, 429 + Retry-After.
 * SEC-D10: only gateway-scoped env vars consumed here.
 */
import express, { type Request, type Response, type NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import { timingSafeEqual } from 'crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { Gateway } from './gateway.js'

// ---------------------------------------------------------------------------
// Boot-time validation (SEC-D2, SEC-D10)
// ---------------------------------------------------------------------------

const rawToken = process.env['MCP_GATEWAY_TOKEN']
if (!rawToken || rawToken.length < 64) {
  console.error(
    '[mcp-gateway] FATAL: MCP_GATEWAY_TOKEN must be set and at least 64 hex characters (32 bytes CSPRNG)',
  )
  process.exit(1)
}
const TOKEN_BUF = Buffer.from(rawToken, 'utf8')

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

/**
 * SEC-D1/D2/D3: validates ?token= with constant-time comparison.
 *
 * The token is extracted and deleted from req.query BEFORE any log output.
 * Express does not log queries by default, but this guard makes the redaction
 * explicit and safe regardless of any logging middleware added in future.
 */
function validateToken(req: Request, res: Response, next: NextFunction): void {
  // SEC-D3: extract and immediately delete from query object before any logging.
  const provided = req.query['token']
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete req.query['token']

  if (typeof provided !== 'string') {
    res.status(401).json({ error: 'Missing authentication token' })
    return
  }

  const providedBuf = Buffer.from(provided, 'utf8')

  // Constant-time comparison (SEC-D2). Lengths must match first to avoid
  // a timing side-channel on the timingSafeEqual call itself.
  if (
    providedBuf.length !== TOKEN_BUF.length ||
    !timingSafeEqual(providedBuf, TOKEN_BUF)
  ) {
    res.status(401).json({ error: 'Invalid authentication token' })
    return
  }

  next()
}

// ---------------------------------------------------------------------------
// Session registry (one SSEServerTransport per active Bridge connection)
// ---------------------------------------------------------------------------

const transports = new Map<string, SSEServerTransport>()

// ---------------------------------------------------------------------------
// GET /sse — establish SSE stream
// ---------------------------------------------------------------------------

app.get('/sse', sseRateLimiter, validateToken, async (req: Request, res: Response) => {
  // SEC-D8: block until subprocess is initialised and tool list is fetched.
  await gateway.waitUntilReady()

  const client = gateway.getClient()

  // One Server instance per Bridge connection — proxies all tool calls upstream.
  const server = new Server(
    { name: 'mcp-gateway', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return client.listTools()
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return client.callTool(request.params)
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

app.post('/message', messageRateLimiter, validateToken, express.raw({ type: '*/*', limit: '1mb' }), async (req: Request, res: Response) => {
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
// Start — bind to loopback only (SEC-D4)
// ---------------------------------------------------------------------------

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[mcp-gateway] SSE endpoint listening on 127.0.0.1:${PORT}`)
})
