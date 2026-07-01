#!/usr/bin/env tsx
/**
 * src/scripts/one-deploy.ts
 *
 * Deploys The One's agent files from the canonical source in this repository
 * to the operator's AI harness directory.
 *
 * The One is the only agent whose files are managed by OpenHiveOS. All other
 * agents are user-supplied and are not stored in this repository (ARCH-025).
 *
 * Usage:
 *   npx tsx src/scripts/one-deploy.ts
 *   npx tsx src/scripts/one-deploy.ts --dry-run
 *
 * Environment variables:
 *   ONE_HARNESS_DIR  — Target directory (default: ~/.copilot/agents/)
 *                      Must resolve to a path inside the user's home directory.
 *
 * Source files deployed:
 *   agents/one.agent.md     → <ONE_HARNESS_DIR>/one.agent.md
 *   agents/one/             → <ONE_HARNESS_DIR>/one/  (full subdirectory)
 *
 * SEC-C3: Only path, byte count, and success/failure status are logged.
 *         File contents are never logged.
 * SEC-C6: ONE_HARNESS_DIR is resolved to an absolute path. Any path that
 *         traverses outside the user's home directory is rejected.
 */

import 'dotenv/config'

import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const isDryRun = process.argv.includes('--dry-run')

// ---------------------------------------------------------------------------
// Resolve source paths (relative to project root)
// ---------------------------------------------------------------------------
const projectRoot = resolve(new URL('../../', import.meta.url).pathname)
const sourceAgentFile = join(projectRoot, 'agents', 'one.agent.md')
const sourceVaultDir = join(projectRoot, 'agents', 'one')

// ---------------------------------------------------------------------------
// Resolve and validate harness target directory (SEC-C6)
// ---------------------------------------------------------------------------
const rawHarnessDir = process.env['ONE_HARNESS_DIR'] ?? join(homedir(), '.copilot', 'agents')
const harnessDir = resolve(rawHarnessDir)
const home = homedir()

if (!harnessDir.startsWith(home)) {
  console.error(
    '[one-deploy] Error: ONE_HARNESS_DIR resolves to %s which is outside the user home directory (%s).',
    harnessDir,
    home,
  )
  console.error('[one-deploy] Path traversal guard rejected this path (SEC-C6).')
  process.exit(1)
}

const targetAgentFile = join(harnessDir, 'one.agent.md')
const targetVaultDir = join(harnessDir, 'one')

// ---------------------------------------------------------------------------
// Atomic file write — temp file + rename (POSIX atomic)
// ---------------------------------------------------------------------------
async function atomicWrite(targetPath: string, content: Buffer): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true })
  const tmp = `${targetPath}.tmp`
  await writeFile(tmp, content, { mode: 0o600 })
  await rename(tmp, targetPath)
}

// ---------------------------------------------------------------------------
// Recursive directory copy
// ---------------------------------------------------------------------------
async function copyDir(src: string, dest: string): Promise<number> {
  await mkdir(dest, { recursive: true })
  const entries = await readdir(src, { withFileTypes: true })
  let count = 0
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      count += await copyDir(srcPath, destPath)
    } else if (entry.isFile()) {
      if (isDryRun) {
        const s = await stat(srcPath)
        console.log('[one-deploy] [dry-run] Would deploy: %s (%d bytes)', destPath, s.size)
      } else {
        const content = await readFile(srcPath)
        await atomicWrite(destPath, content)
        console.log('[one-deploy] Deployed: %s (%d bytes)', destPath, content.length)
      }
      count++
    }
  }
  return count
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  if (isDryRun) {
    console.log('[one-deploy] Dry run — no files will be written.')
    console.log('[one-deploy] Source:  %s', projectRoot + '/agents/')
    console.log('[one-deploy] Target:  %s', harnessDir)
    console.log('')
  }

  // Verify source files exist before proceeding
  try {
    await stat(sourceAgentFile)
  } catch {
    console.error('[one-deploy] Error: Source file not found: %s', sourceAgentFile)
    process.exit(1)
  }
  try {
    await stat(sourceVaultDir)
  } catch {
    console.error('[one-deploy] Error: Source vault directory not found: %s', sourceVaultDir)
    process.exit(1)
  }

  // Deploy one.agent.md
  if (isDryRun) {
    const s = await stat(sourceAgentFile)
    console.log('[one-deploy] [dry-run] Would deploy: %s (%d bytes)', targetAgentFile, s.size)
  } else {
    const content = await readFile(sourceAgentFile)
    await atomicWrite(targetAgentFile, content)
    console.log('[one-deploy] Deployed: %s (%d bytes)', targetAgentFile, content.length)
  }

  // Deploy agents/one/ vault directory
  const vaultCount = await copyDir(sourceVaultDir, targetVaultDir)

  if (isDryRun) {
    console.log('')
    console.log('[one-deploy] Dry run complete. %d file(s) would be deployed.', vaultCount + 1)
  } else {
    console.log('')
    console.log(
      '[one-deploy] The One deployed to %s — %d file(s) written.',
      harnessDir,
      vaultCount + 1,
    )
    console.log('[one-deploy] Run `npx tsx src/scripts/one-init.ts` if this is a first-time setup.')
  }
}

main().catch((err: unknown) => {
  console.error('[one-deploy] Fatal:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
