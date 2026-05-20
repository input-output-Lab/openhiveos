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
