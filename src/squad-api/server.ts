import express from 'express'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { squadApiRateLimit } from './middleware/rate-limit.js'
import { ingestionRateLimit } from './middleware/ingestion-rate-limit.js'
import { authMiddleware } from './middleware/auth.js'
import { ingestionAuthMiddleware } from './middleware/ingestion-auth.js'
import { ethosSealRouter } from './routes/ethos-seal.js'
import { agentsRouter } from './routes/agents.js'
import { healthRouter } from './routes/health.js'
import { internalRouter } from './routes/internal.js'
import { usageRouter } from './routes/usage.js'
import { sopsRouter } from './routes/sops.js'
import { tasksRouter } from './routes/tasks.js'
import { projectsRouter } from './routes/projects.js'
import { thoughtsRouter } from './routes/thoughts.js'
import { integrationsRouter } from '../routes/integrations.js'
import { webhooksRouter } from '../routes/webhooks.js'
import { githubWebhookRouter } from '../routes/webhooks-github.js'
import { oneRouter } from './routes/one.js'

// ---------------------------------------------------------------------------
// Squad API — Express 5 application factory (ARCH-012, ARCH-015, ARCH-024)
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

  // ---------------------------------------------------------------------------
  // /webhooks/* — inbound integration webhooks (ARCH-024)
  // CRITICAL (SEC-C1): express.raw() MUST run BEFORE express.json().
  // Raw body buffer is required for HMAC signature verification.
  // Mounted BEFORE all other routes (including /internal and /api).
  // Separate 200 req/min rate limiter (SEC-C2), no auth middleware.
  // ---------------------------------------------------------------------------
  app.use(
    '/webhooks',
    express.raw({ type: 'application/json' }),
    (req, _res, next) => {
      // Capture raw body on request object for HMAC verification in webhook handlers
      (req as { rawBody?: Buffer }).rawBody = req.body as Buffer
      next()
    },
    webhooksRouter,
    githubWebhookRouter,
  )

  // Parse JSON request bodies — before all other route handlers (except /webhooks)
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
  // Full DB + schema check. See src/squad-api/routes/health.ts.
  app.use('/health', healthRouter)

  // GET /api/ethos-seal — metadata; GET /api/ethos-seal?include=payload — full
  // SEC-B7 (ARCH-013): payload gated; auth enforced upstream by authMiddleware
  app.use('/api/ethos-seal', ethosSealRouter)

  // GET /api/agents — provisioned agent roster (ARCH-014 C7)
  // Auth enforced upstream by authMiddleware on /api/*.
  // Excludes all token columns — slug, display_name, active, timestamps only (SEC-A6).
  app.use('/api/agents', agentsRouter)

  // GET /api/sops — SOP roster, paginated (ARCH-019 S9-BE-03)
  // Auth enforced upstream by authMiddleware on /api/*.
  // embedding excluded; instruction truncated to 200-char preview (SEC-B1 principle).
  // VALID_CATEGORIES allowlist enforced in handler (SEC-C7).
  app.use('/api/sops', sopsRouter)

  // GET /api/tasks — task roster, paginated (ARCH-019 S9-BE-01)
  // GET /api/tasks/:id — task detail with description (ARCH-019 S10-BE-04)
  // Auth enforced upstream by authMiddleware on /api/*.
  // LEFT JOIN projects for project_slug — avoids extra round-trips in InboxView.
  // VALID_TASK_STATUSES allowlist enforced in handler (SEC-C3).
  app.use('/api/tasks', tasksRouter)

  // GET /api/projects — project roster, paginated (ARCH-019 S10-BE-01)
  // GET /api/projects/:slug — project detail with open_task_count + current_sprint (S10-BE-02)
  // GET /api/projects/:slug/sprints — sprint history, paginated (S10-BE-03)
  // Auth enforced upstream by authMiddleware on /api/*.
  // VALID_PROJECT_STATUSES allowlist enforced in handler (SEC-C3).
  // OPEN_TASK_STATUSES allowlist enforced in handler (SEC-C6).
  app.use('/api/projects', projectsRouter)

  // GET /api/thoughts — thought roster, paginated (ARCH-019 S9-BE-04)
  // Auth enforced upstream by authMiddleware on /api/*.
  // SEC-B1, SEC-B3: embedding, raw_behavior, expressed_behavior, disposition_snapshot excluded.
  // VALID_THOUGHT_TYPES allowlist enforced in handler (SEC-C3).
  app.use('/api/thoughts', thoughtsRouter)

  // GET /api/usage/* — LLM cost analytics (ARCH-015)
  // Auth enforced upstream by authMiddleware on /api/*.
  // Queries run via withReaderRole() — SELECT-only (SEC-A5).
  app.use('/api/usage', usageRouter)

  // GET /api/integrations/status — Integration health status (ARCH-024)
  // Auth enforced upstream by authMiddleware on /api/*.
  // Read-only query via withReaderRole() — no secrets exposed (SEC-A5, SEC-B1).
  app.use('/api/integrations', integrationsRouter)

  // GET  /api/one/protocols     — The One's canonical SOPs (ARCH-025)
  // POST /api/one/validate-agent — Agent .md compliance check (ARCH-025)
  // POST /api/one/emanate        — Agent scaffold stub (ARCH-025)
  // Auth enforced upstream by authMiddleware on /api/*.
  app.use('/api/one', oneRouter)

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
  //
  // Note: bare `*` is invalid in path-to-regexp v8 (Express 5). Use `/{*path}`
  // which matches root and all sub-paths with a named wildcard parameter.
  // ---------------------------------------------------------------------------
  app.get('/{*path}', (_req, res) => {
    res.sendFile(join(dashboardPath, 'index.html'), (err: unknown) => {
      if (err) {
        res.status(404).send('Dashboard not built. Run: npm run build:all')
      }
    })
  })

  return app
}
