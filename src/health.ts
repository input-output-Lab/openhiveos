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
//
// S2-08 (ARCH-008 addendum): the {agents} field was stripped from this
// response. Squad composition is internal information — exposing agent slugs
// on an unauthenticated endpoint is a reconnaissance vector if HEALTH_PORT
// is ever published externally. The health probe needs {status} and {db}
// only. Locksmith reviewed and accepted this resolution (S2-02).
// ---------------------------------------------------------------------------

interface HealthPayload {
  status: 'ok' | 'degraded'
  version: string
  squad: string
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
