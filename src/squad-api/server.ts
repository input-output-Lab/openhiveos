import express from 'express'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { squadApiRateLimit } from './middleware/rate-limit.js'
import { ingestionRateLimit } from './middleware/ingestion-rate-limit.js'
import { authMiddleware } from './middleware/auth.js'
import { ingestionAuthMiddleware } from './middleware/ingestion-auth.js'
import { ethosSealRouter } from './routes/ethos-seal.js'
import { agentsRouter } from './routes/agents.js'
import { internalRouter } from './routes/internal.js'
import { usageRouter } from './routes/usage.js'

// ---------------------------------------------------------------------------
// Squad API — Express 5 application factory (ARCH-012, ARCH-015)
//
// Port:    3005 (SQUAD_API_PORT env — default from config)
// Binding: 127.0.0.1 by default (SEC-A3 — 0.0.0.0 requires reverse proxy + TLS)
// DB role: openhiveos_reader via withReaderRole() on all read queries (SEC-A5)
//
// Middleware stacks:
//   /api/*      — dashboard routes
//     1. squadApiRateLimit (SEC-A4 — 20 req/min)
//     2. authMiddleware (agent bearer token — agents table, reader role)
//   /internal/* — ingestion routes (ARCH-015)
//     1. ingestionRateLimit (SEC-C3 — 60 req/min, separate from dashboard)
//     2. ingestionAuthMiddleware (OPENHIVEOS_INGESTION_TOKEN — SEC-C1, SEC-C2)
//
// Static dashboard (ARCH-012 A6):
//   Built output of packages/dashboard/ → dist/dashboard/.
//   Served unauthenticated (assets are public; auth is enforced on /api/* data).
//   SPA fallback serves dist/dashboard/index.html for any unmatched GET.
//   Mounted AFTER /api and /internal so API routes are never shadowed.
//
// Routes:
//   GET  /                            — SPA (dashboard index.html via express.static)
//   GET  /health                      — unauthenticated health probe
//   GET  /api/ethos-seal[?include=]   — ARCH-013 SEC-B7
//   GET  /api/usage/agents            — ARCH-015: all agents monthly cost
//   GET  /api/usage/agents/:name      — ARCH-015: single agent cost detail
//   GET  /api/usage/tasks/:id         — ARCH-015: task cost breakdown
//   POST /internal/usage              — ARCH-015: Bridge ingestion endpoint
// ---------------------------------------------------------------------------

// Resolve dist/dashboard/ from this file's compiled location.
// src/squad-api/server.ts → compiled to dist/squad-api/server.js
// ../../dist/dashboard from dist/squad-api/ = {project root}/dist/dashboard ✓
// Same resolution works under tsx (source-mode) because import.meta.url points
// to src/squad-api/server.ts and ../../dist/dashboard is still the same path.
const dashboardPath = fileURLToPath(new URL('../../dist/dashboard', import.meta.url))

export function createSquadApiApp(): express.Application {
  const app = express()

  // Parse JSON request bodies — before all route handlers
  app.use(express.json())

  // ---------------------------------------------------------------------------
  // Dashboard static assets (ARCH-012 A6)
  // Served BEFORE /api and /internal so the router never inspects asset requests.
  // No auth — static files are public bundles; API data is protected separately.
  // express.static passes through (calls next()) when a file is not found,
  // so client-side routes (/agents, /usage) fall through to the SPA fallback below.
  // ---------------------------------------------------------------------------
  app.use(express.static(dashboardPath))

  // ---------------------------------------------------------------------------
  // /internal/* — Bridge ingestion (ARCH-015)
  // Rate-limited at 60 req/min (SEC-C3), separate from dashboard limit.
  // Authenticated by OPENHIVEOS_INGESTION_TOKEN (SEC-C1, SEC-C2, SEC-C8).
  // Mounted BEFORE /api so ingestion auth does not pass through authMiddleware.
  // ---------------------------------------------------------------------------
  app.use('/internal', ingestionRateLimit, ingestionAuthMiddleware, internalRouter)

  // ---------------------------------------------------------------------------
  // /api/* — dashboard routes
  // Rate-limited at 20 req/min (SEC-A4), then agent bearer token auth.
  // ---------------------------------------------------------------------------
  app.use('/api', squadApiRateLimit)
  app.use('/api', authMiddleware)

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  // GET /health — unauthenticated, no rate limit (health probe pattern)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'squad-api' })
  })

  // GET /api/ethos-seal — metadata; GET /api/ethos-seal?include=payload — full
  // SEC-B7 (ARCH-013): payload gated; auth enforced upstream by authMiddleware
  app.use('/api/ethos-seal', ethosSealRouter)

  // GET /api/agents — provisioned agent roster (ARCH-014 C7)
  // Auth enforced upstream by authMiddleware on /api/*.
  // Excludes all token columns — slug, display_name, active, timestamps only (SEC-A6).
  app.use('/api/agents', agentsRouter)

  // GET /api/usage/* — LLM cost analytics (ARCH-015)
  // Auth enforced upstream by authMiddleware on /api/*.
  // Queries run via withReaderRole() — SELECT-only (SEC-A5).
  app.use('/api/usage', usageRouter)

  // ---------------------------------------------------------------------------
  // /api/* 404 — must come after all /api routes so unmatched API paths return
  // JSON rather than falling through to the SPA fallback below.
  // ---------------------------------------------------------------------------
  app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found.' } })
  })

  // ---------------------------------------------------------------------------
  // SPA fallback (ARCH-012 A6)
  // Serves dist/dashboard/index.html for any GET request that didn't match a
  // static file or an API/internal route above.
  // This handles client-side routes: /, /agents, /usage, etc.
  // Falls back to a plain-text 404 if the dashboard has not been built yet.
  // ---------------------------------------------------------------------------
  app.get('*', (_req, res) => {
    res.sendFile(join(dashboardPath, 'index.html'), (err: Error | undefined) => {
      if (err) {
        res.status(404).send('Dashboard not built. Run: npm run build:all')
      }
    })
  })

  return app
}
