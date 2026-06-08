// ---------------------------------------------------------------------------
// Tool Registry — SEC-26 binding
//
// REGISTERED_TOOL_NAMES is the canonical allowlist for the `tool_name` field
// in create_cron and update_cron. It must exactly match the set of tools
// registered via server.registerTool() in src/index.ts.
//
// Locksmith validates this list against index.ts at S4-06.
//
// When adding a new tool in a future sprint:
//   1. Register the tool in src/index.ts
//   2. Add its name to this array (maintain alphabetical order within groups)
//   3. Locksmith must re-validate at the next security review
// ---------------------------------------------------------------------------

export const REGISTERED_TOOL_NAMES = [
  // OS Primitives (migration 001)
  'get_disposition',
  'query_thoughts',
  'ratify_thought',
  'search_memory',
  'search_sops',
  'set_disposition',
  'store_memory',
  'store_thought',
  // Coordination Utilities (migration 002, ARCH-010)
  'advance_sprint',
  'create_project',
  'create_task',
  'get_project_board',
  'query_projects',
  'query_sprints',
  'query_tasks',
  'update_project',
  'update_task',
  // Cron Utilities (migration 003, ARCH-011)
  'create_cron',
  'delete_cron',
  'query_crons',
  'update_cron',
  // Ethos Utilities (ARCH-018 S8-03)
  'get_company_ethos',
  // LLM Usage Reporting (ARCH-015)
  'report_usage',
] as const

export type RegisteredToolName = (typeof REGISTERED_TOOL_NAMES)[number]
