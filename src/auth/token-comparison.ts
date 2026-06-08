import { timingSafeEqual } from 'node:crypto'

// ---------------------------------------------------------------------------
// Timing-safe token hash comparison (ARCH-008 + ARCH-021)
//
// This module ensures all token comparisons use crypto.timingSafeEqual
// to prevent timing-side-channel attacks on authentication credentials.
//
// Both MCP (identity.ts) and HTTP API (squad-api/middleware/auth.ts) paths
// must use this function for all hash verification.
// ---------------------------------------------------------------------------

/**
 * Compare two token hashes using constant-time comparison.
 *
 * Prevents timing-side-channel attacks by using crypto.timingSafeEqual
 * instead of string equality (===) or SQL string comparison.
 *
 * @param storedHash - The stored hash from the database (as hex string or Buffer)
 * @param providedHash - The hash computed from the provided token (as hex string or Buffer)
 * @returns true if hashes match, false otherwise
 * @throws Error if either hash is null, undefined, or has mismatched byte length
 *
 * @example
 * // From database: hashHex = 'a1b2c3...' (hex string)
 * // From token: computed = Buffer from('a1b2c3...', 'hex')
 * const match = compareTokenHash(hashHex, computed)
 */
export function compareTokenHash(
  storedHash: string | Buffer,
  providedHash: string | Buffer,
): boolean {
  // Convert both to Buffers if needed
  const storedBuffer = typeof storedHash === 'string'
    ? Buffer.from(storedHash, 'hex')
    : storedHash

  const providedBuffer = typeof providedHash === 'string'
    ? Buffer.from(providedHash, 'hex')
    : providedHash

  // Byte-length mismatch guard (prevents length-based timing leaks)
  // Buffer.from() cannot return null/undefined, so no null check needed
  if (storedBuffer.byteLength !== providedBuffer.byteLength) {
    return false
  }

  // Constant-time comparison: we've already guarded buffer lengths above,
  // so timingSafeEqual will not throw
  return timingSafeEqual(storedBuffer, providedBuffer)
}
