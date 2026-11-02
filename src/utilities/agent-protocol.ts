// ---------------------------------------------------------------------------
// OpenHive protocol sync (agent-outline SOP v1.1.0, section 5).
//
// agents/shared/openhive-protocol.md is the single source of truth for the
// coordination protocol block every agent file carries. This module extracts
// that block, renders the `<slug>` placeholder for a given agent, and checks
// that an agent file contains the rendered block verbatim.
//
// Pure computation — no I/O. Used by scripts/check-agent-protocol.ts (CI).
// ---------------------------------------------------------------------------

export const PROTOCOL_START = '<!-- openhive-protocol:start -->'
export const PROTOCOL_END = '<!-- openhive-protocol:end -->'
export const SLUG_PLACEHOLDER = '<slug>'

// Returns the trimmed text between the start and end markers of the include.
// Throws if the markers are missing, duplicated, or out of order — a malformed
// include must fail loudly rather than silently check nothing.
export function extractProtocolBlock(includeSource: string): string {
  const start = includeSource.indexOf(PROTOCOL_START)
  const end = includeSource.indexOf(PROTOCOL_END)
  if (start === -1 || end === -1) {
    throw new Error(`Protocol include is missing ${PROTOCOL_START} or ${PROTOCOL_END}`)
  }
  if (
    includeSource.indexOf(PROTOCOL_START, start + 1) !== -1 ||
    includeSource.indexOf(PROTOCOL_END, end + 1) !== -1
  ) {
    throw new Error('Protocol include contains duplicate protocol markers')
  }
  if (end < start) {
    throw new Error('Protocol include end marker appears before start marker')
  }
  return includeSource.slice(start + PROTOCOL_START.length, end).trim()
}

// Replaces every `<slug>` placeholder with the agent's slug.
export function renderProtocolBlock(block: string, slug: string): string {
  return block.split(SLUG_PLACEHOLDER).join(slug)
}

// Returns one violation when the agent file does not contain the rendered block
// verbatim; an empty array when it is in sync.
export function checkAgentProtocol(agentContent: string, slug: string, block: string): string[] {
  const rendered = renderProtocolBlock(block, slug)
  if (agentContent.includes(rendered)) {
    return []
  }
  return [
    `Protocol block is out of sync with agents/shared/openhive-protocol.md (expected the rendered block verbatim for slug "${slug}")`,
  ]
}

// Maps `one.agent.md` to `one`. Returns null for files that are not agent files.
export function slugFromFilename(filename: string): string | null {
  const match = /^(.+)\.agent\.md$/.exec(filename)
  return match?.[1] ?? null
}
