/**
 * src/search/bm25.ts
 *
 * Okapi-BM25 hybrid reranking over pgvector candidate sets.
 *
 * Strategy: pgvector cosine similarity is the retrieval floor.
 * BM25 is applied as a re-ranking signal over the returned candidate set.
 * IDF is computed over candidates only — it reflects term discriminativeness
 * within the shortlist, which is exactly what's needed to reorder them.
 *
 * Final score = 0.6 × cosine_similarity + 0.4 × bm25_normalized
 *
 * Constants follow Okapi-BM25 conventions:
 *   k1 — term-frequency saturation (default 1.5, typical range 1.2–2.0)
 *   b  — length normalization (default 0.75; 0.0 = none, 1.0 = full)
 *
 * IDF formula: Lucene/BM25+ smoothed — log((N - df + 0.5) / (df + 0.5) + 1)
 * Always non-negative.
 */

const TOKEN_RE = /\w{2,}/gu

function tokenize(text: string): string[] {
  if (!text) return []
  TOKEN_RE.lastIndex = 0 // reset — global regex retains state between calls
  return [...text.toLowerCase().matchAll(TOKEN_RE)].map((m) => m[0])
}

function bm25Scores(query: string, documents: string[], k1 = 1.5, b = 0.75): number[] {
  const nDocs = documents.length
  const queryTerms = new Set(tokenize(query))

  if (queryTerms.size === 0 || nDocs === 0) return Array<number>(nDocs).fill(0)

  const tokenized = documents.map((d) => tokenize(d))
  const docLens = tokenized.map((t) => t.length)
  const avgdl = docLens.reduce((a, c) => a + c, 0) / nDocs || 1

  const df: Record<string, number> = {}
  for (const term of queryTerms) df[term] = 0
  for (const toks of tokenized) {
    const seen = new Set(toks)
    for (const term of queryTerms) {
      if (seen.has(term)) df[term] = (df[term] ?? 0) + 1
    }
  }

  const idf: Record<string, number> = {}
  for (const term of queryTerms) {
    const dfTerm = df[term] ?? 0
    idf[term] = Math.log((nDocs - dfTerm + 0.5) / (dfTerm + 0.5) + 1)
  }

  return tokenized.map((toks, i) => {
    const dl = docLens[i] ?? 0
    if (dl === 0) return 0

    const tf: Record<string, number> = {}
    for (const t of toks) {
      if (queryTerms.has(t)) tf[t] = (tf[t] ?? 0) + 1
    }

    let score = 0
    for (const [term, freq] of Object.entries(tf)) {
      const num = freq * (k1 + 1)
      const den = freq + k1 * (1 - b + (b * dl) / avgdl)
      score += (idf[term] ?? 0) * (num / den)
    }
    return score
  })
}

/**
 * Re-rank `results` by a convex combination of pgvector cosine similarity
 * and BM25. Returns a new sorted array with `bm25_score` added to each result.
 *
 * Vector similarity uses absolute cosine sim `max(0, similarity)` — not
 * relative-to-max — so adding or removing a candidate cannot reshuffle others.
 * BM25 is min-max normalized within the candidate set.
 */
export function hybridRank<T extends { content: string; similarity?: number }>(
  results: T[],
  query: string,
  vectorWeight = 0.6,
  bm25Weight = 0.4,
): (T & { bm25_score: number })[] {
  if (results.length === 0) return results as (T & { bm25_score: number })[]

  const docs = results.map((r) => r.content)
  const bm25Raw = bm25Scores(query, docs)
  const maxBm25 = Math.max(...bm25Raw)
  const bm25Norm =
    maxBm25 > 0 ? bm25Raw.map((s) => s / maxBm25) : Array<number>(results.length).fill(0)

  const scored = results.map((r, i) => {
    const vecSim = Math.max(0, r.similarity ?? 0)
    const rawScore = bm25Raw[i] ?? 0
    const normScore = bm25Norm[i] ?? 0
    const bm25Score = Math.round(rawScore * 1000) / 1000
    const combined = vectorWeight * vecSim + bm25Weight * normScore
    return { result: { ...r, bm25_score: bm25Score }, combined }
  })

  scored.sort((a, b) => b.combined - a.combined)
  return scored.map((s) => s.result)
}
