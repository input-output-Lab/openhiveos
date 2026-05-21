import { timingSafeEqual, createHash } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { squadApiConfig } from '../config.js'

// ---------------------------------------------------------------------------
// Ingestion auth middleware — ARCH-015 SEC-C1, SEC-C2, SEC-C8
//
// Authenticates POST /internal/usage requests via OPENHIVEOS_INGESTION_TOKEN.
//
// SEPARATE from src/squad-api/middleware/auth.ts — this middleware does NOT
// reference the agents table at any point. Conflating ingestion scope with
// agent identity is OWASP A01 (privilege confusion — SEC-C8).
//
// Token: 64 lowercase hex characters (32 bytes CSPRNG entropy — SEC-C1).
//   Validated at startup by Zod config schema (z.string().min(64)).
//
// Comparison: both provided and expected tokens are SHA-256 hashed before
// timingSafeEqual. This produces equal-length Buffers regardless of input
// length — prevents length-based timing side-channels (SEC-C2).
// String equality (===) on raw token values is forbidden.
// ---------------------------------------------------------------------------

/** SHA-256 digest — produces a fixed-length Buffer for timingSafeEqual. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/** Generic 401 — intentionally opaque. No token material in response (SEC-C2). */
function unauthorized(res: Response): void {
  res.status(401).json({ error: 'Unauthorized' })
}

export function ingestionAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers['authorization']

  if (!authHeader?.startsWith('Bearer ')) {
    unauthorized(res)
    return
  }

  const provided = authHeader.slice(7)

  // Config is validated at startup — OPENHIVEOS_INGESTION_TOKEN is guaranteed
  // to be a non-empty string of at least 64 characters.
  const expected = squadApiConfig.OPENHIVEOS_INGESTION_TOKEN

  // timingSafeEqual requires equal-length Buffers. Hash both values with
  // SHA-256 to normalise length before comparing (SEC-C2).
  if (!timingSafeEqual(digest(provided), digest(expected))) {
    unauthorized(res)
    return
  }

  next()
}
