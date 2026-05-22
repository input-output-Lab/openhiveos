/**
 * packages/mcp-gateway/src/gateway.ts
 *
 * Manages the MCP subprocess lifecycle (StdioClientTransport) and
 * exposes the upstream MCP client to the SSE layer.
 *
 * SEC-D7: HEALTH_PORT injected into subprocess env at spawn time.
 * SEC-D8: readyPromise resolves only after listTools() succeeds —
 *         the SSE endpoint blocks until this promise resolves.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

export class Gateway {
  private readonly client: Client
  private readonly readyPromise: Promise<void>
  private resolveReady!: () => void
  private rejectReady!: (err: Error) => void
  private readyState = false

  constructor() {
    this.client = new Client({ name: 'mcp-gateway', version: '1.0.0' })
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = () => { this.readyState = true; resolve() }
      this.rejectReady = reject
    })
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
