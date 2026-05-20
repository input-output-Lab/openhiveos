/**
 * src/search/sanitizer.ts
 *
 * Mitigate system-prompt contamination in search queries.
 *
 * Problem: AI agents sometimes prepend system prompts (2000+ chars) to search
 * queries. Embedding models represent the concatenated string as a single
 * vector where the system prompt overwhelms the actual question (typically
 * 10-50 chars), causing near-total retrieval failure.
 *
 * Heuristic pipeline (four steps, applied in order):
 *   Step 1 — passthrough (≤200 chars):        no degradation, ~89.8% R@10
 *   Step 2 — question extraction (? found):   near-full recovery, ~85-89%
 *   Step 3 — tail sentence extraction:        moderate recovery, ~80-89%
 *   Step 4 — tail truncation (fallback):      minimum viable, ~70-80%
 *
 *   Without sanitizer: ~1% (catastrophic silent failure)
 */

const MAX_QUERY_LENGTH = 250
const SAFE_QUERY_LENGTH = 200
const MIN_QUERY_LENGTH = 10

const QUOTE_CHARS = new Set(["'", '"'])
const SENTENCE_SPLIT_RE = /[.!?。！？\n]+/
const QUESTION_MARK_RE = /[?？]\s*['"]?\s*$/

export type SanitizeMethod =
  | 'passthrough'
  | 'question_extraction'
  | 'tail_sentence'
  | 'tail_truncation'

export interface SanitizeResult {
  clean_query: string
  was_sanitized: boolean
  original_length: number
  clean_length: number
  method: SanitizeMethod
}

function stripWrappingQuotes(candidate: string): string {
  candidate = candidate.trim()
  while (
    candidate.length >= 2 &&
    QUOTE_CHARS.has(candidate[0] ?? '') &&
    candidate[0] === candidate[candidate.length - 1]
  ) {
    candidate = candidate.slice(1, -1).trim()
    if (!candidate) return ''
  }
  if (candidate.length > 0 && QUOTE_CHARS.has(candidate[0] ?? '')) candidate = candidate.slice(1).trim()
  if (candidate.length > 0 && QUOTE_CHARS.has(candidate[candidate.length - 1] ?? '')) {
    candidate = candidate.slice(0, -1).trim()
  }
  return candidate
}

function trimCandidate(candidate: string): string {
  candidate = stripWrappingQuotes(candidate)
  if (candidate.length <= MAX_QUERY_LENGTH) return candidate

  const fragments = candidate
    .split(SENTENCE_SPLIT_RE)
    .map((f) => stripWrappingQuotes(f.trim()))
    .filter((f) => f.length > 0)

  for (let i = fragments.length - 1; i >= 0; i--) {
    const frag = fragments[i] ?? ''
    if (frag.length >= MIN_QUERY_LENGTH && frag.length <= MAX_QUERY_LENGTH) return frag
  }

  return candidate.slice(-MAX_QUERY_LENGTH).trim()
}

export function sanitizeQuery(rawQuery: string): SanitizeResult {
  rawQuery = rawQuery.trim()

  if (!rawQuery) {
    return {
      clean_query: rawQuery,
      was_sanitized: false,
      original_length: rawQuery.length,
      clean_length: rawQuery.length,
      method: 'passthrough',
    }
  }
  const originalLength = rawQuery.length

  // Step 1: Short query passthrough — almost certainly clean
  if (originalLength <= SAFE_QUERY_LENGTH) {
    return {
      clean_query: rawQuery,
      was_sanitized: false,
      original_length: originalLength,
      clean_length: originalLength,
      method: 'passthrough',
    }
  }

  // Step 2: Question extraction
  // System prompts rarely end with '?'. Walk segments in reverse — the actual
  // query is near the end.
  const allSegments = rawQuery
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  const questionSegments: string[] = []
  for (let i = allSegments.length - 1; i >= 0; i--) {
    const seg = allSegments[i] ?? ''
    if (QUESTION_MARK_RE.test(seg)) {
      questionSegments.push(seg)
    }
  }

  if (questionSegments.length === 0) {
    const sentences = rawQuery
      .split(SENTENCE_SPLIT_RE)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    for (let i = sentences.length - 1; i >= 0; i--) {
      const sentence = sentences[i] ?? ''
      if (sentence.includes('?') || sentence.includes('\uFF1F')) {
        questionSegments.push(sentence)
      }
    }
  }

  if (questionSegments.length > 0) {
    let candidate = (questionSegments[0] ?? '').trim()
    if (candidate.length >= MIN_QUERY_LENGTH) {
      if (candidate.length > MAX_QUERY_LENGTH) candidate = trimCandidate(candidate)
      if (candidate.length >= MIN_QUERY_LENGTH) {
        console.warn(
          `[search] Query sanitized: ${String(originalLength)} \u2192 ${String(candidate.length)} chars (method=question_extraction)`,
        )
        return {
          clean_query: candidate,
          was_sanitized: true,
          original_length: originalLength,
          clean_length: candidate.length,
          method: 'question_extraction',
        }
      }
    }
  }

  // Step 3: Tail sentence extraction
  for (let i = allSegments.length - 1; i >= 0; i--) {
    const seg = allSegments[i] ?? ''
    if (seg.length >= MIN_QUERY_LENGTH) {
      const candidate = trimCandidate(seg)
      if (candidate.length >= MIN_QUERY_LENGTH) {
        console.warn(
          `[search] Query sanitized: ${String(originalLength)} \u2192 ${String(candidate.length)} chars (method=tail_sentence)`,
        )
        return {
          clean_query: candidate,
          was_sanitized: true,
          original_length: originalLength,
          clean_length: candidate.length,
          method: 'tail_sentence',
        }
      }
    }
  }

  // Step 4: Tail truncation (fallback)
  const candidate = rawQuery.slice(-MAX_QUERY_LENGTH).trim()
  console.warn(
    `[search] Query sanitized: ${String(originalLength)} \u2192 ${String(candidate.length)} chars (method=tail_truncation)`,
  )
  return {
    clean_query: candidate,
    was_sanitized: true,
    original_length: originalLength,
    clean_length: candidate.length,
    method: 'tail_truncation',
  }
}
