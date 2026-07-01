// Shared types for OS Primitives.
// AgentName is a plain string — agent rosters are defined per Squad in
// squad.manifest.json (ARCH-006 PROD-1), not hardcoded here.
export type AgentName = string

export type ThoughtType =
  | 'analysis'
  | 'concern'
  | 'decision'
  | 'hypothesis'
  | 'realization'
  | 'pushback'

export type ThoughtIntensity = 'signal' | 'caution' | 'block'

export interface Memory {
  id: number
  agent_slug: string
  task_id: number | null
  content: string
  metadata: Record<string, unknown>
  created_at: Date
  similarity?: number
  bm25_score?: number
}

export interface Sop {
  id: number
  category: string
  agent: string | null
  instruction: string
  source_path: string | null
  created_at: Date
  updated_at: Date
  similarity?: number
}

export interface CounterThought {
  primary_thought_summary: string
  challenge: string
  basis: string
  must_surface: boolean
  intensity: ThoughtIntensity
}

export interface AgentThought {
  id: number
  agent_slug: string
  session_id: string | null
  task_id: number | null
  thought: string
  thought_type: ThoughtType
  confidence: number | null
  raw_behavior: string | null
  expressed_behavior: string | null
  disposition_snapshot: Record<string, unknown> | null
  must_surface: boolean
  auto_persist_candidate: boolean
  ratified_by: string | null
  ratified_at: Date | null
  auto_persisted: boolean
  counter_thought: CounterThought | null
  metadata: Record<string, unknown>
  created_at: Date
  similarity?: number
}

export interface DispositionProfile {
  agent_slug: string
  assertiveness: number
  energy: number
  patience: number
  formality: number
  candor_floor: number
  updated_at: Date
  updated_by: string | null
}

// ---------------------------------------------------------------------------
// Coordination Utility types (introduced in migration 002)
// ---------------------------------------------------------------------------

export type ProjectStatus = 'active' | 'archived'

export type TaskStatus = 'todo' | 'wip' | 'review' | 'done' | 'rework' | 'pending-close'

export interface Project {
  id: number
  slug: string
  name: string
  description: string | null
  status: ProjectStatus
  owner_agent_slug: string
  business_value: 1 | 3 | 5 | null
  strategic_fit: 1 | 3 | 5 | null
  effort: 1 | 3 | 5 | null
  risk_index: 1 | 3 | 5 | null
  roi_score?: number | null
  created_at: Date
  updated_at: Date
}

export interface Task {
  id: number
  project_id: number
  title: string
  description: string | null
  status: TaskStatus
  assignee_agent_slug: string | null
  github_pr_url: string | null
  notes: string | null
  metadata: Record<string, unknown>
  created_at: Date
  updated_at: Date
}

export interface Sprint {
  id: number
  project_id: number
  sprint_number: number
  sprint_goal: string | null
  started_at: Date
  created_at: Date
}

export interface TaskSummary {
  id: number
  title: string
  status: TaskStatus
  assignee_agent_slug: string | null
  github_pr_url: string | null
  notes: string | null
  created_at: Date
  updated_at: Date
}

export interface ProjectBoard extends Project {
  todo_count: number
  wip_count: number
  review_count: number
  done_count: number
  rework_count: number
  tasks: TaskSummary[]
}

// ---------------------------------------------------------------------------
// Cron Utility types (introduced in migration 003)
// Sprint 4 ships the registration layer only. last_run_at is always null
// until the Sprint 5 cron worker is delivered.
// ---------------------------------------------------------------------------

export type CronStatus = 'active' | 'paused' | 'deleted'

export interface Cron {
  id: number
  project_id: number
  owner_agent_slug: string
  name: string
  description: string | null
  schedule: string
  tool_name: string
  payload: Record<string, unknown> | null
  status: CronStatus
  last_run_at: Date | null
  created_at: Date
  updated_at: Date
}
