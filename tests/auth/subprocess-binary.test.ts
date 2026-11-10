import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { resolveSubprocessBinaryPath } from '../../packages/mcp-gateway/src/gateway.js'

// ---------------------------------------------------------------------------
// S19-ARCH-01d (#2777, Tier-3): the orphan-storm fix (spike 2640 root cause).
// The gateway spawned its subprocess via MCP_BINARY_PATH relative to AMBIENT
// CWD — boots from packages/mcp-gateway spawned the gateway itself,
// recursively (the 618/323/258 orphan storms). These tests pin:
//   1. relative paths resolve against REPO ROOT, CWD-independent
//   2. absolute paths pass through (Compose mounts)
//   3. self-resolution (dist AND src spellings) → null: the structural
//      recursion guard
// ---------------------------------------------------------------------------

const REPO = path.resolve('/repo/OpenHiveOS')
const DIST_ENTRY = path.join(REPO, 'packages', 'mcp-gateway', 'dist', 'index.js')
const SRC_ENTRY = path.join(REPO, 'packages', 'mcp-gateway', 'src', 'index.ts')
const SELF_BOTH = [DIST_ENTRY, SRC_ENTRY]

const opts = (raw: string) => ({ raw, repoRoot: REPO, selfEntrypoints: SELF_BOTH })

describe('S19-ARCH-01d: resolveSubprocessBinaryPath', () => {
  it('relative default resolves to REPO-ROOT dist/index.js — NOT the gateway', () => {
    const p = resolveSubprocessBinaryPath(opts('dist/index.js'))
    expect(p).toBe(path.join(REPO, 'dist', 'index.js'))
    expect(SELF_BOTH).not.toContain(p)
  })

  it('relative resolution is CWD-INDEPENDENT (the spike-2640 property)', () => {
    // The bug: booting from packages/mcp-gateway changed the resolution.
    // The fix: resolution depends only on repoRoot + raw — identical results
    // regardless of where the process was started.
    const fromRoot = resolveSubprocessBinaryPath(opts('dist/index.js'))
    const fromPackage = resolveSubprocessBinaryPath(opts('dist/index.js'))
    expect(fromRoot).toBe(fromPackage)
  })

  it('absolute paths pass through untouched (Compose volume mounts)', () => {
    const abs = '/mcp-server/index.js'
    expect(resolveSubprocessBinaryPath(opts(abs))).toBe(abs)
  })

  it('self-spawn guard: gateway entrypoints resolve to null (dist AND src)', () => {
    expect(resolveSubprocessBinaryPath(opts(DIST_ENTRY))).toBeNull()
    expect(resolveSubprocessBinaryPath(opts(SRC_ENTRY))).toBeNull()
    // relative spellings that normalize into a self entrypoint:
    expect(resolveSubprocessBinaryPath(opts('packages/mcp-gateway/dist/index.js'))).toBeNull()
    expect(resolveSubprocessBinaryPath(opts('packages/mcp-gateway/src/index.ts'))).toBeNull()
  })

  it('self-spawn guard survives path normalization tricks', () => {
    // The historical bug pattern: packages/mcp-gateway + dist/index.js, in
    // any spelling, must never slip past the guard.
    expect(resolveSubprocessBinaryPath(opts('./packages/mcp-gateway/dist/index.js'))).toBeNull()
    expect(
      resolveSubprocessBinaryPath(opts('packages/mcp-gateway/dist/../dist/index.js')),
    ).toBeNull()
  })

  it('relative non-self paths resolve under the repo root', () => {
    expect(resolveSubprocessBinaryPath(opts('build/server.js'))).toBe(
      path.join(REPO, 'build', 'server.js'),
    )
  })
})
