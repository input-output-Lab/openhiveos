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
  'audit_hive',
  'generate_report',
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
  // Pipeline Trigger (multi-agent-pipeline runner on port 3010)
  'trigger_workflow',
  // Task aging/escalation cron (S17-BE-02 #2551) — cron-dispatcher-only,
  // never registered via server.registerTool (P3: system path, not agent-callable)
  'task_aging',
  // Nightly active-time worklog derivation (S17-BE-04 #2552) — same posture
  'worklog_derive',
  // Hourly hive audit + severity-threshold Slack alerts (S18-OPS-01 #2569)
  // — cron-dispatcher-only, same P3 system path
  'run_audit',
  // Ethos Utilities (ARCH-018 S8-03)
  'get_company_ethos',
  // LLM Usage Reporting (ARCH-015)
  'report_usage',
  // LLM Registry Expansion (S17-BE-05 #2573)
  'register_model',
  'add_model_alias',
] as const

export type RegisteredToolName = (typeof REGISTERED_TOOL_NAMES)[number]
