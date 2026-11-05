/**
 * S18-BE-02 (#2559) — Integration: signed merge event → task transition,
 * replay dedup, and fail-closed no-op paths. Requires RUN_INTEGRATION=1.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHmac } from 'node:crypto'
import { Client } from 'pg'
import request from 'supertest'
import { createSquadApiApp } from '../../src/squad-api/server.js'

const RUN = process.env['RUN_INTEGRATION'] === '1' && !!process.env['TEST_DATABASE_URL']
const DBURL = process.env['TEST_DATABASE_URL']!
const d = it.skipIf(!RUN)

const SECRET = 'integration-webhook-secret'
// Unique per test (run-scoped): strays from earlier failed runs can never
// collide with this run's transition WHERE github_pr_url = $1 clause.
const RUN_TAG = `itest-2559-${Date.now()}`
const prUrlFor = (label: string): string => `https://github.com/input-output-lab/openhiveos/pull/99${label}`
const PROJECT_ID = 70n

function sign(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`
}

async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DBURL })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

async function insertReviewTask(prUrl: string): Promise<bigint> {
  return withDb(async (client) => {
    const result = await client.query<{ id: bigint }>(
      `INSERT INTO tasks (project_id, title, status, github_pr_url, estimated_hours, created_at, updated_at)
       VALUES ($1, 'INTEGRATION-2559 temp task', 'review', $2, 1, now(), now())
       RETURNING id`,
      [PROJECT_ID, prUrl],
    )
    return result.rows[0]!.id
  })
}

async function deleteTask(taskId: bigint): Promise<void> {
  await withDb(async (client) => {
    await client.query('DELETE FROM task_status_history WHERE task_id = $1', [taskId])
    await client.query('DELETE FROM tasks WHERE id = $1', [taskId])
    await client.query("DELETE FROM inbound_events WHERE provider = 'github' AND provider_event_id LIKE 'itest-2559-%'")
  })
}

// Sweep stray temp tasks from earlier failed runs (they share the PR URL and
// would collide on the transition's WHERE github_pr_url = $1 clause).
async function sweepStrayTasks(): Promise<void> {
  await withDb(async (client) => {
    const strays = await client.query<{ id: bigint }>(
      "SELECT id FROM tasks WHERE title = 'INTEGRATION-2559 temp task'",
    )
    for (const row of strays.rows) await deleteTask(row.id)
  })
}

describe('POST /webhooks/github — integration (transition + dedup)', () => {
  let app: ReturnType<typeof createSquadApiApp>
  const originalSecret = process.env['GITHUB_WEBHOOK_SECRET']

  beforeAll(async () => {
    process.env['GITHUB_WEBHOOK_SECRET'] = SECRET
    process.env['NODE_ENV'] = 'development' // enable rate limiter path realism
    app = createSquadApiApp()
    if (RUN) await sweepStrayTasks()
  })

  afterAll(() => {
    if (originalSecret === undefined) delete process.env['GITHUB_WEBHOOK_SECRET']
    else process.env['GITHUB_WEBHOOK_SECRET'] = originalSecret
  })

  d('signed merge event transitions review→pending-close and records audit history', async () => {
    const prUrl = prUrlFor('11')
    const taskId = await insertReviewTask(prUrl)
    try {
      const body = JSON.stringify({
        action: 'closed',
        pull_request: { merged: true, html_url: prUrl, merged_by: { login: 'elizabeth' } },
      })
      const res = await request(app)
        .post('/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', sign(body))
        .set('X-GitHub-Delivery', `${RUN_TAG}-transition-1`)
        .send(body)

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('transitioned')

      await withDb(async (client) => {
        const status = await client.query('SELECT status FROM tasks WHERE id = $1', [taskId])
        expect(status.rows[0]?.status).toBe('pending-close')

        // Attribution written by the trg_tasks_lifecycle audit trigger from
        // hive.actor (set via withActor) — NOT by a manual history insert.
        const history = await client.query(
          "SELECT from_status, to_status, changed_by FROM task_status_history WHERE task_id = $1 AND to_status = 'pending-close'",
          [taskId],
        )
        expect(history.rows.length).toBe(1)
        expect(history.rows[0]?.from_status).toBe('review')
        expect(history.rows[0]?.changed_by).toBe('system:github-webhook-elizabeth')
      })
    } finally {
      await deleteTask(taskId)
    }
  })

  d('replayed delivery is deduplicated (200 duplicate, no double transition)', async () => {
    const prUrl = prUrlFor('22')
    const taskId = await insertReviewTask(prUrl)
    try {
      const body = JSON.stringify({
        action: 'closed',
        pull_request: { merged: true, html_url: prUrl, merged_by: { login: 'elizabeth' } },
      })
      const headers = {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': sign(body),
        'X-GitHub-Delivery': `${RUN_TAG}-replay-1`,
      }

      const first = await request(app).post('/webhooks/github').set(headers).send(body)
      expect(first.body.status).toBe('transitioned')

      const replay = await request(app).post('/webhooks/github').set(headers).send(body)
      expect(replay.status).toBe(200)
      expect(replay.body.status).toBe('duplicate')

      await withDb(async (client) => {
        // Status unchanged by the replay (still pending-close from first, no history spam)
        const historyCount = await client.query(
          "SELECT count(*)::int AS n FROM task_status_history WHERE task_id = $1 AND to_status = 'pending-close'",
          [taskId],
        )
        expect(historyCount.rows[0].n).toBe(1)
      })
    } finally {
      await deleteTask(taskId)
    }
  })

  d('no-op is fail-closed: task not in review stays untouched', async () => {
    const prUrl = prUrlFor('33')
    // Same PR but task already pending-close → handler must not touch it
    const taskId = await insertReviewTask(prUrl)
    try {
      await withDb(async (client) => {
        await client.query("UPDATE tasks SET status = 'pending-close' WHERE id = $1", [taskId])
      })

      const body = JSON.stringify({
        action: 'closed',
        pull_request: { merged: true, html_url: prUrl, merged_by: { login: 'elizabeth' } },
      })
      const res = await request(app)
        .post('/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', sign(body))
        .set('X-GitHub-Delivery', `${RUN_TAG}-noop-1`)
        .send(body)

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('no_matching_task')

      await withDb(async (client) => {
        const historyCount = await client.query(
          "SELECT count(*)::int AS n FROM task_status_history WHERE task_id = $1 AND changed_by LIKE 'github-webhook%'",
          [taskId],
        )
        expect(historyCount.rows[0].n).toBe(0)
      })
    } finally {
      await deleteTask(taskId)
    }
  })
})
