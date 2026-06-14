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

// ARCH-020: manifest includes role, skills, owns, works_with (TC-SA11b)
export interface AgentManifest {
  role: string
  skills: string[]
  owns: string[]
  works_with: string[]
}

export interface AgentDetail extends AgentRow {
  manifest: AgentManifest | null
}

export interface AgentsResponse {
  agents: AgentRow[]
}

export interface AgentDetailResponse {
  agent: AgentDetail
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

/** GET /api/tasks/:id — single task with full fields */
export interface TaskDetail extends TaskRow {
  // All fields already present on TaskRow — alias for semantic clarity
}

export interface TaskDetailResponse {
  task: TaskDetail
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export type ProjectStatus = 'active' | 'archived'

/** Portfolio matrix value domain: 1=Low, 3=Medium, 5=High (or null if not yet scored) */
export type PortfolioValue = 1 | 3 | 5 | null

export interface ProjectRow {
  id: number
  slug: string
  name: string
  description: string | null
  status: ProjectStatus
  owner_agent_slug: string | null
  business_value: PortfolioValue
  strategic_fit: PortfolioValue
  effort: PortfolioValue
  risk_index: PortfolioValue
  roi_score: number | null  // Computed: (business_value * strategic_fit) / effort, null if any component is null
  created_at: string
  updated_at: string
}

export interface ProjectMeta {
  limit: number
  offset: number
  has_more: boolean
}

export interface ProjectsResponse {
  data: ProjectRow[]
  meta: ProjectMeta
}

export interface SprintSummary {
  sprint_number: number
  sprint_goal: string | null
  started_at: string | null
}

export interface ProjectDetail extends ProjectRow {
  open_task_count: number
  current_sprint: SprintSummary | null
}

export interface ProjectDetailResponse {
  project: ProjectDetail
}

export interface SprintsResponse {
  data: SprintSummary[]
  meta: ProjectMeta
}

// ─── SOPs ─────────────────────────────────────────────────────────────────────

export interface SopRow {
  id: number
  source_path: string | null
  display_name: string
  category: string
  agent: string | null
  preview: string
  created_at: string
  updated_at: string
}

export interface SopsPagination {
  limit: number
  offset: number
  has_more: boolean
}

export interface SopsResponse {
  sops: SopRow[]
  pagination: SopsPagination
}
// ─── Thoughts ────────────────────────────────────────────────────────────────

export type ThoughtType =
  | 'analysis'
  | 'concern'
  | 'decision'
  | 'hypothesis'
  | 'realization'
  | 'pushback'

export interface ThoughtRow {
  id: number
  agent_slug: string
  session_id: string | null
  task_id: number | null
  thought: string
  thought_type: ThoughtType
  confidence: number | null
  must_surface: boolean
  counter_thought: string | null
  created_at: string
}

export interface ThoughtsPagination {
  limit: number
  offset: number
  has_more: boolean
}

export interface ThoughtsResponse {
  thoughts: ThoughtRow[]
  pagination: ThoughtsPagination
}

// ─── Integrations ─────────────────────────────────────────────────────────────

export type IntegrationStatus = 'healthy' | 'degraded' | 'failed'
export type IntegrationProvider = 'clickup' | 'jira' | 'github' | 'linear'

export interface IntegrationProviderStatus {
  provider: IntegrationProvider
  enabled: boolean
  last_sync: string | null          // ISO 8601
  pending_count: number
  failed_count: number
  failed_oldest_at: string | null   // ISO 8601
  last_error: string | null
  status: IntegrationStatus
}

export interface IntegrationsStatusResponse {
  timestamp: string                 // ISO 8601
  providers: IntegrationProviderStatus[]
  summary: {
    total_pending: number
    total_failed: number
    status: IntegrationStatus
  }
}

export interface TriggerSyncResponse {
  status: 'queued' | 'error'
  message: string
}

// ─── Triage Inbox ─────────────────────────────────────────────────────────────

export type TriageTaskSyncState = 'in_sync' | 'drift' | 'error'

export interface TriageTaskExternalLink {
  provider: string
  external_id: string
  external_url: string | null
  sync_state: TriageTaskSyncState
  last_synced_at: string | null
}

export interface TriageTask {
  id: string
  title: string
  description: string | null
  external_links: TriageTaskExternalLink[]
  created_at: string
}

export interface TriageInboxResponse {
  count: number
  tasks: TriageTask[]
}