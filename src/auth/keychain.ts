/**
 * src/auth/keychain.ts
 *
 * S19-ARCH-01f (#2779): OS keychain storage for provisioned agent tokens.
 *
 * SPIKE-2640 SCOPE RULING (binding): keychain storage is CONVENIENCE
 * (credential hygiene — keeps raw tokens out of plaintext files like
 * .env / mcp.json), NOT a security control. The macOS `security` CLI can
 * read keychain items from any process running as the same user without
 * interaction for partition-scoped items. The human step-up gate (ARCH-028)
 * is the security control; this module is hygiene only. Locksmith review
 * must not treat this as defense-in-depth.
 *
 * Design:
 *   - macOS: native `security` CLI (no new dependencies).
 *   - Non-macOS: fail-closed with a clear message — no silent plaintext
 *     fallback. The caller decides what to do (print to stdout, etc.).
 *   - Service name is configurable via OPENHIVE_KEYCHAIN_SERVICE
 *     (default: 'openhiveos').
 *   - Item account = agent slug. One token per (service, account).
 *     Rotation overwrites in place via -U (update-if-exists).
 *   - The raw token is passed as the `-w` argument value. EMPIRICAL NOTE
 *     (2026-11-10, #2779 live run): `security add-generic-password -w`
 *     WITHOUT a value reads from the TTY (interactive prompt), not stdin —
 *     the stdin approach hangs non-interactive callers. Passing the token
 *     as argv exposes it transiently in process listings to same-user
 *     processes only — the SAME trust boundary as the keychain item itself
 *     (any same-user process can read items via the security CLI). Given
 *     spike 2640's ruling (this module is hygiene, not security), the
 *     transient argv exposure is an acceptable, documented trade.
 */

import { execFileSync } from 'node:child_process'

const DEFAULT_SERVICE = 'openhiveos'

export interface KeychainRef {
  service: string
  account: string
}

export function keychainServiceName(): string {
  return process.env['OPENHIVE_KEYCHAIN_SERVICE'] ?? DEFAULT_SERVICE
}

export function isMacOS(): boolean {
  return process.platform === 'darwin'
}

/** Shell-quoted `security find-generic-password` lookup command for the user. */
export function readCommand(ref: KeychainRef): string {
  return `security find-generic-password -s ${ref.service} -a ${ref.account} -w`
}

/**
 * Stores the token in the macOS keychain. Overwrites an existing item.
 *
 * The token is passed as the -w argument value (NOT stdin — `security`
 * reads -w prompts from the TTY, which hangs non-interactive callers;
 * see module header for the trust-boundary rationale).
 *
 * Fail-closed: throws on non-macOS or on any `security` failure.
 */
export function storeTokenInKeychain(ref: KeychainRef, token: string): void {
  if (!isMacOS()) {
    throw new Error(
      `--keychain is only implemented on macOS (darwin); this host is '${process.platform}'. ` +
        `No plaintext fallback is attempted by design.`,
    )
  }

  // -U = update the item if it already exists (rotation path).
  execFileSync(
    'security',
    [
      'add-generic-password',
      '-U',
      '-s', ref.service,
      '-a', ref.account,
      '-l', `${ref.service}-${ref.account}`,
      '-w', token,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
}

/**
 * Reads the token back from the keychain. Used by verification after store
 * and by future consumers (e.g. a gateway --token-from-keychain flag).
 * Returns null when the item does not exist (44 error code from `security`).
 */
export function readTokenFromKeychain(ref: KeychainRef): string | null {
  if (!isMacOS()) {
    throw new Error(
      `--keychain is only implemented on macOS (darwin); this host is '${process.platform}'.`,
    )
  }
  try {
    const out = execFileSync(
      'security',
      ['find-generic-password', '-s', ref.service, '-a', ref.account, '-w'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    return out.toString('utf8').trim()
  } catch (err) {
    if (err instanceof Error && 'status' in err && (err as { status?: number }).status === 44) {
      return null
    }
    throw err
  }
}

/**
 * Store-then-readback verification. The readback happens via the same OS
 * surface a consumer would use, so success proves end-to-end round trip.
 */
export function storeAndVerify(ref: KeychainRef, token: string): void {
  storeTokenInKeychain(ref, token)
  const readback = readTokenFromKeychain(ref)
  if (readback !== token) {
    throw new Error(
      `Keychain readback verification failed for ${ref.service}/${ref.account}. ` +
        `The stored value does not match the minted token. Rotate again.`,
    )
  }
}
