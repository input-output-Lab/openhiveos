#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Agent protocol sync check (CI gate).
//
// For every agents/*.agent.md:
//   1. The rendered OpenHive protocol block must appear verbatim
//      (agents/shared/openhive-protocol.md, `<slug>` -> filename stem).
//   2. The file must pass the agent-outline compliance rules.
//
// Exits 1 if any agent fails. Run with: npm run agents:check
// ---------------------------------------------------------------------------
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkAgentProtocol,
  extractProtocolBlock,
  slugFromFilename,
} from '../src/utilities/agent-protocol.js'
import { validateAgentContent } from '../src/utilities/agent-validator.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const agentsDir = join(repoRoot, 'agents')
const includePath = join(agentsDir, 'shared', 'openhive-protocol.md')

function run(): number {
  const block = extractProtocolBlock(readFileSync(includePath, 'utf8'))

  const agentFiles = readdirSync(agentsDir)
    .filter((name) => slugFromFilename(name) !== null)
    .sort()

  if (agentFiles.length === 0) {
    console.error('agents:check: no *.agent.md files found in agents/')
    return 1
  }

  let failed = 0
  for (const file of agentFiles) {
    const slug = slugFromFilename(file)
    if (slug === null) continue

    const content = readFileSync(join(agentsDir, file), 'utf8')
    const violations = [
      ...checkAgentProtocol(content, slug, block),
      ...validateAgentContent(content),
    ]

    if (violations.length === 0) {
      console.log(`agents:check: ${file} ok`)
      continue
    }

    failed++
    console.error(`agents:check: ${file} failed`)
    for (const violation of violations) {
      console.error(`  - ${violation}`)
    }
  }

  if (failed > 0) {
    console.error(`agents:check: ${failed} of ${agentFiles.length} agent file(s) failed`)
    return 1
  }
  console.log(`agents:check: ${agentFiles.length} agent file(s) in sync`)
  return 0
}

process.exitCode = run()
