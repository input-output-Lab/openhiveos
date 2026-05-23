import rateLimit from 'express-rate-limit'

// ---------------------------------------------------------------------------
// Rate limiter — SEC-A4 (ARCH-012): 20 requests per minute per IP.
//
// Applied before auth middleware so that unauthenticated enumeration attempts
// are also rate-limited. Standard headers enabled for client visibility.
// Legacy headers disabled (Retry-After uses standard RateLimit-Reset).
// ---------------------------------------------------------------------------

export const squadApiRateLimit = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 20,              // 20 requests per window (SEC-A4)
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests — retry after the rate limit window' },
  // Skip rate limiting in test environment — rate limiting is an infra concern
  // tested at the middleware unit level, not in route integration tests.
  skip: () => process.env['NODE_ENV'] === 'test',
})
