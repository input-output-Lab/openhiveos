// ---------------------------------------------------------------------------
// OpenHiveOS squad-api — client type definitions (ARCH-012)
//
// These types mirror the server-side response shapes from squad-api routes.
// Keep in sync with:
//   src/squad-api/routes/ethos-seal.ts   → EthosSeal*
//   src/squad-api/routes/usage.ts        → AgentMonthRow, TaskRow
// ---------------------------------------------------------------------------

// ─── Shared response envelope ─────────────────────────────────────────────────

export type ApiErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'

export interface ApiSuccess<T> {
  success: true
  data: T
}

export interface ApiError {
  success: false
  error: {
    code: ApiErrorCode
    message: string
    fields?: Record<string, string>
  }
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError

// ─── Ethos Seal ───────────────────────────────────────────────────────────────

export interface EthosSealMeta {
  version: number
  signature: string
  activated_at: string   // ISO 8601
  activated_by: string
}

export interface EthosSealFull extends EthosSealMeta {
  // payload is the JSONB content of the Ethos Seal — structure is operator-defined.
  // We treat it as unknown and render it as structured prose when keys are known.
  payload: unknown
}

export interface EthosSealResponse {
  active: EthosSealMeta | EthosSealFull | null
  history: EthosSealMeta[]
}

// ─── Health ───────────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: 'ok' | 'degraded'
  service: string
  db: 'connected' | 'error'
  schema: 'ok' | 'degraded'
  missing_tables?: string[]
  error?: string
}

// ─── Agents ──────────────────────────────────────────────────────────────────

export interface AgentRow {
  slug: string
  display_name: string
  active: boolean
  updated_at: string              // ISO 8601 — proxy for last token rotation
  last_used_at: string | null     // ISO 8601 or null if never authenticated
  active_task_count: number       // SEC-C6: LEFT JOIN tasks, COALESCE to 0
}

export interface AgentManifest {
  role: string
}

export interface AgentDetail extends AgentRow {
  manifest: AgentManifest | null
}

export interface AgentsResponse {
  agents: AgentRow[]
}

// ─── Usage / LLM cost ─────────────────────────────────────────────────────────

/** Row from v_cost_by_agent_month — node-postgres returns COUNT/SUM as strings */
export interface AgentMonthRow {
  agent_slug: string
  month: string          // ISO date string from TIMESTAMPTZ
  session_count: string
  prompt_tokens: string
  completion_tokens: string
  cost_usd: string
}

/** Row from v_cost_by_task */
export interface TaskCostRow {
  task_id: string
  task_title: string
  project_name: string
  assigned_agent: string | null
  request_count: string
  total_tokens: string
  cost_usd: string
  first_activity: string | null
  last_activity: string | null
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export type TaskStatus = 'todo' | 'wip' | 'review' | 'done' | 'rework'

export interface TaskRow {
  id: number
  project_id: number
  project_slug: string | null
  title: string
  description: string | null
  status: TaskStatus
  assignee_agent_slug: string | null
  github_pr_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface TasksResponse {
  tasks: TaskRow[]
  pagination: {
    limit: number
    offset: number
    has_more: boolean
  }
}
