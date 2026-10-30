import type { TaskStatus } from '../types.js'

// ---------------------------------------------------------------------------
// task-transitions.ts — S17-BE-01 (#2555): the task state machine.
//
// Tier 3 / Locksmith-reviewed (ruling: memory 3302, thought 1117; 2026-10-30).
// Changes to TRANSITIONS, resolveReviewer, or resolveApprover require
// Locksmith sign-off at PR-open — this module is the authorization backbone.
//
// Threat model (why this module exists): the status state machine is the
// hive's authorization backbone. A bypass means an agent self-approves its
// own work (integrity), a reviewer rubber-stamps their own submission
// (self-review), or a task closes without the accountable approver seeing it
// (accountability). Every rule here is fail-closed.
//
// Actor roles:
//   owner     — project owner (elizabeth for project 70; per-project generally)
//   assignee  — the agent the task is assigned to
//   reviewer  — resolved per reviewer_agent_slug / domain defaults (P2)
//   approver  — elizabeth always; nova for tasks owned-by elizabeth
//   system    — reserved server-side identity (cron auto-close). NEVER derived
//               from update_task input (P3).
// ---------------------------------------------------------------------------

export type ActorRole = 'owner' | 'assignee' | 'reviewer' | 'approver' | 'system'

// ---------------------------------------------------------------------------
// The transition table (ruling P4: monotonic forward flow, no skips)
// ---------------------------------------------------------------------------
//   todo           → wip                 assignee
//   wip            → review              assignee
//   review         → pending-close       reviewer
//   review         → rework              reviewer
//   rework         → wip                 assignee
//   pending-close  → done                approver (elizabeth; nova for elizabeth's tasks)
//   pending-close  → done                system    (cron auto-close ONLY — never via update_task input)
//
// Everything else is rejected. Notably: no skips (wip→done, review→done,
// wip→pending-close), no assignee back-transitions (review→wip,
// pending-close→review), no assignee→done (P1).
export const TRANSITIONS: ReadonlyArray<{
  from: TaskStatus
  to: TaskStatus
  role: ActorRole
}> = [
  { from: 'todo', to: 'wip', role: 'assignee' },
  { from: 'todo', to: 'wip', role: 'owner' },
  { from: 'wip', to: 'review', role: 'assignee' },
  { from: 'wip', to: 'review', role: 'owner' },
  { from: 'review', to: 'pending-close', role: 'reviewer' },
  { from: 'review', to: 'rework', role: 'reviewer' },
  { from: 'rework', to: 'wip', role: 'assignee' },
  { from: 'rework', to: 'wip', role: 'owner' },
  { from: 'pending-close', to: 'done', role: 'approver' },
  { from: 'pending-close', to: 'done', role: 'system' },
]

// ---------------------------------------------------------------------------
// Domain defaults for reviewer resolution (ruling P2: fail closed)
// ---------------------------------------------------------------------------
export const REVIEWER_DOMAIN_DEFAULTS: Readonly<Record<string, string>> = {
  // domain classification → reviewer slug (D6, L10 2026-10-29)
  arch: 'silas',
  security: 'locksmith',
  qa: 'scout',
  docs: 'clarence',
  // else → project owner (fail-closed default)
}

export interface TransitionContext {
  task: {
    status: TaskStatus
    assignee_agent_slug: string | null
    reviewer_agent_slug: string | null
    project_owner_agent_slug: string
    project_owner_is_elizabeth?: boolean
    metadata_domain?: string | undefined
  }
  callerAgentSlug: string
}

export type RoleResolution =
  | { ok: false; reason: string }
  | { ok: true; role: ActorRole }

// ---------------------------------------------------------------------------
// resolveActorRole — derive the caller's role for THIS task, fail-closed.
//
// Order matters and is part of the security property: a caller is evaluated
// as approver/reviewer only via explicit resolution — never by assuming a
// broader role. An unknown caller gets NO role (rejected).
// ---------------------------------------------------------------------------
export function resolveActorRole(ctx: TransitionContext, target: TaskStatus): RoleResolution {
  const { task, callerAgentSlug } = ctx

  // P3: 'system' is not derivable from a caller slug — the cron path bypasses
  // this module with an explicit server-side role assertion.
  if (callerAgentSlug === 'system') {
    return { ok: false, reason: "The 'system' identity is reserved for server-side automation and cannot act via update_task." }
  }

  const isOwner = task.project_owner_agent_slug === callerAgentSlug
  const isAssignee = task.assignee_agent_slug === callerAgentSlug
  const resolvedReviewer = resolveReviewer(ctx)

  // Approver check FIRST: pending-close → done is approver-only.
  // Approver = elizabeth; for tasks owned by elizabeth, nova (ruling P1/D5).
  if (target === 'done') {
    const approver = resolveApprover(ctx)
    if (callerAgentSlug === approver) return { ok: true, role: 'approver' }
    // Fall through — an approver-candidate failing does NOT get downgraded to
    // another role that might also permit this transition (none do, but the
    // explicit rejection keeps the audit message honest).
    return { ok: false, reason: `Only ${approver} may approve pending-close → done for this task.` }
  }

  // Reviewer transitions: review → pending-close | rework
  if (task.status === 'review' && (target === 'pending-close' || target === 'rework')) {
    if (!isOwner && !isAssignee && callerAgentSlug === resolvedReviewer) {
      return { ok: true, role: 'reviewer' }
    }
    // P2 anti-patterns get specific rejections for audit clarity:
    if (isAssignee && callerAgentSlug === resolvedReviewer) {
      return { ok: false, reason: 'Self-review blocked: caller is both assignee and resolved reviewer.' }
    }
    if (isAssignee) {
      return { ok: false, reason: `Reviewer (${resolvedReviewer}) gates review → ${target}. The assignee cannot review their own submission.` }
    }
  }

  // Assignee transitions: todo→wip, wip→review, rework→wip
  if (
    (task.status === 'todo' && target === 'wip') ||
    (task.status === 'wip' && target === 'review') ||
    (task.status === 'rework' && target === 'wip')
  ) {
    if (isAssignee || isOwner) {
      return { ok: true, role: isOwner ? 'owner' : 'assignee' }
    }
    return { ok: false, reason: `Only the assignee or project owner may move this task to ${target}.` }
  }

  // Anything else: no rule permits it (P4 monotonicity).
  return { ok: false, reason: `Transition ${task.status} → ${target} is not permitted by the state machine.` }
}

// ---------------------------------------------------------------------------
// resolveReviewer — who gates review → pending-close | rework for this task.
// Fail-closed: explicit reviewer_agent_slug (if valid and not self-review),
// else domain default, else PROJECT OWNER. Never the caller by omission.
// ---------------------------------------------------------------------------
export function resolveReviewer(ctx: TransitionContext): string {
  const { task } = ctx

  // P2: explicit reviewer on the task wins — unless it would be self-review.
  if (task.reviewer_agent_slug && task.reviewer_agent_slug !== task.assignee_agent_slug) {
    return task.reviewer_agent_slug
  }

  // Domain default from task metadata (optional classification).
  const domain = task.metadata_domain
  if (domain && REVIEWER_DOMAIN_DEFAULTS[domain]) {
    const byDomain = REVIEWER_DOMAIN_DEFAULTS[domain]
    if (byDomain !== task.assignee_agent_slug) return byDomain
  }

  // Fail closed → project owner.
  return task.project_owner_agent_slug
}

// ---------------------------------------------------------------------------
// resolveApprover — who confirms pending-close → done.
// elizabeth approves done; for tasks owned by elizabeth, nova (D5).
// ---------------------------------------------------------------------------
export function resolveApprover(ctx: TransitionContext): string {
  return ctx.task.project_owner_agent_slug === 'elizabeth' ? 'nova' : 'elizabeth'
}

// ---------------------------------------------------------------------------
// assertTransition — the single decision point used by handleUpdateTask.
// Returns the resolved role on success, or a rejection reason.
// The rejection reason is safe to log to task_status_history (ruling P5):
// it names roles and slugs, never secrets.
// ---------------------------------------------------------------------------
export function assertTransition(
  ctx: TransitionContext,
  target: TaskStatus,
): { ok: true; role: ActorRole } | { ok: false; reason: string } {
  const role = resolveActorRole(ctx, target)
  if (!role.ok) return role

  // The resolved role must actually hold this transition in the table.
  const permitted = TRANSITIONS.some((t) => t.from === ctx.task.status && t.to === target && t.role === role.role)
  if (!permitted) {
    return { ok: false, reason: `Transition ${ctx.task.status} → ${target} as ${role.role} is not permitted by the state machine.` }
  }
  return role
}
