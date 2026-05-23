import rateLimit from 'express-rate-limit'

// ---------------------------------------------------------------------------
// Ingestion rate limiter — ARCH-015 SEC-C3: 60 requests per minute.
//
// Applied to POST /internal/usage only — separate from the dashboard rate
// limiter (squadApiRateLimit: 20 req/min on /api/*).
//
// 60 req/min allows Bridge retry bursts while blocking volumetric cost-table
// flooding. Bridge fire-and-forget with retry should not approach this limit
// even with multiple concurrent agents running short loops.
// ---------------------------------------------------------------------------

export const ingestionRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,             // 60 ingestion requests per window (SEC-C3)
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many ingestion requests — retry after the rate limit window' },
  skip: () => process.env['NODE_ENV'] === 'test',
})
