import rateLimit from 'express-rate-limit'

// ---------------------------------------------------------------------------
// Rate limiter — SEC-A4 (ARCH-012): 20 requests per minute per IP (production).
//
// Applied before auth middleware so that unauthenticated enumeration attempts
// are also rate-limited. Standard headers enabled for client visibility.
// Legacy headers disabled (Retry-After uses standard RateLimit-Reset).
//
// Development override: Increase to 300 req/min if NODE_ENV !== 'production'
// (allows dashboard UI to make concurrent init requests without throttling).
// ---------------------------------------------------------------------------

const getMaxRequests = (): number => {
  // Production: strict 20 req/min (SEC-A4)
  if (process.env['NODE_ENV'] === 'production') return 20
  // Development: generous 300 req/min (5 req/sec) for UI fluidity
  return 300
}

export const squadApiRateLimit = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: getMaxRequests(),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests — retry after the rate limit window' },
  // Skip rate limiting in test environment — rate limiting is an infra concern
  // tested at the middleware unit level, not in route integration tests.
  skip: () => process.env['NODE_ENV'] === 'test',
})
