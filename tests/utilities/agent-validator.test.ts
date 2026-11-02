/**
 * tests/utilities/agent-validator.test.ts
 *
 * Rule coverage for validateAgentContent (agent-outline SOP v1.1.0).
 * Each test takes a compliant fixture and breaks exactly one rule.
 */
import { describe, it, expect } from 'vitest'
import { validateAgentContent } from '../../src/utilities/agent-validator.js'

const COMPLIANT = `---
name: test-agent
description: A test agent
---

## Identity

Test identity.

## Session Start Gate

1. \`search_memory({ query, limit: 8 })\` loads context.

## Memory & Coordination

**Continuous Calibration Protocol:**
- Store corrections.

**Task Status Gate (MANDATORY — no exceptions):**
1. Register work first.

## The Accountability Chart

Roles.

## Constraints

- NEVER create \`.md\` files for session notes — use \`store_memory()\`.
`

describe('validateAgentContent', () => {
  it('returns no violations for a compliant agent file', () => {
    expect(validateAgentContent(COMPLIANT)).toEqual([])
  })

  it('flags a missing name key in frontmatter', () => {
    const content = COMPLIANT.replace('name: test-agent\n', '')
    expect(validateAgentContent(content)).toContain('Frontmatter is missing the `name` key')
  })

  it('flags description appearing before name', () => {
    const content = COMPLIANT.replace(
      'name: test-agent\ndescription: A test agent',
      'description: A test agent\nname: test-agent',
    )
    expect(validateAgentContent(content)).toContain(
      'Frontmatter key order: `name` must appear before `description`',
    )
  })

  it.each([
    ['## Identity', '`## Identity` section heading'],
    ['## Session Start Gate', '`## Session Start Gate` section heading'],
    ['## Memory & Coordination', '`## Memory & Coordination` section heading'],
    ['## The Accountability Chart', '`## The Accountability Chart` section heading'],
    ['## Constraints', '`## Constraints` section heading (not "Hard Constraints")'],
  ])('flags a missing required section %s', (heading, label) => {
    const content = COMPLIANT.replace(heading, '## Renamed')
    expect(validateAgentContent(content)).toContain(`Missing required section: ${label}`)
  })

  it('flags a Session Start Gate without a search_memory call', () => {
    const content = COMPLIANT.replace(/search_memory/g, 'lookup_memory')
    expect(validateAgentContent(content)).toContain(
      'Session Start Gate is missing step 1: `search_memory` call to load context',
    )
  })

  it('flags a missing Continuous Calibration Protocol', () => {
    const content = COMPLIANT.replace('Continuous Calibration Protocol', 'Calibration')
    expect(validateAgentContent(content)).toContain(
      'Missing: Continuous Calibration Protocol in Memory & Coordination section',
    )
  })

  it('flags a Task Status Gate that is not marked MANDATORY', () => {
    const content = COMPLIANT.replace('MANDATORY', 'REQUIRED')
    expect(validateAgentContent(content)).toContain(
      'Missing or incorrectly named Task Status Gate — heading must contain "MANDATORY"',
    )
  })

  it('flags the forbidden "## Hard Constraints" heading', () => {
    const content = COMPLIANT.replace('## Constraints', '## Hard Constraints')
    expect(validateAgentContent(content)).toContain(
      'Section heading violation: use `## Constraints`, not `## Hard Constraints`',
    )
  })

  it('flags a Constraints section without the no-.md-files rule', () => {
    const content = COMPLIANT.replace(
      /- NEVER create .*$/m,
      '- Be kind.',
    )
    expect(validateAgentContent(content)).toContain(
      'Constraints section is missing the NEVER-create-.md-files rule referencing `store_memory()`',
    )
  })
})
