/**
 * tests/utilities/log-time.test.ts
 *
 * Unit tests for log_time (S17-BE-03 #2557). DB calls are mocked; the clock is
 * injected. Covers input rules (fractional minutes, cap, backdate window,
 * future date, category enum, strict keys) and the authorization gate
 * (assignee and project owner allowed; reviewer and stranger get the opaque
 * error and no write happens).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getTaskForActor = vi.fn()
const insertHumanWorklog = vi.fn()
const withActor = vi.fn()

vi.mock('../../src/db/queries/tasks.js', () => ({
  getTaskForActor: (...args: unknown[]) => getTaskForActor(...args),
}))
vi.mock('../../src/db/queries/worklogs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/db/queries/worklogs.js')>()
  return {
    ...actual,
    insertHumanWorklog: (...args: unknown[]) => insertHumanWorklog(...args),
  }
})
vi.mock('../../src/db/client.js', () => ({
  withActor: (...args: unknown[]) => withActor(...args),
}))

import { handleLogTime, logTimeSchema, validateWorkedOn } from '../../src/utilities/log-time.js'

const NOW = new Date('2026-10-31T12:00:00.000Z')

const ownTask = {
  id: 2557,
  status: 'wip',
  assignee_agent_slug: 'murphy',
  reviewer_agent_slug: 'scout',
  project_id: 1,
  project_owner_agent_slug: 'elizabeth',
  metadata: {},
}

const validInput = { task_id: 2557, minutes: 45, category: 'BE' as const }

beforeEach(() => {
  vi.clearAllMocks()
  getTaskForActor.mockResolvedValue(ownTask)
  insertHumanWorklog.mockResolvedValue({ id: 1, minutes: '45.00' })
  withActor.mockImplementation(async (_slug: string, fn: (tx: unknown) => Promise<unknown>) => fn({}))
})

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe('logTimeSchema', () => {
  it('accepts fractional minutes', () => {
    expect(logTimeSchema.parse({ ...validInput, minutes: 12.5 }).minutes).toBe(12.5)
  })

  it('rejects zero and negative minutes', () => {
    expect(() => logTimeSchema.parse({ ...validInput, minutes: 0 })).toThrow()
    expect(() => logTimeSchema.parse({ ...validInput, minutes: -5 })).toThrow()
  })

  it('caps a single entry at 1440 minutes', () => {
    expect(logTimeSchema.parse({ ...validInput, minutes: 1440 }).minutes).toBe(1440)
    expect(() => logTimeSchema.parse({ ...validInput, minutes: 1441 })).toThrow()
  })

  it('rejects categories outside the L10 enum', () => {
    expect(() => logTimeSchema.parse({ ...validInput, category: 'XX' })).toThrow()
  })

  it('rejects unknown keys (strict)', () => {
    expect(() => logTimeSchema.parse({ ...validInput, session_id: 'abc' })).toThrow()
  })

  it('rejects a note over 500 characters', () => {
    expect(() => logTimeSchema.parse({ ...validInput, note: 'x'.repeat(501) })).toThrow()
  })

  it('rejects a malformed worked_on', () => {
    expect(() => logTimeSchema.parse({ ...validInput, worked_on: '31/10/2026' })).toThrow()
  })

  it('exposes a plain ZodObject shape for MCP registration', () => {
    expect(Object.keys(logTimeSchema.shape)).toEqual(
      expect.arrayContaining(['task_id', 'minutes', 'category', 'billable', 'worked_on', 'note']),
    )
  })
})

// ---------------------------------------------------------------------------
// worked_on window
// ---------------------------------------------------------------------------

describe('validateWorkedOn', () => {
  it('accepts today', () => {
    expect(() => validateWorkedOn('2026-10-31', NOW)).not.toThrow()
  })

  it('accepts exactly 90 days back', () => {
    expect(() => validateWorkedOn('2026-08-02', NOW)).not.toThrow()
  })

  it('rejects 91 days back', () => {
    expect(() => validateWorkedOn('2026-08-01', NOW)).toThrow(/90 days/)
  })

  it('rejects a future date', () => {
    expect(() => validateWorkedOn('2026-11-01', NOW)).toThrow(/future/)
  })

  it('rejects a non-existent calendar date', () => {
    expect(() => validateWorkedOn('2026-02-30', NOW)).toThrow(/valid calendar date/)
  })
})

// ---------------------------------------------------------------------------
// Authorization and write path
// ---------------------------------------------------------------------------

describe('handleLogTime', () => {
  it('lets the assignee log time and attributes the write to the caller', async () => {
    const result = await handleLogTime(validInput, 'murphy', NOW)

    expect('worklog' in result).toBe(true)
    expect(withActor).toHaveBeenCalledWith('murphy', expect.any(Function))
    expect(insertHumanWorklog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        task_id: 2557,
        agent_slug: 'murphy',
        actor_type: 'agent',
        minutes: 45,
        worked_on: '2026-10-31',
        category: 'BE',
        billable: true,
        note: null,
      }),
    )
  })

  it('lets the project owner log time', async () => {
    const result = await handleLogTime(validInput, 'elizabeth', NOW)
    expect('worklog' in result).toBe(true)
    expect(withActor).toHaveBeenCalledWith('elizabeth', expect.any(Function))
  })

  it('returns the opaque error for the reviewer and writes nothing', async () => {
    const result = await handleLogTime(validInput, 'scout', NOW)

    expect(result).toEqual({
      error: 'not_found_or_unauthorized',
      message: 'Task not found or you are not authorized to log time on it.',
    })
    expect(withActor).not.toHaveBeenCalled()
    expect(insertHumanWorklog).not.toHaveBeenCalled()
  })

  it('returns the same opaque error for a missing task', async () => {
    getTaskForActor.mockResolvedValue(undefined)
    const result = await handleLogTime(validInput, 'murphy', NOW)

    expect(result).toEqual({
      error: 'not_found_or_unauthorized',
      message: 'Task not found or you are not authorized to log time on it.',
    })
    expect(insertHumanWorklog).not.toHaveBeenCalled()
  })

  it('defaults worked_on to today (UTC) and billable to true', async () => {
    await handleLogTime(validInput, 'murphy', NOW)
    expect(insertHumanWorklog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ worked_on: '2026-10-31', billable: true }),
    )
  })

  it('passes through billable=false and a note', async () => {
    await handleLogTime({ ...validInput, billable: false, note: 'review pass' }, 'murphy', NOW)
    expect(insertHumanWorklog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ billable: false, note: 'review pass' }),
    )
  })

  it('rejects an out-of-window worked_on before any DB call', async () => {
    await expect(
      handleLogTime({ ...validInput, worked_on: '2026-11-05' }, 'murphy', NOW),
    ).rejects.toThrow(/future/)
    expect(getTaskForActor).not.toHaveBeenCalled()
    expect(withActor).not.toHaveBeenCalled()
  })
})
