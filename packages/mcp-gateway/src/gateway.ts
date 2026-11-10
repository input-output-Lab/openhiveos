/**
 * packages/mcp-gateway/src/gateway.ts
 *
 * Manages the MCP subprocess lifecycle (StdioClientTransport) and
 * exposes the upstream MCP client to the SSE layer.
 *
 * SEC-D7: HEALTH_PORT injected into subprocess env at spawn time.
 * SEC-D8: readyPromise resolves only after listTools() succeeds —
 *         the SSE endpoint blocks until this promise resolves.
 *
 * ARCH-021 (per-request identity): Gateway resolves agentSlug from the
 * caller's Bearer token via DB lookup and injects it into every callTool()
 * call as __agentSlug. The subprocess reads it per-call in GATEWAY_MODE.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { Pool } from 'pg'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'

// ---------------------------------------------------------------------------
// Per-request agent identity resolution — ARCH-021
//
// Same hash algorithm as src/auth/identity.ts:
//   Token format: <32-hex-salt>.<64-hex-secret>
//   Hash: SHA-256(salt + secret) → compare against agents.token_hash
// ---------------------------------------------------------------------------

const ALLOWED_TOKEN_COLUMNS = new Set(['token_hash', 'previous_token_hash'])

function parseToken(raw: string): { salt: string; secret: string } | null {
  const dot = raw.indexOf('.')
  if (dot === -1) return null
  const salt = raw.slice(0, dot)
  const secret = raw.slice(dot + 1)
  if (salt.length !== 32 || secret.length !== 64) return null
  if (!/^[\da-f]+$/i.test(salt) || !/^[\da-f]+$/i.test(secret)) return null
  return { salt, secret }
}

function computeHash(salt: string, secret: string): string {
  return createHash('sha256').update(salt + secret).digest('hex')
}

interface AgentRow {
  slug: string
  token_hash: string
  previous_token_hash: string | null
  active: boolean
  expires_at: Date | null
}

async function lookupAgent(
  pool: Pool,
  hashHex: string,
  column: 'token_hash' | 'previous_token_hash',
): Promise<AgentRow | null> {
  if (!ALLOWED_TOKEN_COLUMNS.has(column)) return null
  const gracePeriodClause =
    column === 'previous_token_hash' ? 'AND previous_token_expires_at > NOW()' : ''
  const { rows } = await pool.query<AgentRow>(
    `SELECT slug, token_hash, previous_token_hash, active, expires_at
       FROM agents
      WHERE ${column} = $1
        AND active = true
        ${gracePeriodClause}
      LIMIT 1`,
    [hashHex],
  )
  return rows[0] ?? null
}

/**
 * resolveAgentSlug — resolves the agent slug from a raw Bearer token value.
 * Returns the slug string or null if the token is invalid/unrecognised.
 * SEC-D11: updates last_used_at fire-and-forget (non-blocking).
 */
export async function resolveAgentSlug(pool: Pool, rawToken: string): Promise<string | null> {
  const parsed = parseToken(rawToken)
  if (!parsed) return null

  const hashHex = computeHash(parsed.salt, parsed.secret)
  const candidateHashBuf = Buffer.from(hashHex, 'hex')

  let row = await lookupAgent(pool, hashHex, 'token_hash')
  let usingGracePeriod = false

  if (!row) {
    row = await lookupAgent(pool, hashHex, 'previous_token_hash')
    usingGracePeriod = true
  }

  if (!row) return null

  // Defence-in-depth: constant-time comparison after indexed lookup
  const matchedHashHex = usingGracePeriod ? row.previous_token_hash : row.token_hash
  if (!matchedHashHex) return null

  const storedBuf = Buffer.from(matchedHashHex, 'hex')
  if (
    candidateHashBuf.byteLength !== storedBuf.byteLength ||
    !timingSafeEqual(candidateHashBuf, storedBuf)
  ) {
    return null
  }

  // Token expiry
  if (row.expires_at !== null && row.expires_at <= new Date()) return null

  // Update last_used_at — fire and forget
  void pool
    .query('UPDATE agents SET last_used_at = NOW() WHERE slug = $1', [row.slug])
    .catch(() => { /* non-fatal */ })

  return row.slug
}

export class Gateway {
  private readonly client: Client
  private readonly readyPromise: Promise<void>
  private resolveReady!: () => void
  private rejectReady!: (err: Error) => void
  private readyState = false

  constructor() {
    // S19-ARCH-01c-R1 (FIND-1 fix): elicitation/create flows SUBPROCESS → THIS
    // client (the gateway is the subprocess's client). Without declaring the
    // elicitation capability the SDK's form-mode guard rejects every request
    // before any handler runs — the capability declaration is not optional.
    // The relay handler itself is injected via setElicitationRelay() (index.ts
    // owns the session registry).
    this.client = new Client(
      { name: 'mcp-gateway', version: '1.0.0' },
      { capabilities: { elicitation: { form: {} } } },
    )
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = () => { this.readyState = true; resolve() }
      this.rejectReady = reject
    })
  }

  /**
   * Register the step-up relay on the upstream client. Called once at boot
   * from index.ts AFTER the session registry exists. The handler receives
   * the raw elicitation request; its return value goes back to the
   * subprocess (ElicitResult shape enforced by the SDK).
   */
  setElicitationRelay(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (request: any) => Promise<any>,
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.client.setRequestHandler(ElicitRequestSchema, handler as any)
  }

  async start(): Promise<void> {
    await this.spawnAndConnect()
  }

  /** Resolves when the subprocess is up and tool list has been fetched (SEC-D8). */
  waitUntilReady(): Promise<void> {
    return this.readyPromise
  }

  /** True once listTools() has succeeded. Used by the /health endpoint. */
  isReady(): boolean {
    return this.readyState
  }

  getClient(): Client {
    return this.client
  }

  private async spawnAndConnect(): Promise<void> {
    // SEC-D7: HEALTH_PORT must differ from the standalone mcp container (default 3007).
    const healthPort = process.env['HEALTH_PORT'] ?? '3007'

    // MCP_BINARY_PATH: path to the MCP server binary spawned as a subprocess.
    // Defaults to dist/index.js (relative, for local dev). Set to an absolute
    // path in Compose via volume mount (e.g. /mcp-server/index.js).
    const mcpBinaryPath = process.env['MCP_BINARY_PATH'] ?? 'dist/index.js'

    const transport = new StdioClientTransport({
      command: 'node',
      args: [mcpBinaryPath],
      env: {
        ...process.env as Record<string, string>,
        HEALTH_PORT: healthPort,
        // ARCH-021: signal to the subprocess that identity comes per-call
        // via __agentSlug injected in callTool() arguments, not AGENT_TOKEN.
        GATEWAY_MODE: 'true',
      },
    })

    transport.onclose = () => {
      console.error('[mcp-gateway] MCP subprocess closed unexpectedly')
    }

    transport.onerror = (err: Error) => {
      console.error('[mcp-gateway] MCP subprocess transport error:', err.message)
    }

    try {
      await this.client.connect(transport)

      // SEC-D8: fetch tool list to confirm subprocess is fully initialised.
      // SSE connections are gated behind waitUntilReady() — no tools served
      // until this call succeeds.
      await this.client.listTools()

      this.resolveReady()
      console.log('[mcp-gateway] Subprocess ready — SSE endpoint open')
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.rejectReady(error)
      throw error
    }
  }
}
