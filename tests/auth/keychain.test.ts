/**
 * tests/auth/keychain.test.ts
 *
 * S19-ARCH-01f (#2779) unit tests.
 *
 * Strategy: the module's `execFileSync` import is injected-compatible via
 * module mocking of `node:child_process`. We assert the contract that
 * matters operationally:
 *   1. The token is passed as the -w argument value (NOT stdin — `security`
 *      reads -w prompts from the TTY, which hangs non-interactive callers;
 *      empirically established 2026-11-10). Argv exposure is same-user only,
 *      the identical trust boundary as the keychain item itself.
 *   2. Store uses -U (update-in-place) so rotation overwrites.
 *   3. Non-macOS is fail-closed: throws, never falls back to plaintext.
 *   4. Readback maps `security`'s exit code 44 (item not found) to null.
 *   5. storeAndVerify throws on a mismatched readback.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'

let cp: typeof import('node:child_process')

beforeEach(async () => {
  vi.resetModules()
  cp = await import('node:child_process')
})

describe('keychain module', () => {
  const REF = { service: 'openhiveos-test', account: 'murphy' }
  const TOKEN = 'a'.repeat(32) + '.' + 'b'.repeat(64)

  let platformSpy: MockInstance
  let execSpy: ReturnType<typeof vi.fn>

  function loadModule() {
    return import('../../src/auth/keychain.js')
  }

  afterEach(() => {
    platformSpy.mockRestore()
    vi.restoreAllMocks()
  })

  function arrange(platform: NodeJS.Platform, execResult?: string) {
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
    execSpy = vi.fn().mockReturnValue(Buffer.from(execResult ?? TOKEN))
    vi.doMock('node:child_process', () => ({
      ...cp,
      execFileSync: execSpy,
    }))
  }

  it('passes token as -w argument value, never stdin (TTY-prompt avoidance)', async () => {
    arrange('darwin')
    const mod = await loadModule()
    mod.storeTokenInKeychain(REF, TOKEN)

    expect(execSpy).toHaveBeenCalledTimes(1)
    const [cmd, argv, opts] = execSpy.mock.calls[0] as [string, string[], { input?: string }]
    expect(cmd).toBe('security')
    expect(argv[0]).toBe('add-generic-password')
    expect(argv).toContain('-U')
    const wIndex = argv.indexOf('-w')
    expect(wIndex).toBeGreaterThan(-1)
    expect(argv[wIndex + 1]).toBe(TOKEN)
    expect(opts.input).toBeUndefined()
  })

  it('uses -U so rotation overwrites the existing item', async () => {
    arrange('darwin')
    const mod = await loadModule()
    mod.storeTokenInKeychain(REF, TOKEN)
    const argv = execSpy.mock.calls[0][1] as string[]
    const uIndex = argv.indexOf('-U')
    expect(uIndex).toBeGreaterThan(-1)
  })

  it('is fail-closed on non-macOS: throws, never plaintext-falls-back', async () => {
    arrange('linux')
    const mod = await loadModule()
    expect(() => mod.storeTokenInKeychain(REF, TOKEN)).toThrow(/only implemented on macOS/)
    expect(execSpy).not.toHaveBeenCalled()
  })

  it('readback maps security exit 44 (not found) to null', async () => {
    arrange('darwin')
    execSpy.mockImplementation(() => {
      const err = new Error('The specified item could not be found.') as Error & { status: number }
      err.status = 44
      throw err
    })
    const mod = await loadModule()
    expect(mod.readTokenFromKeychain(REF)).toBeNull()
  })

  it('storeAndVerify throws when readback mismatches the minted token', async () => {
    arrange('darwin', 'different-value')
    const mod = await loadModule()
    expect(() => mod.storeAndVerify(REF, TOKEN)).toThrow(/readback verification failed/)
  })

  it('storeAndVerify succeeds on a matching readback', async () => {
    arrange('darwin', TOKEN)
    const mod = await loadModule()
    expect(() => mod.storeAndVerify(REF, TOKEN)).not.toThrow()
  })

  it('readCommand never embeds the token — it is a lookup, not a store', async () => {
    const mod = await loadModule()
    const cmd = mod.readCommand(REF)
    expect(cmd).toContain('find-generic-password')
    expect(cmd).not.toContain(TOKEN)
  })
})
