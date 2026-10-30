import { GoogleGenerativeAI, TaskType } from '@google/generative-ai'
import { config } from '../config.js'
import { acquireEmbeddingSlot } from './rate-limiter.js'

// gemini-embedding-001 native output is 3072d.
// pgvector HNSW supports ≤2000 dimensions, so we request 768d via
// Matryoshka truncation (outputDimensionality). This value is frozen —
// changing it requires a full schema rebuild (ARCH-002).
const OUTPUT_DIMENSIONS = 768
const MAX_RETRIES = 7
const INITIAL_RETRY_DELAY_MS = 500
const MAX_RETRY_DELAY_MS = 60_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Calculates exponential backoff with jitter for rate limit retries.
 * Formula: min(MAX_DELAY, INITIAL_DELAY * 2^attempt) + random(0, jitter)
 * This ensures we back off exponentially while adding randomness to prevent
 * thundering herd when multiple requests hit rate limit simultaneously.
 */
function calculateBackoffMs(attempt: number): number {
  const exponentialDelayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1)
  const cappedDelayMs = Math.min(exponentialDelayMs, MAX_RETRY_DELAY_MS)
  const jitterMs = Math.random() * cappedDelayMs * 0.1 // 10% jitter
  return Math.floor(cappedDelayMs + jitterMs)
}

/**
 * Detects if an error is a rate limit (429) or other retriable error.
 */
function isRetriableError(err: unknown): boolean {
  if (err instanceof Error) {
    // Check for 429 status code in error message (Google API errors)
    if (err.message.includes('429') || err.message.includes('Too Many Requests')) {
      return true
    }
    // Retriable transient errors
    if (
      err.message.includes('UNAVAILABLE') ||
      err.message.includes('DEADLINE_EXCEEDED') ||
      err.message.includes('INTERNAL')
    ) {
      return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Module-level singleton for GoogleGenerativeAI client (TASK-1721)
//
// Initialized at module load using the validated GEMINI_API_KEY from config.
// Reused for all embedContent() calls to eliminate per-call instantiation overhead.
// ---------------------------------------------------------------------------
const genai = new GoogleGenerativeAI(config.GEMINI_API_KEY)
const model = genai.getGenerativeModel({ model: 'gemini-embedding-001' })

export async function embedContent(text: string): Promise<number[]> {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Acquire rate limit slot before making API call
      await acquireEmbeddingSlot()

      // outputDimensionality is a valid REST API field but not yet typed in
      // the SDK — cast through unknown to add it without using any.
      // Remove when upstream types are updated.
      const request: Parameters<typeof model.embedContent>[0] = {
        content: { parts: [{ text }], role: 'user' },
        taskType: TaskType.RETRIEVAL_DOCUMENT,
      };
      (request as unknown as Record<string, unknown>)['outputDimensionality'] = OUTPUT_DIMENSIONS
      const result = await model.embedContent(request)
      return result.embedding.values
    } catch (err) {
      lastError = err
      if (attempt < MAX_RETRIES && isRetriableError(err)) {
        const delayMs = calculateBackoffMs(attempt)
        console.warn(
          `[embeddings] Attempt ${String(attempt)} failed (retriable), retrying in ${String(delayMs)}ms…`,
          err instanceof Error ? err.message : String(err),
        )
        await sleep(delayMs)
      } else if (attempt < MAX_RETRIES) {
        // Non-retriable error, fail fast
        throw err
      }
    }
  }

  throw new Error(
    `[embeddings] embedContent failed after ${String(MAX_RETRIES)} attempts: ${String(lastError)}`,
  )
}
