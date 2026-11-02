/**
 * tests/utilities/agent-protocol.test.ts
 *
 * Covers the pure protocol-sync logic (extract, render, drift detection, slug
 * parsing) and checks that every real agents/*.agent.md is in sync with the
 * shared include.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PROTOCOL_END,
  PROTOCOL_START,
  checkAgentProtocol,
  extractProtocolBlock,
  renderProtocolBlock,
  slugFromFilename,
} from '../../src/utilities/agent-protocol.js'

const here = dirname(fileURLToPath(import.meta.url))
const agentsDir = join(here, '..', '..', 'agents')
const includePath = join(agentsDir, 'shared', 'openhive-protocol.md')

const INCLUDE = `Maintainer notes outside the markers.

${PROTOCOL_START}
Log for <slug> and <slug>.
Session <slug>:vscode.
${PROTOCOL_END}

More notes.
`

describe('extractProtocolBlock', () => {
  it('returns the trimmed text between the markers', () => {
    expect(extractProtocolBlock(INCLUDE)).toBe(
      'Log for <slug> and <slug>.\nSession <slug>:vscode.',
    )
  })

  it('throws when the start marker is missing', () => {
    expect(() => extractProtocolBlock(`body\n${PROTOCOL_END}`)).toThrow(/missing/)
  })

  it('throws when the end marker is missing', () => {
    expect(() => extractProtocolBlock(`${PROTOCOL_START}\nbody`)).toThrow(/missing/)
  })

  it('throws when a marker is duplicated', () => {
    const dup = `${PROTOCOL_START}\na\n${PROTOCOL_END}\n${PROTOCOL_START}\nb\n${PROTOCOL_END}`
    expect(() => extractProtocolBlock(dup)).toThrow(/duplicate/)
  })

  it('throws when the end marker precedes the start marker', () => {
    const reversed = `${PROTOCOL_END}\nbody\n${PROTOCOL_START}`
    expect(() => extractProtocolBlock(reversed)).toThrow(/before start/)
  })
})

describe('renderProtocolBlock', () => {
  it('replaces every <slug> placeholder with the agent slug', () => {
    expect(renderProtocolBlock('a <slug> b <slug>', 'one')).toBe('a one b one')
  })

  it('leaves text without placeholders unchanged', () => {
    expect(renderProtocolBlock('no placeholders', 'one')).toBe('no placeholders')
  })
})

describe('checkAgentProtocol', () => {
  const block = 'Log for <slug>.'

  it('returns no violations when the rendered block is present verbatim', () => {
    const agent = `# Agent\n\nLog for murphy.\n\nMore.`
    expect(checkAgentProtocol(agent, 'murphy', block)).toEqual([])
  })

  it('reports drift when the rendered block is edited', () => {
    const agent = `# Agent\n\nLog for murphy!.\n`
    const violations = checkAgentProtocol(agent, 'murphy', block)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('out of sync')
    expect(violations[0]).toContain('"murphy"')
  })

  it('reports drift when the agent carries another slug', () => {
    const agent = `Log for silas.`
    expect(checkAgentProtocol(agent, 'murphy', block)).toHaveLength(1)
  })
})

describe('slugFromFilename', () => {
  it('maps an agent filename to its slug', () => {
    expect(slugFromFilename('one.agent.md')).toBe('one')
    expect(slugFromFilename('the-zero.agent.md')).toBe('the-zero')
  })

  it('returns null for files that are not agent files', () => {
    expect(slugFromFilename('one.md')).toBeNull()
    expect(slugFromFilename('agent.md')).toBeNull()
    expect(slugFromFilename('one.agent.md.bak')).toBeNull()
  })
})

describe('repository agent files', () => {
  it('every agents/*.agent.md carries the rendered protocol block', () => {
    const block = extractProtocolBlock(readFileSync(includePath, 'utf8'))
    const agentFiles = readdirSync(agentsDir).filter((name) => slugFromFilename(name) !== null)

    expect(agentFiles.length).toBeGreaterThan(0)
    for (const file of agentFiles) {
      const slug = slugFromFilename(file) as string
      const content = readFileSync(join(agentsDir, file), 'utf8')
      expect(checkAgentProtocol(content, slug, block), file).toEqual([])
    }
  })
})
