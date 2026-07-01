import { Router } from 'express'
import { z } from 'zod'
import { withReaderRole } from '../db.js'

// ---------------------------------------------------------------------------
// /api/one — The One integration routes (ARCH-025)
//
// GET /api/one/protocols
//   Returns The One's two canonical SOPs: spawn-protocol and agent-outline.
//   Foundation for the Dashboard emanation panel.
//   DB role: openhiveos_reader — SELECT-only, enforced via withReaderRole().
//
// POST /api/one/validate-agent
//   Accepts raw agent .md content; validates against 7 machine-checkable
//   rules from the agent-outline SOP spec.
//   No DB writes — computation only. Input bounded at 64KB (OC-3).
//   SEC-C4: violations list returned; submitted content is never echoed.
//
// POST /api/one/emanate
//   Stub for the Dashboard emanation panel. Accepts brief + seat description;
//   returns spawn-protocol SOP and an empty agent .md scaffold.
//   No LLM call — The One (AI agent) performs the actual writing.
//   SEC-C5: inputs validated via Zod even in stub form.
//
// Auth: enforced upstream by authMiddleware on /api/*.
// Rate: 20 req/min via squadApiRateLimit (enforced upstream).
// ---------------------------------------------------------------------------

const router = Router()

// ---------------------------------------------------------------------------
// Source path identifiers for The One's SOPs.
// Queried by LIKE match against the source_path column (set at SOP ingest).
// These strings must match the actual filenames in seeds/sops/core/architecture/.
// ---------------------------------------------------------------------------
const ONE_SOP_SPAWN_PROTOCOL = 'one-spawn-protocol'
const ONE_SOP_AGENT_OUTLINE = 'one-agent-outline'

interface SopRow {
  id: number
  source_path: string
  title: string
  instructions: string
  category: string
}

// GET /api/one/protocols
router.get('/protocols', async (_req, res) => {
  try {
    const rows = await withReaderRole(async (client) => {
      const result = await client.query<SopRow>(
        `SELECT id, source_path, title, instructions, category
           FROM sops
          WHERE source_path LIKE $1
             OR source_path LIKE $2
          ORDER BY source_path ASC`,
        [`%${ONE_SOP_SPAWN_PROTOCOL}%`, `%${ONE_SOP_AGENT_OUTLINE}%`],
      )
      return result.rows
    })

    const spawnProtocol = rows.find((r) => r.source_path.includes(ONE_SOP_SPAWN_PROTOCOL))
    const agentOutline = rows.find((r) => r.source_path.includes(ONE_SOP_AGENT_OUTLINE))

    res.json({
      spawnProtocol: spawnProtocol
        ? { id: spawnProtocol.id, title: spawnProtocol.title, content: spawnProtocol.instructions }
        : null,
      agentOutline: agentOutline
        ? { id: agentOutline.id, title: agentOutline.title, content: agentOutline.instructions }
        : null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[one/protocols] Query error: %s', message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/one/validate-agent
// Input schema — SEC-C4 + OC-3: bounded at 64 KB, content never echoed back.
// ---------------------------------------------------------------------------
const ValidateAgentSchema = z.object({
  content: z
    .string()
    .min(1, 'content must not be empty')
    .max(65_536, 'content exceeds 64 KB maximum'),
})

// The 7 machine-checkable rules derived from the agent-outline SOP.
// Each check returns a violation string or null (compliant).
function validateAgentContent(content: string): string[] {
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

  // Rule 3: Session Start Gate must reference get_session_usage as step 3
  if (content.includes('## Session Start Gate') && !content.includes('get_session_usage')) {
    violations.push('Session Start Gate is missing step 3: `get_session_usage` call for context pressure check')
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

// POST /api/one/validate-agent
router.post('/validate-agent', (req, res) => {
  const parsed = ValidateAgentSchema.safeParse(req.body)
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => i.message)
    res.status(400).json({ error: 'Validation failed', details: errors })
    return
  }

  const violations = validateAgentContent(parsed.data.content)

  // SEC-C4: return violation list only — never echo back the submitted content
  res.json({ valid: violations.length === 0, violations })
})

// ---------------------------------------------------------------------------
// POST /api/one/emanate
// Stub — returns spawn-protocol + empty agent scaffold.
// SEC-C5: inputs validated via Zod even in stub form.
// ---------------------------------------------------------------------------
const EmanateSchema = z.object({
  brief: z.string().min(1).max(2_048, 'brief exceeds 2 048 character maximum'),
  seat: z.string().min(1).max(256, 'seat exceeds 256 character maximum'),
})

// Minimal but valid agent .md scaffold pre-filled with all required sections.
function buildAgentScaffold(seat: string): string {
  return `---
name: ""
description: ""
tools: []
agents: []
argument-hint: ""
---

## Identity

You are **[Name]** — ${seat}.

#file:[slug]/IDENTITY.md
#file:[slug]/SOUL.md

---

## Session Start Gate (MANDATORY — no exceptions)

> [Rationale specific to this agent's domain — load prior decisions and standards before any work.]

0. **If this session involves writing, reviewing, or refactoring code** → invoke the relevant skill before any other step.
1. **FIRST tool call** → \`search_memory({ query: <topic>, limit: 8 })\` — load codebase decisions and prior context
2. **SECOND tool call** → \`search_sops({ query: <topic>, limit: 3 })\` — load team's agreed process. Surface gaps rather than improvise.
3. **If generating large output** → call \`get_session_usage({ session_id })\` before starting. Flag if >70%, critical if ≥80%.

---

## Memory & Coordination (OpenHive MCP)

**After completing any work item, task, or decision — no exceptions:**
- Call \`store_memory({ content: <summary>, metadata: { type: 'codebase', agent: '[slug]' } })\`

**Thought Logging:**
- Call \`store_thought(...)\` on every decision or recommendation.

**Continuous Calibration Protocol:**
- **When corrected** → immediately \`store_memory({ content: 'CORRECTION: [wrong] → [correct]', metadata: { type: 'correction', agent: '[slug]' } })\`
- **When a pattern emerges** → \`store_memory({ content: 'PATTERN: [what worked] — use when: [trigger]', metadata: { type: 'learning', agent: '[slug]' } })\`

**Task Status Gate (MANDATORY — no exceptions):**
1. **BEFORE work** → \`update_task({ task_id, status: 'wip' })\`. No task_id? → \`create_task()\` first.
2. **AFTER work** → \`update_task({ task_id, status: 'review' })\`.
3. **Blocked** → \`update_task({ task_id, notes: 'Blocked: <reason>.' })\`.
4. Never set DONE yourself → submit \`pending-close\`.

**VS Code Session Usage Reporting:**
- Generate \`session_id\` once: \`[slug]:vscode:<Date.now()>\`
- At end: \`report_usage({ session_id, loop_index: 0, agent_slug: '[slug]', model: 'claude-sonnet-4-5', provider: 'anthropic', prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 })\`

**Failure mode:** Retry twice (500ms, 1000ms). If unavailable: *"MCP server unavailable."*

**Tool Availability Rule (HARD STOP):** Never conclude OpenHive tools are unavailable without an actual failed call. Make the call first.

---

## The Accountability Chart: Your N Core Roles

1. **[Role 1]** — [Description]
2. **[Role 2]** — [Description]
3. **[Role 3]** — [Description]
4. **[Role 4]** — [Description]
5. **[Role 5]** — [Description]

---

## Constraints

- [Constraint 1]
- NEVER create \`.md\` files in project directories for task summaries, completion notes, session records, or architectural decisions — use \`store_memory()\`. A file you create must be a deliverable the user explicitly requested.
`
}

// POST /api/one/emanate
router.post('/emanate', async (req, res) => {
  const parsed = EmanateSchema.safeParse(req.body)
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => i.message)
    res.status(400).json({ error: 'Validation failed', details: errors })
    return
  }

  const { seat } = parsed.data

  try {
    // Fetch the spawn-protocol SOP to return alongside the scaffold.
    const rows = await withReaderRole(async (client) => {
      const result = await client.query<Pick<SopRow, 'title' | 'instructions'>>(
        `SELECT title, instructions FROM sops WHERE source_path LIKE $1 LIMIT 1`,
        [`%${ONE_SOP_SPAWN_PROTOCOL}%`],
      )
      return result.rows
    })

    const spawnProtocol = rows[0]

    res.json({
      spawnProtocol: spawnProtocol
        ? { title: spawnProtocol.title, content: spawnProtocol.instructions }
        : null,
      scaffold: buildAgentScaffold(seat),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[one/emanate] Query error: %s', message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export { router as oneRouter }
