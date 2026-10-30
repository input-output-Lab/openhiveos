/**
 * Token bucket rate limiter for Gemini embeddings requests.
 *
 * Gemini embeddings quota: ~1500 requests/minute (varies by plan).
 * This limiter ensures we stay well under the limit by distributing
 * requests evenly across the minute to prevent burst violations.
 *
 * Implementation uses a sliding window token bucket:
 * - Capacity: 20 tokens (bursts of up to 20 allowed)
 * - Refill rate: tokens per second based on target RPM
 * - Tokens consumed: 1 per embed request
 */

const TOKENS_PER_MINUTE = 100 // Conservative quota: 100 reqs/min vs Gemini's ~1500
const BURST_CAPACITY = 20

class TokenBucket {
  private tokens: number = BURST_CAPACITY
  private lastRefillTime: number = Date.now()

  private refillRate(): number {
    // Tokens per millisecond
    return TOKENS_PER_MINUTE / 60_000
  }

  private refill(): void {
    const now = Date.now()
    const elapsedMs = now - this.lastRefillTime
    const tokensToAdd = elapsedMs * this.refillRate()

    this.tokens = Math.min(BURST_CAPACITY, this.tokens + tokensToAdd)
    this.lastRefillTime = now
  }

  /**
   * Try to consume a token. Returns the wait time in milliseconds if quota exceeded.
   */
  tryConsume(): number | null {
    this.refill()

    if (this.tokens >= 1) {
      this.tokens -= 1
      return null // Success
    }

    // Calculate how long to wait until next token available
    const tokensNeeded = 1 - this.tokens
    const waitTimeMs = (tokensNeeded / this.refillRate()) * 1000
    return Math.ceil(waitTimeMs)
  }
}

const bucket = new TokenBucket()

/**
 * Acquires an embedding slot, waiting if necessary to stay within rate limit.
 * Call this before calling embedContent().
 */
export async function acquireEmbeddingSlot(): Promise<void> {
  let attempt = 0
  const maxAttempts = 10 // Fail after 10 attempts (~600s)

  while (attempt < maxAttempts) {
    const waitTimeMs = bucket.tryConsume()
    if (waitTimeMs === null) {
      // Token acquired successfully
      return
    }

    const delayMs = Math.min(waitTimeMs, 60_000) // Cap at 60s
    console.debug(`[embeddings-limiter] Rate limit: waiting ${String(delayMs)}ms before next request`)
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    attempt++
  }

  throw new Error(
    `[embeddings-limiter] Failed to acquire embedding slot after ${String(maxAttempts)} attempts`,
  )
}
