import { createServer } from 'node:http'
import { config } from './config.js'
import { pool } from './db/client.js'
import { manifest } from './squad/manifest.js'

// ---------------------------------------------------------------------------
// Health server
//
// A minimal HTTP server that runs alongside the MCP stdio transport.
// Exposes GET /health for Docker health checks and external monitoring.
//
// Port: HEALTH_PORT env var (default 3000)
// ---------------------------------------------------------------------------

interface HealthPayload {
  status: 'ok' | 'degraded'
  version: string
  squad: string
  agents: string[]
  db: 'connected' | 'error'
  error?: string
}

export function startHealthServer(): void {
  const server = createServer((_req, res) => {
    pool
      .query('SELECT 1')
      .then(() => {
        const payload: HealthPayload = {
          status: 'ok',
          version: '0.1.0',
          squad: manifest.squad,
          agents: manifest.agents.map((a) => a.slug),
          db: 'connected',
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
      })
      .catch((err: unknown) => {
        const payload: HealthPayload = {
          status: 'degraded',
          version: '0.1.0',
          squad: manifest.squad,
          agents: manifest.agents.map((a) => a.slug),
          db: 'error',
          error: err instanceof Error ? err.message : 'unknown error',
        }
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
      })
  })

  server.listen(config.HEALTH_PORT, () => {
    console.log(`[health] Listening on port ${String(config.HEALTH_PORT)}`)
  })
}
