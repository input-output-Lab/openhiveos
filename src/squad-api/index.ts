// Squad API entry point — ARCH-012
// Runs as a separate process from the MCP server (distinct stdio vs HTTP boundary).
// Config validation fires immediately on import.
import './config.js'
import { squadApiConfig } from './config.js'
import { createSquadApiApp } from './server.js'
import { pool } from '../db/client.js'
import { startSyncWorker } from '../workers/index.js'

const app = createSquadApiApp()

// SEC-A3: bind to 127.0.0.1 by default.
// Set SQUAD_API_HOST=0.0.0.0 only when behind a reverse proxy with TLS.
const host = process.env['SQUAD_API_HOST'] ?? '127.0.0.1'
const port = squadApiConfig.SQUAD_API_PORT

// Start SyncWorker background process (ARCH-024).
// Uses the main database pool with write permissions for outbound task syncing.
// Gracefully shuts down on SIGTERM (handled by worker).
startSyncWorker(pool)

app.listen(port, host, () => {
  console.error(`[squad-api] Listening on http://${host}:${String(port)}`)
})
