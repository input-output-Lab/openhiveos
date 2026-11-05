import type {
  ApiErrorCode,
  HealthResponse,
  EthosSealResponse,
  AgentsResponse,
  AgentDetail,
  AgentDetailResponse,
  AgentMonthRow,
  TaskCostRow,
  TasksResponse,
  TaskDetailResponse,
  ProjectsResponse,
  ProjectDetailResponse,
  SprintsResponse,
  SopsResponse,
  ThoughtsResponse,
  IntegrationsStatusResponse,
  TriggerSyncResponse,
  TriageInboxResponse,
} from '../types/api'

// ---------------------------------------------------------------------------
// OpenHiveOS Dashboard API client (ARCH-012 A5)
//
// Auth: browser session cookie (S18-SEC-03 #2642).
//       The build-time-baked VITE_DASHBOARD_AGENT_TOKEN is RETIRED —
//       no credential exists in the bundle. The browser obtains an
//       HttpOnly session cookie via POST /api/auth/login (human password),
//       and every API call sends it with credentials: 'include'.
//       On 401 the client dispatches 'squadapi:unauthorized' so the app
//       shell can surface a login gate; calls succeed again after login.
//
// Base URL: empty by default → same-origin relative paths (production).
//           In dev, Vite proxies /api/* → localhost:3005.
//           Set VITE_SQUAD_API_URL to override for cross-origin access
//           (server must allow that origin's credentials).
// ---------------------------------------------------------------------------

const BASE_URL = (import.meta.env['VITE_SQUAD_API_URL'] as string | undefined)?.replace(/\/$/, '') ?? ''

/** Fired on any 401 — the app shell listens to surface the login gate. */
export const UNAUTHORIZED_EVENT = 'squadapi:unauthorized'

// ─── Typed API error ───────────────────────────────────────────────────────────

export class SquadApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode | 'NETWORK_ERROR' | 'UNKNOWN',
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message)
    this.name = 'SquadApiError'
  }
}

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      ...init,
    })
  } catch {
    throw new SquadApiError('NETWORK_ERROR', 'Unable to reach OpenHiveOS squad-api. Check your connection.')
  }

  let body: unknown

  try {
    body = await response.json()
  } catch {
    throw new SquadApiError('UNKNOWN', `Unexpected response from squad-api (HTTP ${response.status}).`)
  }

  if (!response.ok) {
    const errBody = body as { error?: string; message?: string }
    const message = errBody.error ?? errBody.message ?? `HTTP ${response.status}`
    const code: ApiErrorCode =
      response.status === 401 ? 'UNAUTHORIZED' :
      response.status === 404 ? 'NOT_FOUND' :
      response.status === 429 ? 'RATE_LIMITED' :
      'INTERNAL_ERROR'
    if (code === 'UNAUTHORIZED') {
      // Central signal for the login gate (S18-SEC-03 #2642).
      dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
    }
    throw new SquadApiError(code, message)
  }

  return body as T
}

// ─── Health ──────────────────────────────────────────────────────────────────

/** System health probe — unauthenticated. Returns degraded on DB/schema failure. */
export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health')
}

// ─── Agents ──────────────────────────────────────────────────────────────────

/** Provisioned agent roster — slug, display_name, active status, timestamps, active_task_count. */
export function getAgents(): Promise<AgentsResponse> {
  return request<AgentsResponse>('/api/agents')
}

/** Agent detail — DB row + manifest role composite. 404 → SquadApiError(NOT_FOUND). */
export function getAgentBySlug(slug: string): Promise<AgentDetailResponse> {
  return request<AgentDetailResponse>(`/api/agents/${encodeURIComponent(slug)}`)
}

// ─── Ethos Seal ───────────────────────────────────────────────────────────────

/** Fetch active seal metadata + last 10 deactivated versions */
export function getEthosSeal(): Promise<EthosSealResponse> {
  return request<EthosSealResponse>('/api/ethos-seal')
}

/**
 * Fetch full seal including payload JSONB — operator only, same auth tier.
 * Returns { active: null, history: [] } when no seal has been initialised yet
 * (backend 404) so the view can show the "run one-init" prompt instead of an error.
 */
export async function getEthosSealWithPayload(): Promise<EthosSealResponse> {
  try {
    return await request<EthosSealResponse>('/api/ethos-seal?include=payload')
  } catch (err) {
    if (err instanceof SquadApiError && err.code === 'NOT_FOUND') {
      return { active: null, history: [] }
    }
    throw err
  }
}

// ─── Usage ────────────────────────────────────────────────────────────────────
//
// Backend response shapes differ from the client's public return types.
// Each function unwraps the backend envelope before returning.
// Backend contract (ARCH-015):
//   GET /api/usage/agents       → { months: number, data: AgentMonthRow[] }
//   GET /api/usage/agents/:slug → { agent_slug: string, data: AgentMonthRow[] }
//   GET /api/usage/tasks/:id    → TaskCostRow (single object, not an array)

/** Monthly cost aggregates for all agents. months defaults to 6, max 24. */
export async function getAgentUsage(months = 6): Promise<AgentMonthRow[]> {
  const body = await request<{ months: number; data: AgentMonthRow[] }>(`/api/usage/agents?months=${months}`)
  return body.data
}

/** Monthly detail for a single agent slug. Returns 404 → SquadApiError if no data. */
export async function getAgentUsageDetail(slug: string): Promise<AgentMonthRow[]> {
  const body = await request<{ agent_slug: string; data: AgentMonthRow[] }>(`/api/usage/agents/${encodeURIComponent(slug)}`)
  return body.data
}

/** Task-level cost breakdown. Returns 404 → SquadApiError if no data. */
export async function getTaskCost(taskId: number): Promise<TaskCostRow[]> {
  const row = await request<TaskCostRow>(`/api/usage/tasks/${taskId}`)
  return [row]
}

// ─── Tasks ──────────────────────────────────────────────────────────────────────────────────

export interface GetTasksParams {
  status?: string
  assignee?: string
  project_id?: number
  limit?: number
  offset?: number
}

/** Paginated task roster. status/assignee/project_id are optional filters. */
export function getTasks(params: GetTasksParams = {}): Promise<TasksResponse> {
  const q = new URLSearchParams()
  if (params.status)                         q.set('status', params.status)
  if (params.assignee)                       q.set('assignee', params.assignee)
  if (params.project_id != null)             q.set('project_id', String(params.project_id))
  if (params.limit != null)                  q.set('limit', String(params.limit))
  if (params.offset != null)                 q.set('offset', String(params.offset))
  const qs = q.toString()
  return request<TasksResponse>(`/api/tasks${qs ? `?${qs}` : ''}`)
}

/** Single task by id — includes description. 404 → SquadApiError(NOT_FOUND). */
export function getTaskById(id: number): Promise<TaskDetailResponse> {
  return request<TaskDetailResponse>(`/api/tasks/${id}`)
}

// ─── Projects ──────────────────────────────────────────────────────────────────

export interface GetProjectsParams {
  status?: 'active' | 'archived'
  owner?: string
  limit?: number
  offset?: number
}

/** Paginated project list. Defaults to status=active. */
export function getProjects(params: GetProjectsParams = {}): Promise<ProjectsResponse> {
  const q = new URLSearchParams()
  if (params.status)         q.set('status', params.status)
  if (params.owner)          q.set('owner', params.owner)
  if (params.limit != null)  q.set('limit', String(params.limit))
  if (params.offset != null) q.set('offset', String(params.offset))
  const qs = q.toString()
  return request<ProjectsResponse>(`/api/projects${qs ? `?${qs}` : ''}`)
}

/** Project detail with open_task_count + current_sprint. 404 → SquadApiError(NOT_FOUND). */
export function getProjectBySlug(slug: string): Promise<ProjectDetailResponse> {
  return request<ProjectDetailResponse>(`/api/projects/${encodeURIComponent(slug)}`)
}

/** Paginated sprint history for a project. 404 → SquadApiError(NOT_FOUND) if project not found. */
export function getProjectSprints(slug: string, params: { limit?: number; offset?: number } = {}): Promise<SprintsResponse> {
  const q = new URLSearchParams()
  if (params.limit != null)  q.set('limit', String(params.limit))
  if (params.offset != null) q.set('offset', String(params.offset))
  const qs = q.toString()
  return request<SprintsResponse>(`/api/projects/${encodeURIComponent(slug)}/sprints${qs ? `?${qs}` : ''}`)
}

/** Update portfolio matrix fields for a project. Returns updated project with recomputed roi_score. */
export async function patchProject(
  slug: string,
  updates: {
    business_value?: number | null
    strategic_fit?: number | null
    effort?: number | null
    risk_index?: number | null
  },
): Promise<ProjectDetailResponse> {
  return request<ProjectDetailResponse>(
    `/api/projects/${encodeURIComponent(slug)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(updates),
    },
  )
}

// ─── SOPs ──────────────────────────────────────────────────────────────────────

export interface GetSopsParams {
  category?: string
  agent?: string
  limit?: number
  offset?: number
}

/** Paginated SOP list. category must match VALID_CATEGORIES on server. */
export function getSops(params: GetSopsParams = {}): Promise<SopsResponse> {
  const q = new URLSearchParams()
  if (params.category)       q.set('category', params.category)
  if (params.agent)          q.set('agent', params.agent)
  if (params.limit != null)  q.set('limit', String(params.limit))
  if (params.offset != null) q.set('offset', String(params.offset))
  const qs = q.toString()
  return request<SopsResponse>(`/api/sops${qs ? `?${qs}` : ''}`)
}

// ─── Thoughts ────────────────────────────────────────────────────────────────

export interface GetThoughtsParams {
  agent_slug?: string
  thought_type?: string
  must_surface?: boolean
  limit?: number
  offset?: number
}

/** Paginated thought list. Filter by agent_slug for the reasoning ledger. */
export function getThoughts(params: GetThoughtsParams = {}): Promise<ThoughtsResponse> {
  const q = new URLSearchParams()
  if (params.agent_slug)            q.set('agent_slug', params.agent_slug)
  if (params.thought_type)          q.set('thought_type', params.thought_type)
  if (params.must_surface != null)  q.set('must_surface', String(params.must_surface))
  if (params.limit != null)         q.set('limit', String(params.limit))
  if (params.offset != null)        q.set('offset', String(params.offset))
  const qs = q.toString()
  return request<ThoughtsResponse>(`/api/thoughts${qs ? `?${qs}` : ''}`)
}

// ─── Integrations ───────────────────────────────────────────────────────────────

/** Fetch integration status for all providers — health, queue stats, last error. */
export function getIntegrationsStatus(): Promise<IntegrationsStatusResponse> {
  return request<IntegrationsStatusResponse>('/api/integrations/status')
}

/** Manually trigger a sync for a specific provider. Returns { status, message }. */
export function triggerIntegrationSync(provider: string): Promise<TriggerSyncResponse> {
  return request<TriggerSyncResponse>(
    '/api/integrations/trigger-sync',
    {
      method: 'POST',
      body: JSON.stringify({ provider }),
    },
  )
}

/** Fetch triage inbox — tasks with status='triage' pending agent promotion. */
export function getTriageInbox(): Promise<TriageInboxResponse> {
  return request<TriageInboxResponse>('/api/integrations/triage')
}
