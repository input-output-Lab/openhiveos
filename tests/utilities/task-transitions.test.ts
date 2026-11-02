import { describe, it, expect } from 'vitest'
import {
  assertTransition,
  resolveReviewer,
  resolveApprover,
  type TransitionContext,
} from '../../src/utilities/task-transitions.js'
import type { TaskStatus } from '../../src/types.js'

// ---------------------------------------------------------------------------
// S17-BE-01 (#2555) — transition matrix tests.
// 14-case minimum per Locksmith Tier-3 ruling (memory 3302): 7 valid paths,
// 7+ rejections. Every case maps to a fail-closed property P1–P5.
// ---------------------------------------------------------------------------

function ctx(overrides: {
  status?: TaskStatus
  assignee?: string | null
  reviewer?: string | null
  owner?: string
  ownerIsElizabeth?: boolean
  domain?: string
  caller?: string
}): TransitionContext {
  const owner = overrides.owner ?? 'elizabeth'
  return {
    task: {
      status: overrides.status ?? 'wip',
      assignee_agent_slug: overrides.assignee !== undefined ? overrides.assignee : 'murphy',
      reviewer_agent_slug: overrides.reviewer ?? null,
      project_owner_agent_slug: owner,
      project_owner_is_elizabeth: overrides.ownerIsElizabeth ?? owner === 'elizabeth',
      metadata_domain: overrides.domain,
    },
    callerAgentSlug: overrides.caller ?? 'murphy',
  }
}

describe('S17-BE-01: valid transition paths (ruling: 7 allowed)', () => {
  it('assignee: wip → review', () => {
    const r = assertTransition(ctx({ status: 'wip' }), 'review')
    expect(r.ok).toBe(true)
  })

  it('assignee: todo → wip', () => {
    const r = assertTransition(ctx({ status: 'todo', caller: 'murphy' }), 'wip')
    expect(r.ok).toBe(true)
  })

  it('assignee: rework → wip', () => {
    const r = assertTransition(ctx({ status: 'rework' }), 'wip')
    expect(r.ok).toBe(true)
  })

  it('reviewer: review → pending-close (scout gates QA task)', () => {
    const r = assertTransition(
      ctx({ status: 'review', assignee: 'murphy', caller: 'scout', domain: 'qa' }),
      'pending-close',
    )
    expect(r.ok).toBe(true)
    expect(r.ok && r.role).toBe('reviewer')
  })

  it('reviewer: review → rework', () => {
    const r = assertTransition(
      ctx({ status: 'review', assignee: 'murphy', caller: 'scout', domain: 'qa' }),
      'rework',
    )
    expect(r.ok).toBe(true)
    expect(r.ok && r.role).toBe('reviewer')
  })

  it('approver: pending-close → done (elizabeth approves a task she owns)', () => {
    // Task owned by elizabeth? No — elizabeth owns project; task assigned to murphy.
    // Approver for non-elizabeth-owned tasks = elizabeth.
    const r = assertTransition(
      ctx({ status: 'pending-close', owner: 'murphy', caller: 'elizabeth' }),
      'done',
    )
    expect(r.ok).toBe(true)
    expect(r.ok && r.role).toBe('approver')
  })

  it('approver: nova approves a task owned by elizabeth (D5)', () => {
    const r = assertTransition(
      ctx({ status: 'pending-close', owner: 'elizabeth', caller: 'nova' }),
      'done',
    )
    expect(r.ok).toBe(true)
    expect(r.ok && r.role).toBe('approver')
  })
})

describe('S17-BE-01: rejections (ruling P1–P4 fail-closed)', () => {
  it('P1: assignee → done is always rejected (even from pending-close)', () => {
    const r = assertTransition(ctx({ status: 'pending-close', caller: 'murphy' }), 'done')
    expect(r.ok).toBe(false)
  })

  it('P1: assignee wip → done is rejected', () => {
    const r = assertTransition(ctx({ status: 'wip' }), 'done')
    expect(r.ok).toBe(false)
  })

  it('P4: assignee review → wip is rejected (no back-transitions)', () => {
    const r = assertTransition(ctx({ status: 'review' }), 'wip')
    expect(r.ok).toBe(false)
  })

  it('P4: wip → pending-close is rejected (no skips)', () => {
    const r = assertTransition(ctx({ status: 'wip' }), 'pending-close')
    expect(r.ok).toBe(false)
  })

  it('P2: self-review blocked — reviewer=assignee falls to owner; assignee cannot review', () => {
    // reviewer_agent_slug = assignee is ignored by resolveReviewer (P2), so the
    // effective reviewer is the project owner. Either way the assignee caller
    // can never pass review → pending-close on their own task.
    const c = ctx({ status: 'review', assignee: 'murphy', reviewer: 'murphy', caller: 'murphy' })
    expect(resolveReviewer(c)).toBe('elizabeth') // self-referential reviewer ignored
    const r = assertTransition(c, 'pending-close')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/assignee cannot review/i)
  })

  it('P2: explicit self-referential reviewer AND caller-is-reviewer collision is blocked', () => {
    // Direct collision case: caller = explicit reviewer = assignee.
    // resolveReviewer ignores a self-referential reviewer (P2), so silas falls
    // to the domain/owner fallback — either way caller is the assignee and the
    // self-review block rejects. (Owner-as-reviewer is permitted since the
    // 2026-11-02 fix, but an assignee caller is still always rejected.)
    const r = assertTransition(
      ctx({ status: 'review', assignee: 'silas', reviewer: 'silas', caller: 'silas' }),
      'pending-close',
    )
    expect(r.ok).toBe(false)
  })

  it('P2: unknown/missing reviewer fails closed to project owner — not the caller', () => {
    const c = ctx({ status: 'review', assignee: 'murphy', caller: 'rocket', domain: undefined })
    expect(resolveReviewer(c)).toBe('elizabeth') // project owner, NOT rocket
    const r = assertTransition(c, 'pending-close')
    expect(r.ok).toBe(false) // rocket is neither owner/assignee nor resolved reviewer
  })

  it('owner-as-reviewer: owner may gate review → pending-close (fallback reachable, 2026-11-02 fix)', () => {
    // resolveReviewer fail-closes to the project owner. Before the fix, the
    // reviewer branch required !isOwner, deadlocking tasks with no explicit
    // reviewer and no domain (real case: 1805/1807 stuck in review forever).
    const c = ctx({ status: 'review', assignee: 'murphy', domain: undefined, caller: 'elizabeth' })
    expect(resolveReviewer(c)).toBe('elizabeth')
    const r = assertTransition(c, 'pending-close')
    expect(r.ok).toBe(true)
    expect(r.ok && r.role).toBe('reviewer')
  })

  it('owner-as-reviewer: owner can never review a task assigned to herself (self-review)', () => {
    const c = ctx({ status: 'review', assignee: 'elizabeth', domain: undefined, caller: 'elizabeth' })
    const r = assertTransition(c, 'pending-close')
    expect(r.ok).toBe(false)
  })

  it('P3: system identity is rejected as an update_task caller', () => {
    const r = assertTransition(
      ctx({ status: 'pending-close', owner: 'murphy', caller: 'system' }),
      'done',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/reserved/i)
  })
})

describe('S17-BE-01: reviewer + approver resolution (P2 fail-closed)', () => {
  it('explicit reviewer_agent_slug wins when valid and not self-review', () => {
    const c = ctx({ status: 'review', assignee: 'murphy', reviewer: 'scout' })
    expect(resolveReviewer(c)).toBe('scout')
  })

  it('domain default applies when no explicit reviewer', () => {
    const c = ctx({ status: 'review', assignee: 'murphy', domain: 'security' })
    expect(resolveReviewer(c)).toBe('locksmith')
  })

  it('domain default that would be self-review falls to project owner', () => {
    // murphy assigned an arch task: default reviewer silas, fine.
    // But if silas were the assignee of an arch task, default = silas = assignee
    // → must fall through to project owner.
    const c = ctx({
      status: 'review',
      assignee: 'silas',
      domain: 'arch',
      owner: 'elizabeth',
    })
    expect(resolveReviewer(c)).toBe('elizabeth')
  })

  it('resolveApprover: elizabeth approves everywhere except her own tasks; nova for those', () => {
    expect(resolveApprover(ctx({ owner: 'murphy' }))).toBe('elizabeth')
    expect(resolveApprover(ctx({ owner: 'elizabeth' }))).toBe('nova')
  })
})
