/**
 * tests/db/queries/crons-worker.test.ts
 *
 * Integration tests for the G2 query contracts:
 *   - getDueCrons(pool)
 *   - markCronFired(client, id, nextFireAt)
 *
 * Uses a real PostgreSQL instance (testcontainers) with the full migration
 * chain applied. This validates the SQL expressions, the next_fire_at column
 * introduced by migration 006, and the transaction semantics of markCronFired.
 *
 * Coverage targets:
 *   TC-Q1  getDueCrons returns active crons where next_fire_at <= NOW()
 *   TC-Q2  getDueCrons excludes crons where next_fire_at is in the future
 *   TC-Q3  getDueCrons excludes paused crons
 *   TC-Q4  getDueCrons excludes deleted crons
 *   TC-Q5  getDueCrons returns empty array when nothing is due
 *   TC-Q6  markCronFired updates last_run_at and next_fire_at inside a transaction
 *   TC-Q7  after markCronFired + COMMIT, the cron no longer appears in getDueCrons
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { Pool } from 'pg'
import { getDueCrons, markCronFired } from '../../../src/db/queries/crons.js'
import { createTestDb, insertCron, type TestDb } from '../../helpers/db.js'

describe('getDueCrons + markCronFired (integration)', () => {
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
  })

  // TC-Q1 — due cron is returned
  it('TC-Q1: returns active crons where next_fire_at <= NOW()', async () => {
    const id = await insertCron(pool, {
      next_fire_at: "NOW() - interval '30 seconds'",
    })

    const due = await getDueCrons(pool)

    expect(due).toHaveLength(1)
    expect(due[0]!.id).toBe(id)
    expect(due[0]!.schedule).toBe('*/5 * * * *')
    expect(due[0]!.tool_name).toBe('store_memory')
    expect(due[0]!.payload).toBeNull()
  })

  // TC-Q2 — future cron is excluded
  it('TC-Q2: excludes crons where next_fire_at is in the future', async () => {
    await insertCron(pool, {
      next_fire_at: "NOW() + interval '10 minutes'",
    })

    const due = await getDueCrons(pool)

    expect(due).toHaveLength(0)
  })

  // TC-Q3 — paused crons are excluded
  it('TC-Q3: excludes paused crons even when next_fire_at is in the past', async () => {
    await insertCron(pool, {
      status: 'paused',
      next_fire_at: "NOW() - interval '1 minute'",
    })

    const due = await getDueCrons(pool)

    expect(due).toHaveLength(0)
  })

  // TC-Q4 — deleted crons are excluded
  it('TC-Q4: excludes deleted crons even when next_fire_at is in the past', async () => {
    await insertCron(pool, {
      status: 'deleted',
      next_fire_at: "NOW() - interval '1 minute'",
    })

    const due = await getDueCrons(pool)

    expect(due).toHaveLength(0)
  })

  // TC-Q5 — empty result when nothing is due
  it('TC-Q5: returns empty array when no crons are due', async () => {
    const due = await getDueCrons(pool)
    expect(due).toHaveLength(0)
  })

  // TC-Q6 — markCronFired updates both columns inside a transaction
  it('TC-Q6: markCronFired updates last_run_at and next_fire_at within a transaction', async () => {
    const id = await insertCron(pool, {
      next_fire_at: "NOW() - interval '1 minute'",
    })

    const nextFireAt = new Date(Date.now() + 5 * 60 * 1000) // 5 min from now

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await markCronFired(client, id, nextFireAt)
      await client.query('COMMIT')
    } finally {
      client.release()
    }

    const result = await pool.query<{
      last_run_at: Date | null
      next_fire_at: Date | null
    }>(
      `SELECT last_run_at, next_fire_at FROM crons WHERE id = $1`,
      [id],
    )

    const row = result.rows[0]!
    expect(row.last_run_at).not.toBeNull()

    // next_fire_at should match (within 1 second to account for DB timestamp precision)
    const nextFireAtActual = row.next_fire_at!.getTime()
    expect(Math.abs(nextFireAtActual - nextFireAt.getTime())).toBeLessThan(1000)
  })

  // TC-Q7 — after markCronFired + COMMIT, cron no longer appears in getDueCrons
  it('TC-Q7: fired cron does not reappear in getDueCrons after commit', async () => {
    const id = await insertCron(pool, {
      next_fire_at: "NOW() - interval '1 minute'",
    })

    // Confirm it's due before firing
    const before = await getDueCrons(pool)
    expect(before.some(c => c.id === id)).toBe(true)

    // Fire it — advance next_fire_at to 5 minutes from now
    const nextFireAt = new Date(Date.now() + 5 * 60 * 1000)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await markCronFired(client, id, nextFireAt)
      await client.query('COMMIT')
    } finally {
      client.release()
    }

    // Should no longer appear as due
    const after = await getDueCrons(pool)
    expect(after.some(c => c.id === id)).toBe(false)
  })
})
