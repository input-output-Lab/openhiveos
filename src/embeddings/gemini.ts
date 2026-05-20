import { GoogleGenerativeAI, TaskType } from '@google/generative-ai'

// gemini-embedding-001 native output is 3072d.
// pgvector HNSW supports ≤2000 dimensions, so we request 768d via
// Matryoshka truncation (outputDimensionality). This value is frozen —
// changing it requires a full schema rebuild (ARCH-002).
const OUTPUT_DIMENSIONS = 768
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getModel() {
  const key = process.env['GEMINI_API_KEY']
  if (!key) {
    throw new Error('GEMINI_API_KEY environment variable is required')
  }
  const genai = new GoogleGenerativeAI(key)
  return genai.getGenerativeModel({ model: 'gemini-embedding-001' })
}

export async function embedContent(text: string): Promise<number[]> {
  const model = getModel()
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
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
      if (attempt < MAX_RETRIES) {
        const delayMs = RETRY_DELAY_MS * attempt
        console.warn(
          `[embeddings] Attempt ${String(attempt)} failed, retrying in ${String(delayMs)}ms…`,
        )
        await sleep(delayMs)
      }
    }
  }

  throw new Error(
    `[embeddings] embedContent failed after ${String(MAX_RETRIES)} attempts: ${String(lastError)}`,
  )
}
