import type {
  ApiErrorCode,
  HealthResponse,
  EthosSealResponse,
  AgentsResponse,
  AgentDetail,
  AgentMonthRow,
  TaskCostRow,
  TasksResponse,
} from '../types/api'

// ---------------------------------------------------------------------------
// OpenHiveOS Dashboard API client (ARCH-012 A5)
//
// Auth: every request includes the DASHBOARD_AGENT_TOKEN bearer token.
//       The token is baked at build time via VITE_DASHBOARD_AGENT_TOKEN.
//       SEC-A2: token is not hardcoded — it comes from the build environment.
//
// Base URL: empty by default → same-origin relative paths (production).
//           In dev, Vite proxies /api/* → localhost:3005.
//           Set VITE_SQUAD_API_URL to override for cross-origin access.
// ---------------------------------------------------------------------------

const BASE_URL = (import.meta.env['VITE_SQUAD_API_URL'] as string | undefined)?.replace(/\/$/, '') ?? ''
const TOKEN = import.meta.env['VITE_DASHBOARD_AGENT_TOKEN'] as string | undefined

if (!TOKEN) {
  console.warn('[squadApi] VITE_DASHBOARD_AGENT_TOKEN is not set. All API calls will return 401.')
}

// ─── Typed API error ──────────────────────────────────────────────────────────

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
      headers: {
        'Content-Type': 'application/json',
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
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
export function getAgentBySlug(slug: string): Promise<AgentDetail> {
  return request<AgentDetail>(`/api/agents/${encodeURIComponent(slug)}`)
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
