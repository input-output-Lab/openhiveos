import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { handleUpdateTask } from '../../src/utilities/update-task.js'
import { handleCreateTask } from '../../src/utilities/create-task.js'
import { withActor, pool } from '../../src/db/client.js'

// ---------------------------------------------------------------------------
// S17-BE-01 (#2555) — integration tests against the REAL database.
// Gated: skipped unless TEST_DATABASE_URL / RUN_INTEGRATION=1 is set (CI runs
// them via the migration-validation postgres service; locally via local PG).
// Exercises the full handler → transition matrix → DB atomic guard chain and
// verifies actor attribution + history rows in task_status_history.
// ---------------------------------------------------------------------------

const RUN = process.env['RUN_INTEGRATION'] === '1' || process.env['TEST_DATABASE_URL'] !== undefined
const d = RUN ? describe : describe.skip

const OWNER = 'elizabeth'         // must exist in agents (seeded)
const ASSIGNEE = 'murphy'         // must exist in agents (seeded)
const REVIEWER = 'scout'          // must exist in agents (seeded)

let projectId: number
let taskId: number

async function seed(domain: string = 'qa'): Promise<void> {
  // project created directly via SQL (owner = elizabeth), then the task via
  // the real handleCreateTask path — exercising the production create chain.
  // domain param: describe 2 uses 'docs' → clarence so the owner
  // reassign-reviewer regression test exercises a REAL reassignment (qa would
  // pre-stamp scout and make the test vacuous — Locksmith BLOCK, memory 3308).
  const r = await pool.query<{ id: number }>(
    `INSERT INTO projects (slug, name, owner_agent_slug)
     VALUES ($1, $2, $3)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [`s17-transition-test-${Date.now()}`, 'Transition Test Project', OWNER],
  )
  projectId = Number(r.rows[0]!.id) // BIGSERIAL returns as string via node-pg

  const created = await handleCreateTask(
    {
      project_id: projectId,
      title: 'Integration: transition lifecycle',
      estimated_hours: 2,
      billing_low: 1,
      billing_high: 3,
      estimate_confidence: 'medium',
      assignee_agent_slug: ASSIGNEE,
      metadata: { domain },
    },
    OWNER,
  )
  // reviewer stamped at create via resolveReviewer (qa→scout, docs→clarence) —
  // verified below in the P4 walk where scout gates review → pending-close.
  if ('error' in created) throw new Error(`seed create failed: ${JSON.stringify(created)}`)
  taskId = Number((created as { id: number }).id) // BIGSERIAL returns as string
}

d('S17-BE-01 integration: full transition lifecycle (real DB)', () => {
  beforeAll(async () => {
    await seed('qa')
  })

  afterAll(async () => {
    // Cleanup: remove the test project (cascades to tasks + history).
    // NOTE: never pool.end() here — the second describe's beforeAll reuses
    // the shared pool (E2E-caught: 'Cannot use a pool after calling end').
  })

  it('P4 walk: todo → wip (assignee) → review (assignee) → pending-close (reviewer)', async () => {
    // assignee wip
    const r1 = await handleUpdateTask({ task_id: taskId, status: 'wip' }, ASSIGNEE)
    expect(r1).not.toHaveProperty('error')
    // assignee review
    const r2 = await handleUpdateTask({ task_id: taskId, status: 'review' }, ASSIGNEE)
    expect(r2).not.toHaveProperty('error')
    // reviewer (domain default for 'qa' → scout) pending-close
    const r3 = await handleUpdateTask({ task_id: taskId, status: 'pending-close' }, REVIEWER)
    expect(r3).not.toHaveProperty('error')

    // P5: history rows recorded with real actors
    const hist = await pool.query<{ from_status: string | null; to_status: string; changed_by: string | null }>(
      `SELECT from_status, to_status, changed_by FROM task_status_history
       WHERE task_id = $1 ORDER BY changed_at`,
      [taskId],
    )
    const by = hist.rows.map((h) => `${h.from_status}→${h.to_status}:${h.changed_by}`)
    expect(by.some((b) => b.startsWith('todo→wip:') && b.endsWith(ASSIGNEE))).toBe(true)
    expect(by.some((b) => b.startsWith('wip→review:') && b.endsWith(ASSIGNEE))).toBe(true)
    expect(by.some((b) => b.startsWith('review→pending-close:') && b.endsWith(REVIEWER))).toBe(true)
  })

  it('P2: reviewer (scout) approves; assignee (murphy) cannot approve done', async () => {
    // task is pending-close from the previous test; try the assignee path
    const r = await handleUpdateTask({ task_id: taskId, status: 'done' }, ASSIGNEE)
    expect(r).toHaveProperty('error', 'invalid_transition')
    // approver for this elizabeth-owned project is NOVA (D5), so murphy rejected
  })

  it('P1: nova (approver for elizabeth-owned tasks) confirms pending-close → done', async () => {
    // D5 ruling: elizabeth approves done — except tasks owned by elizabeth,
    // where nova approves. This project is elizabeth-owned → approver = nova.
    // NOTE: approver is status-ONLY (smuggling gate — notes are reviewer-only
    // per the Locksmith BLOCK fix).
    // S19-ARCH-01c (#2776): approver transitions are GATED — the fail-closed
    // step-up callback must approve before the matrix write proceeds.
    const r = await handleUpdateTask(
      { task_id: taskId, status: 'done' },
      'nova',
      undefined,
      async () => ({ approved: true, stepUpUser: 'review-fixture', reason: 'approved in test' }),
    )
    expect(r).not.toHaveProperty('error')
    expect((r as { status: string }).status).toBe('done')

    const hist = await pool.query<{ to_status: string; changed_by: string | null; auth_strength: string | null; step_up_user: string | null }>(
      `SELECT to_status, changed_by, auth_strength, step_up_user FROM task_status_history
       WHERE task_id = $1 ORDER BY changed_at DESC LIMIT 1`,
      [taskId],
    )
    expect(hist.rows[0]!.to_status).toBe('done')
    expect(hist.rows[0]!.changed_by).toBe('nova')
    // Step-up audit triple present on the gated transition (ARCH-028).
    expect(hist.rows[0]!.auth_strength).toBe('session')
    expect(hist.rows[0]!.step_up_user).toBe('review-fixture')
  })

  it('P4: done is terminal — no further transitions permitted', async () => {
    const r = await handleUpdateTask({ task_id: taskId, status: 'wip' }, ASSIGNEE)
    expect(r).toHaveProperty('error', 'invalid_transition')
  })
})

d('S17-BE-01 integration: rejection paths + atomic guard (real DB)', () => {
  beforeAll(async () => {
    await seed('docs') // docs → clarence at create; owner reassigns to scout in the P2 test
  })

  afterAll(async () => {
    // tasks_project_id_fkey has no CASCADE — delete children first.
    await pool.query(`DELETE FROM tasks WHERE project_id = $1`, [projectId])
    await pool.query(`DELETE FROM projects WHERE id = $1`, [projectId])
  })

  it('P4: assignee skips wip→pending-close — rejected, no history row written', async () => {
    const before = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM task_status_history WHERE task_id = $1`, [taskId],
    )
    const r = await handleUpdateTask({ task_id: taskId, status: 'pending-close' }, ASSIGNEE)
    expect(r).toHaveProperty('error', 'invalid_transition')

    const after = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM task_status_history WHERE task_id = $1`, [taskId],
    )
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n) // no phantom history from rejections
  })

  it('P2: self-review blocked — reviewer_agent_slug set to assignee is ignored', async () => {
    // walk to review
    await handleUpdateTask({ task_id: taskId, status: 'wip' }, ASSIGNEE)
    await handleUpdateTask({ task_id: taskId, status: 'review' }, ASSIGNEE)
    // try to set reviewer = self and then self-approve
    await handleUpdateTask({ task_id: taskId, reviewer_agent_slug: ASSIGNEE }, ASSIGNEE)
    const r = await handleUpdateTask({ task_id: taskId, status: 'pending-close' }, ASSIGNEE)
    expect(r).toHaveProperty('error', 'invalid_transition')
  })

  it('SEC: field-smuggling — reviewer cannot overwrite owner-only fields during a transition', async () => {
    // Live-proven exploit (Locksmith BLOCK, memory 3308): scout sent
    // {status:'pending-close', metadata:{hijacked:true}} and the row gate
    // admitted the write, overwriting owner-only metadata. The handler must
    // now reject any reviewer/approver transition that carries owner fields.
    // Own task with qa domain → scout is the create-stamped reviewer and the
    // task can be walked to review cleanly.
    const created = await handleCreateTask(
      {
        project_id: projectId,
        title: 'Integration: reviewer smuggling',
        estimated_hours: 1,
        billing_low: 1,
        billing_high: 1,
        estimate_confidence: 'low',
        assignee_agent_slug: ASSIGNEE,
        metadata: { domain: 'qa' },
      },
      OWNER,
    )
    if ('error' in created) throw new Error(`smuggle seed failed: ${JSON.stringify(created)}`)
    const tS = Number((created as { id: number }).id)
    await handleUpdateTask({ task_id: tS, status: 'wip' }, ASSIGNEE)
    await handleUpdateTask({ task_id: tS, status: 'review' }, ASSIGNEE)
    const before = await pool.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM tasks WHERE id = $1`,
      [tS],
    )
    const r = await handleUpdateTask(
      { task_id: tS, status: 'pending-close', metadata: { domain: 'qa', hijacked: true } },
      REVIEWER,
    )
    expect(r).toHaveProperty('error', 'invalid_transition')
    // metadata unchanged — the smuggled write never landed
    const after = await pool.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM tasks WHERE id = $1`,
      [tS],
    )
    expect(after.rows[0]!.metadata).toEqual(before.rows[0]!.metadata)
    // task state unchanged (still review) — the transition itself was blocked
    const st = await pool.query<{ status: string }>(`SELECT status FROM tasks WHERE id = $1`, [tS])
    expect(st.rows[0]!.status).toBe('review')
    // control: the SAME reviewer, clean bare-status request — succeeds
    const ok = await handleUpdateTask({ task_id: tS, status: 'pending-close' }, REVIEWER)
    expect(ok).not.toHaveProperty('error')
  })

  it('SEC: approver cannot smuggle owner-only fields either (nova approving done)', async () => {
    // parked task: reuse the rework-loop flow below? No — use the main task at
    // pending-close AFTER the reassignment test below has gated it. This test
    // walks its own task to pending-close first.
    const created = await handleCreateTask(
      {
        project_id: projectId,
        title: 'Integration: approver smuggling',
        estimated_hours: 1,
        billing_low: 1,
        billing_high: 1,
        estimate_confidence: 'low',
        assignee_agent_slug: ASSIGNEE,
        metadata: { domain: 'qa' },
      },
      OWNER,
    )
    if ('error' in created) throw new Error(`approver-smuggle seed failed: ${JSON.stringify(created)}`)
    const t3 = Number((created as { id: number }).id)
    await handleUpdateTask({ task_id: t3, status: 'wip' }, ASSIGNEE)
    await handleUpdateTask({ task_id: t3, status: 'review' }, ASSIGNEE)
    await handleUpdateTask({ task_id: t3, status: 'pending-close' }, REVIEWER)
    // nova (approver) tries to approve AND overwrite metadata in one call.
    // S19-ARCH-01c: approver transitions are gated — with no step-up callback
    // the fail-closed gate denies BEFORE any field evaluation. Either denial
    // preserves the security property: no transition, no smuggled metadata.
    const r = await handleUpdateTask(
      { task_id: t3, status: 'done', metadata: { domain: 'qa', hijacked: true } },
      'nova',
    )
    expect(r).toHaveProperty('error')
    expect(['step_up_required', 'invalid_transition']).toContain((r as { error: string }).error)
    const row = await pool.query<{ status: string; metadata: Record<string, unknown> }>(
      `SELECT status, metadata FROM tasks WHERE id = $1`, [t3],
    )
    expect(row.rows[0]!.status).toBe('pending-close')
    expect(row.rows[0]!.metadata).toEqual({ domain: 'qa' })
  })

  it('P2: owner reassigns reviewer via update_task, then the new reviewer gates', async () => {
    // Regression (Locksmith BLOCK, memory 3308): reviewer_agent_slug was not in
    // the update schema — zod silently dropped it, and this test passed
    // VACUOUSLY (scout was already stamped at create via qa→scout). Now the
    // create uses domain 'docs' → clarence, and the owner reassigns to scout.
    // The reassignment must PERSIST before scout can gate the transition.
    await handleUpdateTask({ task_id: taskId, reviewer_agent_slug: REVIEWER }, OWNER)
    const row = await pool.query<{ reviewer_agent_slug: string | null }>(
      `SELECT reviewer_agent_slug FROM tasks WHERE id = $1`,
      [taskId],
    )
    // The write must actually stick — not a silent zod drop.
    expect(row.rows[0]!.reviewer_agent_slug).toBe(REVIEWER)
    const r = await handleUpdateTask({ task_id: taskId, status: 'pending-close' }, REVIEWER)
    expect(r).not.toHaveProperty('error')
  })

  it('P2: rework loop — reviewer sends back, assignee redoes, reviewer re-approves', async () => {
    // Own task: the matrix has NO pending-close → review back-transition (P4
    // monotonicity), and the previous test already parked taskId in
    // pending-close. The rework loop must start from a task in 'review'.
    const created = await handleCreateTask(
      {
        project_id: projectId,
        title: 'Integration: rework loop',
        estimated_hours: 1,
        billing_low: 1,
        billing_high: 1,
        estimate_confidence: 'low',
        assignee_agent_slug: ASSIGNEE,
        reviewer_agent_slug: REVIEWER,
        metadata: { domain: 'qa' },
      },
      OWNER,
    )
    if ('error' in created) throw new Error(`rework seed failed: ${JSON.stringify(created)}`)
    const t2 = Number((created as { id: number }).id)

    // walk to review, then loop: review→rework (reviewer), rework→wip (assignee),
    // wip→review (assignee), review→pending-close (reviewer)
    await handleUpdateTask({ task_id: t2, status: 'wip' }, ASSIGNEE)
    await handleUpdateTask({ task_id: t2, status: 'review' }, ASSIGNEE)
    const r1 = await handleUpdateTask({ task_id: t2, status: 'rework' }, REVIEWER)
    expect(r1).not.toHaveProperty('error')
    const r2 = await handleUpdateTask({ task_id: t2, status: 'wip' }, ASSIGNEE)
    expect(r2).not.toHaveProperty('error')
    const r3 = await handleUpdateTask({ task_id: t2, status: 'review' }, ASSIGNEE)
    expect(r3).not.toHaveProperty('error')
    const r4 = await handleUpdateTask({ task_id: t2, status: 'pending-close' }, REVIEWER)
    expect(r4).not.toHaveProperty('error')
  })

  it('ATOMIC: expectedFromStatus guard — stale from-state makes the UPDATE match 0 rows', async () => {
    // Simulate TOCTOU: resolve against 'review', but the DB row is now
    // pending-close (previous test). The handler fetch would get the fresh
    // state, so here we prove the DB-layer guard directly: expectedFromStatus
    // that doesn't match yields undefined (no row), not a silent wrong write.
    const { updateTask } = await import('../../src/db/queries/tasks.js')
    const stale = await updateTask({
      task_id: taskId,
      owner_agent_slug: OWNER,
      status: 'done',
      expectedFromStatus: 'review', // stale — actual is pending-close
    })
    expect(stale).toBeUndefined()
    const check = await pool.query<{ status: string }>(`SELECT status FROM tasks WHERE id = $1`, [taskId])
    expect(check.rows[0]!.status).toBe('pending-close') // unchanged
  })

  it('P3: system identity rejected as a caller', async () => {
    const r = await handleUpdateTask({ task_id: taskId, status: 'done' }, 'system' as unknown as string)
    // 'system' is not a valid agent slug in the manifest — the zod refine
    // rejects before the matrix. Either way: rejected.
    expect(r).toHaveProperty('error')
  })
})
