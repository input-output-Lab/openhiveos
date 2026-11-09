import { Router } from 'express'
import type { Request, Response } from 'express'
import { squadApiPool } from '../db.js'
import {
  verifyDashboardPassword,
  createDashboardSession,
  resolveDashboardSession,
  destroyDashboardSession,
  parseSessionCookie,
  buildSessionCookie,
  buildClearSessionCookie,
  SESSION_COOKIE_NAME,
} from '../auth/dashboard-session.js'

// ---------------------------------------------------------------------------
// /api/auth — dashboard human login (S18-SEC-03, #2642)
//
// Mounted BEFORE authMiddleware so these routes are reachable without a
// bearer token. The dashboard is not deployed publicly yet; when it is,
// this is the only way a browser obtains API access — no baked token.
//
//   POST /api/auth/login    { password } → Set-Cookie oh_session=…; 204
//   GET  /api/auth/session  → 200 { principal, expiresAt } | 401
//   POST /api/auth/logout   → clears cookie + deletes row; 204
//
// DASHBOARD_PASSWORD unset ⇒ 503 Service Unavailable on login (feature
// off), bearer-only API behavior preserved.
// ---------------------------------------------------------------------------

export const authRouter = Router()

const isProduction = process.env['NODE_ENV'] === 'production'

authRouter.post('/login', async (req: Request, res: Response) => {
  const envPassword = process.env['DASHBOARD_PASSWORD']

  if (!envPassword) {
    res.status(503).json({
      error: 'dashboard_auth_disabled',
      message: 'Dashboard login is not configured on this deployment.',
    })
    return
  }

  const body = req.body as { password?: unknown } | undefined
  const password = typeof body?.password === 'string' ? body.password : undefined

  if (!password || !verifyDashboardPassword(password, envPassword)) {
    // Opaque 401 — never reveal whether the password exists (SEC-A6 spirit).
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  // exactOptionalPropertyTypes: only include the key when defined.
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
  const session = await createDashboardSession(squadApiPool, userAgent ? { userAgent } : {})

  res.setHeader('Set-Cookie', buildSessionCookie(session.token, session.expiresAt, isProduction))
  res.status(204).end()
})

authRouter.get('/session', async (req: Request, res: Response) => {
  const token = parseSessionCookie(req)
  const principal = await resolveDashboardSession(squadApiPool, token)
  if (!principal) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  res.status(200).json({ principal })
})

authRouter.post('/logout', async (req: Request, res: Response) => {
  const token = parseSessionCookie(req)
  await destroyDashboardSession(squadApiPool, token)
  res.setHeader('Set-Cookie', buildClearSessionCookie())
  res.status(204).end()
})

// Re-exported for authMiddleware wiring + tests.
export { SESSION_COOKIE_NAME }
