// ---------------------------------------------------------------------------
// Agent .md compliance validator (ARCH-025, agent-outline SOP v1.1.0).
//
// Pure computation — no I/O, no DB. Shared by:
//   - POST /api/one/validate-agent (src/squad-api/routes/one.ts)
//   - scripts/check-agent-protocol.ts (CI gate over agents/*.agent.md)
// ---------------------------------------------------------------------------

// The 7 machine-checkable rules derived from the agent-outline SOP.
// Returns one violation string per failed rule; an empty array means compliant.
export function validateAgentContent(content: string): string[] {
  const violations: string[] = []

  // Rule 1: Frontmatter `name` must appear before `description`
  const nameIdx = content.indexOf('name:')
  const descIdx = content.indexOf('description:')
  if (nameIdx === -1) {
    violations.push('Frontmatter is missing the `name` key')
  } else if (descIdx !== -1 && descIdx < nameIdx) {
    violations.push('Frontmatter key order: `name` must appear before `description`')
  }

  // Rule 2–6: Required section headings
  const requiredSections = [
    { heading: '## Identity', label: '`## Identity` section heading' },
    { heading: '## Session Start Gate', label: '`## Session Start Gate` section heading' },
    { heading: '## Memory & Coordination', label: '`## Memory & Coordination` section heading' },
    { heading: '## The Accountability Chart', label: '`## The Accountability Chart` section heading' },
    { heading: '## Constraints', label: '`## Constraints` section heading (not "Hard Constraints")' },
  ]
  for (const { heading, label } of requiredSections) {
    if (!content.includes(heading)) {
      violations.push(`Missing required section: ${label}`)
    }
  }

  // Rule 3: Session Start Gate must open with search_memory as FIRST tool call.
  // (v1.1.0, #2546: get_session_usage is not an OpenHive MCP tool — the old
  // check required agents to call a tool that does not exist. search_memory is
  // the real step 1 of the mandatory gate.)
  if (content.includes('## Session Start Gate') && !content.includes('search_memory')) {
    violations.push('Session Start Gate is missing step 1: `search_memory` call to load context')
  }

  // Rule 4: Continuous Calibration Protocol must be present
  if (!content.includes('Continuous Calibration Protocol')) {
    violations.push('Missing: Continuous Calibration Protocol in Memory & Coordination section')
  }

  // Rule 5: Task Status Gate heading must contain "MANDATORY"
  if (!content.includes('Task Status Gate') || !content.includes('MANDATORY')) {
    violations.push('Missing or incorrectly named Task Status Gate — heading must contain "MANDATORY"')
  }

  // Rule 6: Must not use "## Hard Constraints" (renamed to ## Constraints)
  if (content.includes('## Hard Constraints')) {
    violations.push('Section heading violation: use `## Constraints`, not `## Hard Constraints`')
  }

  // Rule 7: Constraints section must prohibit .md files for session notes
  if (
    content.includes('## Constraints') &&
    !content.includes('store_memory') &&
    !content.includes('.md files')
  ) {
    violations.push(
      'Constraints section is missing the NEVER-create-.md-files rule referencing `store_memory()`',
    )
  }

  return violations
}
