/**
 * tests/workers/cron.worker.test.ts
 *
 * Integration tests for CronWorker — pool and dispatcher injected;
 * real PostgreSQL via testcontainers.
 *
 * Coverage targets:
 *   TC-W1  poll fires a due cron: dispatcher called, DB updated
 *   TC-W2  poll does nothing when no crons are due
 *   TC-W3  poll skips a cron whose next_fire_at is in the future
 *   TC-W4  double-fire guard: SKIP LOCKED prevents concurrent marking
 *   TC-W5  dispatch failure: cron is still marked fired (at-most-once)
 *   TC-W6  invalid schedule: worker logs error and continues without crashing
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import type { Pool } from 'pg'
import { CronWorker } from '../../src/workers/cron.worker.js'
import { ToolDispatcher, type ToolHandler } from '../../src/workers/tool-dispatcher.js'
import type { RegisteredToolName } from '../../src/utilities/tool-registry.js'
import { createTestDb, insertCron, type TestDb } from '../helpers/db.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait up to maxMs for assertion to pass, retrying every intervalMs. */
async function waitFor(
  assertion: () => void | Promise<void>,
  maxMs = 5000,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + maxMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    try {
      await assertion()
      return
    } catch (err) {
      lastErr = err
      await new Promise(r => setTimeout(r, intervalMs))
    }
  }
  throw lastErr
}

/** Build a ToolDispatcher with a single handler for 'store_memory'. */
function makeDispatcher(
  pool: Pool,
  handler: ToolHandler = vi.fn<Parameters<ToolHandler>, ReturnType<ToolHandler>>().mockResolvedValue(undefined),
): { dispatcher: ToolDispatcher; handler: ReturnType<typeof vi.fn> } {
  const handlers = new Map<RegisteredToolName, ToolHandler>([
    ['store_memory', handler],
  ])
  return { dispatcher: new ToolDispatcher(pool, handlers), handler: handler as ReturnType<typeof vi.fn> }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('CronWorker (integration)', () => {
  let db: TestDb
  let pool: Pool

  beforeAll(async () => {
    db = await createTestDb()
    pool = db.pool
  }, 90_000)

  afterAll(async () => {
    await db.teardown()
  })

  beforeEach(async () => {
    await db.cleanCrons()
    vi.restoreAllMocks()
  })

  // TC-W1 — happy path: due cron is fired, DB updated, dispatcher called
  it('TC-W1: fires a due cron — dispatcher called and next_fire_at advanced', async () => {
    const payload = { content: 'test memory' }
    const id = await insertCron(pool, {
      payload,
      next_fire_at: "NOW() - interval '1 minute'",
    })

    const { dispatcher, handler } = makeDispatcher(pool)
    const worker = new CronWorker(pool, dispatcher)

    worker.start()

    try {
      // Wait for the poll cycle to mark the cron fired
      await waitFor(async () => {
        const result = await pool.query<{ last_run_at: Date | null }>(
          `SELECT last_run_at FROM crons WHERE id = $1`,
          [id],
        )
        expect(result.rows[0]!.last_run_at).not.toBeNull()
      })
    } finally {
      worker.stop()
    }

    // Dispatcher must have been called once with correct args
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith('store_memory', payload, pool)

    // next_fire_at must have advanced beyond NOW()
    const result = await pool.query<{ next_fire_at: Date }>(
      `SELECT next_fire_at FROM crons WHERE id = $1`,
      [id],
    )
    expect(result.rows[0]!.next_fire_at.getTime()).toBeGreaterThan(Date.now())
  })

  // TC-W2 — no-op when nothing is due
  it('TC-W2: dispatcher is NOT called when no crons are due', async () => {
    const { dispatcher, handler } = makeDispatcher(pool)
    const worker = new CronWorker(pool, dispatcher)

    worker.start()
    // Allow a full poll cycle to complete
    await new Promise(r => setTimeout(r, 300))
    worker.stop()

    expect(handler).not.toHaveBeenCalled()
  })

  // TC-W3 — future cron is skipped
  it('TC-W3: does not fire a cron whose next_fire_at is in the future', async () => {
    const id = await insertCron(pool, {
      next_fire_at: "NOW() + interval '10 minutes'",
    })

    const { dispatcher, handler } = makeDispatcher(pool)
    const worker = new CronWorker(pool, dispatcher)

    worker.start()
    await new Promise(r => setTimeout(r, 300))
    worker.stop()

    expect(handler).not.toHaveBeenCalled()

    // last_run_at must still be NULL (cron was not touched)
    const result = await pool.query<{ last_run_at: Date | null }>(
      `SELECT last_run_at FROM crons WHERE id = $1`,
      [id],
    )
    expect(result.rows[0]!.last_run_at).toBeNull()
  })

  // TC-W4 — double-fire guard: SKIP LOCKED prevents concurrent execution
  it('TC-W4: SKIP LOCKED prevents a second worker from double-firing the same cron', async () => {
    const id = await insertCron(pool, {
      next_fire_at: "NOW() - interval '1 minute'",
    })

    // Simulate a concurrent worker by manually holding a FOR UPDATE lock
    // on the cron row in a separate transaction.
    const lockClient = await pool.connect()
    await lockClient.query('BEGIN')
    await lockClient.query(
      `SELECT id FROM crons WHERE id = $1 FOR UPDATE`,
      [id],
    )

    // While the lock is held, start the worker — its fire() will attempt
    // FOR UPDATE SKIP LOCKED and find no unlocked row, so it bails.
    const dispatchCount = { calls: 0 }
    const silentHandler: ToolHandler = vi.fn().mockImplementation(async () => {
      dispatchCount.calls++
    })
    const { dispatcher } = makeDispatcher(pool, silentHandler)
    const worker = new CronWorker(pool, dispatcher)

    worker.start()
    await new Promise(r => setTimeout(r, 300))
    worker.stop()

    // The lock is still held — the worker must NOT have fired the cron
    expect(dispatchCount.calls).toBe(0)

    // Verify the cron was not marked (last_run_at still NULL)
    const result = await pool.query<{ last_run_at: Date | null }>(
      `SELECT last_run_at FROM crons WHERE id = $1`,
      [id],
    )
    expect(result.rows[0]!.last_run_at).toBeNull()

    // Release the lock
    await lockClient.query('ROLLBACK')
    lockClient.release()
  })

  // TC-W5 — dispatch failure: cron is still marked fired (at-most-once semantics)
  it('TC-W5: cron is marked fired even when dispatcher throws (at-most-once delivery)', async () => {
    const id = await insertCron(pool, {
      next_fire_at: "NOW() - interval '1 minute'",
    })

    const boomHandler: ToolHandler = vi.fn().mockRejectedValue(new Error('handler boom'))
    const { dispatcher } = makeDispatcher(pool, boomHandler)
    const worker = new CronWorker(pool, dispatcher)

    // Suppress the expected error log
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    worker.start()

    try {
      await waitFor(async () => {
        const result = await pool.query<{ last_run_at: Date | null }>(
          `SELECT last_run_at FROM crons WHERE id = $1`,
          [id],
        )
        // The cron must be marked fired even though dispatch failed
        expect(result.rows[0]!.last_run_at).not.toBeNull()
      })
    } finally {
      worker.stop()
      consoleError.mockRestore()
    }

    // Handler was called once — it threw, but the cron was already committed
    expect(boomHandler).toHaveBeenCalledOnce()
  })

  // TC-W6 — invalid schedule: worker logs error and continues without crashing
  it('TC-W6: invalid cron schedule is logged and the worker continues running', async () => {
    // Bypass Zod validation by inserting directly with an unparseable schedule
    const result = await pool.query<{ id: number }>(
      `INSERT INTO crons (project_id, owner_agent_slug, name, schedule, tool_name, status, next_fire_at)
       SELECT id, 'test-agent', 'Bad Schedule Cron', 'not-a-valid-cron', 'store_memory', 'active', NOW() - interval '1 minute'
       FROM projects WHERE slug = 'test-project'
       RETURNING id`,
    )
    const badId = result.rows[0]!.id

    // Also insert a valid due cron to verify the worker keeps running after the bad one
    const goodId = await insertCron(pool, {
      next_fire_at: "NOW() - interval '1 minute'",
    })

    const { dispatcher, handler } = makeDispatcher(pool)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const worker = new CronWorker(pool, dispatcher)
    worker.start()

    try {
      // The good cron should still fire despite the bad cron appearing first
      await waitFor(async () => {
        const r = await pool.query<{ last_run_at: Date | null }>(
          `SELECT last_run_at FROM crons WHERE id = $1`,
          [goodId],
        )
        expect(r.rows[0]!.last_run_at).not.toBeNull()
      })
    } finally {
      worker.stop()
      consoleError.mockRestore()
    }

    // The bad cron must NOT have been marked fired (parseExpression threw, returned early)
    const badResult = await pool.query<{ last_run_at: Date | null }>(
      `SELECT last_run_at FROM crons WHERE id = $1`,
      [badId],
    )
    expect(badResult.rows[0]!.last_run_at).toBeNull()

    // Good cron was dispatched
    expect(handler).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Unit-level edge case tests — use mocked pool/dispatcher (no testcontainers)
// ---------------------------------------------------------------------------

describe('CronWorker (unit — error edge cases)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // TC-W7 — poll() catches a non-Error thrown by getDueCrons and uses String(err)
  // This exercises the `err instanceof Error` false branch at lines 86-87.
  it('TC-W7: poll() catches non-Error exception and converts with String()', async () => {
    const throwingPool = {
      // getDueCrons calls pool.query() — reject with a plain string (not Error)
      query: vi.fn().mockRejectedValue('plain-string-error'),
      connect: vi.fn(),
    } as unknown as Pool

    const { dispatcher, handler } = makeDispatcher(throwingPool)
    const worker = new CronWorker(throwingPool, dispatcher)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    // Call start() twice — second call exercises the `if (this.running) return` guard
    worker.start()
    worker.start()

    // Allow the synchronous-resolved mock to complete its poll cycle
    await new Promise(r => setTimeout(r, 100))
    worker.stop()

    expect(consoleError).toHaveBeenCalledWith(
      '[cron-worker] Poll error:',
      'plain-string-error',
    )
    expect(handler).not.toHaveBeenCalled()
  })

  // TC-W8 — fire() transaction failure triggers ROLLBACK, logs error, skips dispatch
  // This exercises the fire() catch block at lines 143-146.
  it('TC-W8: fire() transaction failure is caught — ROLLBACK attempted, dispatch skipped', async () => {
    const dueCron = {
      id: 9999,
      schedule: '*/5 * * * *',
      tool_name: 'store_memory',
      payload: null,
    }

    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce(undefined)                                          // BEGIN
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 9999 }] })             // SELECT FOR UPDATE SKIP LOCKED
        .mockRejectedValueOnce(new Error('simulated DB failure in markCronFired')) // UPDATE inside markCronFired
        .mockResolvedValueOnce(undefined),                                         // ROLLBACK (best-effort)
      release: vi.fn(),
    }

    const failingPool = {
      // getDueCrons SELECT returns the due cron; all other queries are on the client
      query: vi.fn().mockResolvedValue({ rows: [dueCron] }),
      connect: vi.fn().mockResolvedValue(mockClient),
    } as unknown as Pool

    const { dispatcher, handler } = makeDispatcher(failingPool)
    const worker = new CronWorker(failingPool, dispatcher)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    worker.start()
    await new Promise(r => setTimeout(r, 100))
    worker.stop()

    expect(consoleError).toHaveBeenCalledWith(
      '[cron-worker] Failed to mark cron 9999 fired:',
      'simulated DB failure in markCronFired',
    )
    // Dispatch must NOT be called — transaction failed before commit
    expect(handler).not.toHaveBeenCalled()
    // Client was released despite the error
    expect(mockClient.release).toHaveBeenCalledOnce()
  })

  // TC-W9 — dispatch failure with a non-Error exercises the String(err) branch
  // in fire()'s dispatch-error catch block (the `err instanceof Error` false path).
  it('TC-W9: dispatch non-Error failure is converted with String() in the error log', async () => {
    const dueCron = {
      id: 9998,
      schedule: '*/5 * * * *',
      tool_name: 'store_memory',
      payload: null,
    }

    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce(undefined)                                // BEGIN
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 9998 }] })  // SELECT FOR UPDATE SKIP LOCKED
        .mockResolvedValueOnce(undefined)                                // markCronFired UPDATE
        .mockResolvedValueOnce(undefined),                               // COMMIT
      release: vi.fn(),
    }

    const nonErrorPool = {
      query: vi.fn().mockResolvedValue({ rows: [dueCron] }),
      connect: vi.fn().mockResolvedValue(mockClient),
    } as unknown as Pool

    // Dispatch throws a plain string — exercises the `String(err)` branch
    const nonErrorHandler: ToolHandler = vi.fn().mockRejectedValue('non-error-dispatch-failure')
    const { dispatcher } = makeDispatcher(nonErrorPool, nonErrorHandler)
    const worker = new CronWorker(nonErrorPool, dispatcher)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    worker.start()
    await new Promise(r => setTimeout(r, 100))
    worker.stop()

    expect(consoleError).toHaveBeenCalledWith(
      '[cron-worker] Dispatch failed for cron 9998 (store_memory):',
      'non-error-dispatch-failure',
    )
  })
})
