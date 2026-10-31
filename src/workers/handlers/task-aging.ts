/**
 * src/workers/handlers/task-aging.ts
 *
 * Cron handler for 'task_aging' — S17-BE-02 (#2551).
 *
 * Executes the approved aging/escalation policy (L10 2026-10-29 item 13,
 * enforced per Locksmith ruling thought 1144 / memory 3338):
 *
 *   review        7d → follow-up task pinging the resolved reviewer
 *   review       14d → follow-up task escalating to the project owner
 *   review ≥14d, unassigned → system reroute to rework (assertSystemTransition)
 *   pending-close 30d → system auto-close to done, resolution='auto_closed'
 *
 * Security invariants (Tier 3):
 *   - Runs ONLY from the CronWorker (in-process, server-side). The 'system'
 *     actor is unreachable from update_task input (P3, resolveActorRole).
 *   - Transitions go through assertSystemTransition → dedicated DB functions
 *     that re-assert the from-state atomically and write inside withActor so
 *     task_status_history/audit_log attribute to 'system:auto_close' /
 *     'system:aging'.
 *   - Recursion guard: tasks this cron created (aging_* metadata markers) are
 *     excluded from every scan.
 *   - Per-run cap on mutations (crun.runs are at-most-once; a runaway scan
 *     must not half-close the board in one tick).
 *
 * Payload: { min_days_review?: number, min_days_pending_close?: number, limit?: number }
 * All optional — defaults implement the approved policy.
 */
import type { Pool } from 'pg'
import type { RegisteredToolName } from '../../utilities/tool-registry.js'
import { createTask } from '../../db/queries/tasks.js'
import { findAgedTasks, autoCloseTask, rerouteUnassignedReviewToRework, stampTaskMetadata } from '../../db/queries/task-aging.js'
import { withActor } from '../../db/client.js'
import {
  classifyAgedTask,
  filterAgingFollowUps,
  buildFollowUpSpec,
  DEDUPE_KEYS,
  PING_REVIEWER_DAYS,
  ESCALATE_DAYS,
  AUTOCLOSE_PENDING_CLOSE_DAYS,
  type AgingDecision,
} from '../../utilities/task-aging.js'
import { assertSystemTransition, resolveReviewer, type TransitionContext } from '../../utilities/task-transitions.js'

/** Safety cap: max mutations per run across all action types. */
const MAX_MUTATIONS_PER_RUN = 25

export async function taskAgingHandler(
  _toolName: RegisteredToolName,
  payload: Record<string, unknown> | null,
  pool: Pool,
): Promise<void> {
  const minDaysReview = readPositiveInt(payload?.['min_days_review']) ?? PING_REVIEWER_DAYS
  const limit = readPositiveInt(payload?.['limit']) ?? 200

  // One scan at the lowest interesting threshold; classification re-checks
  // per-action thresholds. Uses the idx_tasks_status_age partial index.
  const candidates = filterAgingFollowUps(await findAgedTasks(minDaysReview, limit, pool))

  if (candidates.length === 0) {
    console.log('[task-aging] no aged tasks — nothing to do')
    return
  }

  const now = new Date()
  let mutations = 0
  const summary = { pinged: 0, escalated: 0, rerouted: 0, autoClosed: 0, skipped: 0 }

  for (const task of candidates) {
    if (mutations >= MAX_MUTATIONS_PER_RUN) {
      summary.skipped++
      continue
    }

    // The DB scan guarantees the task is old enough for the SCAN threshold;
    // per-action thresholds need the floor-of-days figure, which the scan
    // already returns as days_in_status.
    const decision: AgingDecision = classifyAgedTask(task)
    if (decision.action === 'none') {
      summary.skipped++
      continue
    }

    try {
      const acted = await executeDecision(task, decision, pool, now)
      if (acted) mutations++
      else summary.skipped++
    } catch (err) {
      // One bad task must not stall the queue — log and continue. The cron
      // retries on the next tick; dedupe stamps prevent double-actions for
      // everything except failed transitions (which SHOULD retry).
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[task-aging] action ${decision.action} failed for task #${String(task.id)}: ${message}`)
      summary.skipped++
    }
  }

  console.log(
    `[task-aging] run complete — scanned=${String(candidates.length)} pinged=${String(summary.pinged)} ` +
      `escalated=${String(summary.escalated)} rerouted=${String(summary.rerouted)} autoClosed=${String(summary.autoClosed)} ` +
      `skipped=${String(summary.skipped)}`,
  )
}

// ---------------------------------------------------------------------------
// Execute one classified decision. Returns true if a mutation was made.
// ---------------------------------------------------------------------------

async function executeDecision(
  task: Awaited<ReturnType<typeof findAgedTasks>>[number],
  decision: AgingDecision,
  pool: Pool,
  now: Date,
): Promise<boolean> {
  switch (decision.action) {
    case 'auto_close': {
      // Structural authorization: the matrix row + age precondition.
      const verdict = assertSystemTransition(
        { status: task.status, assignee_agent_slug: task.assignee_agent_slug, daysInStatus: task.days_in_status },
        'done',
      )
      if (!verdict.ok) {
        console.warn(`[task-aging] auto-close rejected for #${String(task.id)}: ${verdict.reason}`)
        return false
      }
      const result = await autoCloseTask(task.id)
      if (!result.closed) return false // lost the race (reviewer acted first) — fine
      // Stamp AFTER success; a failed stamp leaves the action repeatable,
      // which is safe: the transition guard re-rejects an already-done task.
      // dedupeKey is non-null for every non-'none' decision (type invariant).
      const closeKey = decision.dedupeKey
      if (closeKey) {
        await stampTaskMetadata(task.id, closeKey, { episode: task.status, at: now.toISOString() }, 'system:auto_close', pool)
      }
      console.log(`[task-aging] auto-closed #${String(task.id)} (${result.task?.title ?? ''}) — resolution=auto_closed`)
      return true
    }

    case 'reroute_rework': {
      const verdict = assertSystemTransition(
        { status: task.status, assignee_agent_slug: task.assignee_agent_slug, daysInStatus: task.days_in_status },
        'rework',
      )
      if (!verdict.ok) {
        console.warn(`[task-aging] rework reroute rejected for #${String(task.id)}: ${verdict.reason}`)
        return false
      }
      const result = await rerouteUnassignedReviewToRework(task.id)
      if (!result.rerouted) return false // assignee was just set — precondition gone
      const rerouteKey = decision.dedupeKey
      if (rerouteKey) {
        await stampTaskMetadata(task.id, rerouteKey, { episode: task.status, at: now.toISOString() }, 'system:aging', pool)
      }
      console.log(`[task-aging] rerouted unassigned review #${String(task.id)} to rework`)
      return true
    }

    case 'ping_reviewer':
    case 'escalate_owner': {
      const assignee = resolveFollowUpAssignee(task, decision.action)
      const spec = buildFollowUpSpec({
        sourceTask: task,
        kind: decision.action,
        assigneeAgentSlug: assignee,
        now,
      })
      // System actor context for attribution; createTask re-verifies project
      // ownership (the "owner" here is the project owner slug — an existing
      // agent). Follow-up creation is audited like any task INSERT.
      const created = await withActor('system:aging', () => createTask({ ...spec, owner_agent_slug: task.project_owner_agent_slug }))
      if (!created.authorized) {
        console.warn(`[task-aging] follow-up creation unauthorized for #${String(task.id)} — skipping`)
        return false
      }
      const followKey = decision.dedupeKey
      if (followKey) {
        await stampTaskMetadata(task.id, followKey, { episode: task.status, at: now.toISOString() }, 'system:aging', pool)
      }
      const verb = decision.action === 'ping_reviewer' ? 'pinged' : 'escalated'
      console.log(`[task-aging] ${verb} #${String(task.id)} → follow-up #${String(created.task.id)} for ${assignee}`)
      return true
    }

    case 'none':
      return false
  }
}

// ---------------------------------------------------------------------------
// Follow-up assignee resolution — 7d ping goes to the resolved reviewer
// (explicit reviewer, else domain default, else project owner — fail-closed).
// 14d escalation goes to the project owner. Never the assignee.
// ---------------------------------------------------------------------------

function resolveFollowUpAssignee(
  task: { assignee_agent_slug: string | null; reviewer_agent_slug: string | null; project_owner_agent_slug: string; metadata: Record<string, unknown> },
  action: 'ping_reviewer' | 'escalate_owner',
): string {
  if (action === 'escalate_owner') return task.project_owner_agent_slug

  const ctx: TransitionContext = {
    task: {
      status: 'review',
      assignee_agent_slug: task.assignee_agent_slug,
      reviewer_agent_slug: task.reviewer_agent_slug,
      project_owner_agent_slug: task.project_owner_agent_slug,
      metadata_domain: typeof task.metadata['domain'] === 'string' ? task.metadata['domain'] : undefined,
    },
    // The ping is issued BY the system, but the recipient resolution reuses
    // the same fail-closed reviewer logic as the review gate — one definition
    // of "who reviews this" across the whole machine.
    callerAgentSlug: task.project_owner_agent_slug,
  }
  const resolved = resolveReviewer(ctx)
  // Self-review guard echo: never ping the assignee about their own review.
  return resolved === task.assignee_agent_slug ? task.project_owner_agent_slug : resolved
}

function readPositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return undefined
  return value
}

// Re-export for tests and operators tuning thresholds via cron payloads.
export { PING_REVIEWER_DAYS, ESCALATE_DAYS, AUTOCLOSE_PENDING_CLOSE_DAYS, DEDUPE_KEYS }
