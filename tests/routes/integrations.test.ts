/**
 * tests/routes/integrations.test.ts
 *
 * Integration tests for PATCH /api/integrations/triage/:id/promote endpoint.
 *
 * Strategy:
 *   - Use createTestDb() to spin up a real PostgreSQL testcontainer with
 *     full migrations applied (including migration 019 which adds triage status)
 *   - Test the promoteTriageTask service directly
 *   - Verify error handling: 404 (not found), 409 (invalid state), success
 *   - Verify audit logging
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db.js'

let db: TestDb

beforeAll(async () => {
  db = await createTestDb()

  // Seed a project and agents for testing
  await db.pool.query(
    `INSERT INTO projects (name, slug, owner_agent_slug, status) 
     VALUES ('Test Project', 'test-project-promote', 'test-agent', 'active')
     ON CONFLICT (slug) DO NOTHING`,
  )

  // Also create an agent so we can set owner_agent_slug
  await db.pool.query(
    `INSERT INTO agents (slug, display_name) 
     VALUES ('test-agent', 'Test Agent')
     ON CONFLICT (slug) DO NOTHING`,
  )
}, 60_000)

afterAll(async () => {
  await db.teardown()
})

describe('PATCH /api/integrations/triage/:id/promote', () => {
  it('promotes triage task to todo (200)', async () => {
    // Create a task in triage status
    const taskResult = await db.pool.query(
      `INSERT INTO tasks (project_id, title, status, created_at)
       VALUES (
         (SELECT id FROM projects WHERE slug = 'test-project-promote'),
         'Triage Task',
         'triage',
         NOW()
       )
       RETURNING id, status`,
    )
    const taskId = taskResult.rows[0]?.id
    expect(taskResult.rows[0]?.status).toBe('triage')

    // Import and call the service
    const { promoteTriageTask } = await import('../../src/services/integrations-promote.js')
    const result = await promoteTriageTask({
      taskId: taskId as number,
      agentSlug: 'test-agent',
      targetStatus: 'todo',
    })

    // Verify success response
    expect(result).toHaveProperty('id')
    expect(result).toHaveProperty('status')
    if ('status' in result) {
      expect(result.status).toBe('todo')
    }
  })

  it('returns 404 when task not found', async () => {
    const { promoteTriageTask } = await import('../../src/services/integrations-promote.js')

    const result = await promoteTriageTask({
      taskId: 99999,
      agentSlug: 'test-agent',
      targetStatus: 'todo',
    })

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toBe('not_found')
    }
  })

  it('returns 409 when task is not in triage status', async () => {
    // Create a task in 'todo' status
    const taskResult = await db.pool.query(
      `INSERT INTO tasks (project_id, title, status, created_at)
       VALUES (
         (SELECT id FROM projects WHERE slug = 'test-project-promote'),
         'Todo Task',
         'todo',
         NOW()
       )
       RETURNING id`,
    )
    const todoTaskId = taskResult.rows[0]?.id

    const { promoteTriageTask } = await import('../../src/services/integrations-promote.js')

    const result = await promoteTriageTask({
      taskId: todoTaskId as number,
      agentSlug: 'test-agent',
      targetStatus: 'todo',
    })

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toBe('invalid_state_transition')
    }
  })

  it('logs audit trail on successful promotion', async () => {
    // Spy on console.log
    const logSpy = vi.spyOn(console, 'log')

    // Create a triage task
    const taskResult = await db.pool.query(
      `INSERT INTO tasks (project_id, title, status, created_at)
       VALUES (
         (SELECT id FROM projects WHERE slug = 'test-project-promote'),
         'Audit Log Test',
         'triage',
         NOW()
       )
       RETURNING id`,
    )
    const auditTaskId = taskResult.rows[0]?.id ?? 0

    const { promoteTriageTask } = await import('../../src/services/integrations-promote.js')

    await promoteTriageTask({
      taskId: auditTaskId,
      agentSlug: 'audit-agent',
      targetStatus: 'todo',
    })

    // Verify audit log was called — check that it was called at all with the right pattern
    expect(logSpy).toHaveBeenCalled()
    const calls = logSpy.mock.calls
    expect(calls.some((call) => String(call[0]).includes('[integrations/promote]'))).toBe(true)

    logSpy.mockRestore()
  })
})
