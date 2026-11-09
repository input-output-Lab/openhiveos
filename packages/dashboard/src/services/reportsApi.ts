import type { ApiErrorCode } from '../types/api'
import { SquadApiError, UNAUTHORIZED_EVENT } from './squadApi'

// ---------------------------------------------------------------------------
// Reports / Budget / Audit API client (S18-FE-01 #2561)
//
// Consumers:
//   GET /api/reports/hive?period=N          → HiveReport
//   GET /api/reports/projects/:id?period=N  → ProjectReport
//   GET /api/budget?project_id=&status=     → { internal_only, filters, data }
//   GET /api/audit/latest                   → latest audit run (score+findings)
//
// Mirrors squadApi.ts conventions: credentials:'include', typed errors,
// 401 → UNAUTHORIZED_EVENT (login gate), graceful degradation — the
// reports/audit endpoints may not be deployed yet (404) and the UI must
// show an honest "endpoint unavailable" state rather than a crash.
// ---------------------------------------------------------------------------

const BASE_URL = (import.meta.env['VITE_SQUAD_API_URL'] as string | undefined)?.replace(/\/$/, '') ?? ''

async function request<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, { credentials: 'include' })
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
    const code: ApiErrorCode | 'NOT_DEPLOYED' =
      response.status === 401 ? 'UNAUTHORIZED'
      : response.status === 404 ? 'NOT_FOUND'
      : response.status === 429 ? 'RATE_LIMITED'
      : 'INTERNAL_ERROR'
    if (code === 'UNAUTHORIZED') dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
    // 404 on these newer endpoints means "not deployed yet" (graceful degradation).
    throw new SquadApiError(response.status === 404 ? 'NOT_DEPLOYED' : code, message)
  }

  return body as T
}

// ─── Report payloads (mirror of the service shapes) ─────────────────────────

export interface ReportCoverage {
  source: string
  window_days: number
  rows: number
}

export interface ReportSection<T> {
  name: string
  coverage: ReportCoverage
  data: T
  emptyNote: string
}

export interface ProjectReport {
  scope: 'project'
  project_id: number
  period_days: number
  generated_at: string
  sections: Record<string, ReportSection<unknown>>
}

export interface HiveReport {
  scope: 'hive'
  period_days: number
  generated_at: string
  sections: Record<string, ReportSection<unknown>>
}

export type Report = ProjectReport | HiveReport

export function getProjectReport(projectId: number, period: number): Promise<ProjectReport> {
  return request<ProjectReport>(`/api/reports/projects/${encodeURIComponent(String(projectId))}?period=${period}`)
}

export function getHiveReport(period: number): Promise<HiveReport> {
  return request<HiveReport>(`/api/reports/hive?period=${period}`)
}

// ─── Budget ──────────────────────────────────────────────────────────────────

export interface BudgetTaskRow {
  task_id: number
  title: string
  project_id: number
  project_name: string
  assignee_agent_slug: string | null
  status: string
  estimated_hours: number | null
  billing_low: number | null
  billing_high: number | null
  actual_hours: number
  actual_hours_split: { auto: number; human: number }
  hours_variance_pct: number | null
  llm_cost_usd: number
  llm_request_count: number
}

export interface BudgetProjectRow {
  project_id: number
  project_name: string
  task_count: number
  estimated_hours: number
  actual_hours: number
  llm_cost_usd: number
}

export interface BudgetResponse {
  internal_only: boolean
  filters: { project_id: number | null; status: string | null }
  data: { tasks: BudgetTaskRow[]; projects: BudgetProjectRow[] }
}

export function getBudget(projectId?: number): Promise<BudgetResponse> {
  const q = projectId ? `?project_id=${projectId}` : ''
  return request<BudgetResponse>(`/api/budget${q}`)
}

// ─── Audit ───────────────────────────────────────────────────────────────────

export interface AuditFinding {
  id: string
  severity: 'info' | 'warn' | 'critical'
  pass: boolean
  evidence: string
  count: number
}

export interface AuditRun {
  run_id: number
  score: number
  duration_ms: number
  invariants_run: number
  findings: AuditFinding[]
}

/** GET /api/audit/latest — may 404 until the audit REST glue deploys. */
export function getLatestAudit(): Promise<AuditRun> {
  return request<AuditRun>('/api/audit/latest')
}
