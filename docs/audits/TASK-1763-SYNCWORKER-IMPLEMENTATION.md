## Task #1763: SyncWorker Implementation Guide

**Status**: Ready for review ✅

**Acceptance Criteria Met:**
- ✅ Poll loop reads from sync_queue with FOR UPDATE SKIP LOCKED
- ✅ Dispatches to correct adapter based on provider column
- ✅ Updates status to 'done' or 'failed' after dispatch
- ✅ Retries tracked via retry_count
- ✅ Old rows purged (TTL 7 days for done rows)
- ✅ Graceful shutdown on SIGTERM
- ✅ Zero secrets logged
- ✅ TypeScript strict mode, ESLint passes
- ✅ Integration path documented (PM2 or boot-time call)

### Implementation Overview

**New Files:**
- `src/workers/sync-worker.ts` — Main SyncWorker class with polling, dispatch, and TTL purge logic
- `src/workers/index.ts` — Worker startup utilities (exports `startSyncWorker()` and `startCronWorker()`)

**Updated Files:**
- `src/squad-api/index.ts` — Integrated SyncWorker boot-time startup

**Key Design Decisions:**

1. **FOR UPDATE SKIP LOCKED** prevents thundering herd when multiple worker instances run concurrently
2. **At-least-once delivery semantics** — rows are updated after dispatch succeeds or fails (transactional)
3. **Retry tracking via `retry_count` column** — incremented on every failure, no backoff (yet)
4. **TTL purge** — old 'done' rows removed every poll cycle (7-day TTL per ARCH-024)
5. **Graceful shutdown** — SIGTERM handler finishes current batch before exiting
6. **No secrets logged** — only task_id, provider, status are logged; payload is never logged

### How to Test Locally

#### Prerequisite: Enable ClickUp Provider (if testing with ClickUp)

```bash
# In .env or environment:
export CLICKUP_ENABLED=true
export CLICKUP_BOT_API_TOKEN="your-test-token"
export CLICKUP_BOT_USER_ID="your-bot-user-id"
export CLICKUP_WEBHOOK_SECRET="your-secret"
```

If ClickUp is not enabled, SyncWorker will simply skip polling (no errors).

#### Test 1: Manual Row + Poll

1. **Start the system:**
   ```bash
   npm run dev
   ```
   SyncWorker starts automatically in squad-api on boot. Watch for:
   ```
   [sync-worker] Started — polling every 5s
   ```

2. **Create a test task** (via MCP or directly in the database):
   ```sql
   INSERT INTO tasks (project_id, title, description, status, owner_agent_slug)
   VALUES (1, 'Test Task', 'For sync testing', 'todo', 'test-agent')
   RETURNING id;
   ```
   Note the task ID.

3. **Create a sync_queue row** (simulate what a handler would do):
   ```sql
   INSERT INTO sync_queue (task_id, provider, payload, status)
   VALUES (
     <task_id>,
     'clickup',
     '{"title": "Test Task", "description": "For sync testing", "openHiveOS_status": "todo"}',
     'pending'
   )
   RETURNING id;
   ```

4. **Wait 5 seconds** for the poll cycle.

5. **Check the result:**
   ```sql
   SELECT id, task_id, provider, status, retry_count, dispatched_at
   FROM sync_queue
   WHERE task_id = <task_id>;
   ```

   **Expected:**
   - If ClickUp is enabled and the API call succeeds: `status='done'`, `dispatched_at=NOW()`
   - If ClickUp is not enabled: `status='pending'` (worker skips the provider)
   - If dispatch fails: `status='failed'`, `retry_count=1`, `dispatched_at=NOW()`

6. **Check logs** for dispatch outcome:
   ```
   [sync-worker] Dispatched task <id> to clickup — sync row <id> marked done
   ```
   or
   ```
   [sync-worker] Dispatch failed for task <id> to clickup. Sync row <id> marked failed ...
   ```

#### Test 2: Graceful Shutdown

1. Start the system (`npm run dev`)
2. Create a pending sync_queue row (as above)
3. Send SIGTERM to the squad-api process:
   ```bash
   kill -SIGTERM <pid>
   ```
4. Observe: Worker finishes current batch, logs `[sync-worker] Stopped`, then exits cleanly

#### Test 3: TTL Purge

1. Create an old 'done' row (manually set created_at to 8 days ago):
   ```sql
   INSERT INTO sync_queue (task_id, provider, payload, status, created_at)
   VALUES (
     1,
     'clickup',
     '{}',
     'done',
     NOW() - INTERVAL '8 days'
   );
   ```

2. Wait for the next poll cycle (5 seconds)

3. Verify the row was deleted:
   ```sql
   SELECT COUNT(*) FROM sync_queue WHERE created_at < NOW() - INTERVAL '7 days' AND status='done';
   ```
   Should return 0.

4. Check logs for:
   ```
   [sync-worker] Purged 1 old done rows
   ```

#### Test 4: FOR UPDATE SKIP LOCKED (Concurrent Workers)

1. Start two squad-api instances (different ports):
   ```bash
   SQUAD_API_PORT=3005 npm run dev  # Terminal 1
   SQUAD_API_PORT=3006 npm run dev  # Terminal 2
   ```

2. Create multiple pending rows (5+):
   ```bash
   for i in {1..5}; do
     psql -U openhiveos -d openhiveos -c \
       "INSERT INTO sync_queue (task_id, provider, payload, status)
        VALUES (1, 'clickup', '{}', 'pending')"
   done
   ```

3. Observe both workers dispatch different rows (no duplicates due to FOR UPDATE SKIP LOCKED)

4. Verify all rows marked 'done' or 'failed' (no row locked by both):
   ```sql
   SELECT status, COUNT(*) FROM sync_queue GROUP BY status;
   ```

### Integration Path

**Option 1: Boot-time startup (current implementation)**
- SyncWorker starts when squad-api starts
- No PM2 config changes needed
- Simplest for development

**Option 2: Standalone PM2 instance (future)**
- Create a separate entry in `ecosystem.config.cjs`:
  ```javascript
  {
    name: 'sync-worker',
    script: 'src/workers/sync-worker.ts',
    instances: 1,
    // ... other config
  }
  ```
- Run `pm2 start ecosystem.config.cjs`
- Allows independent scaling and restart cycles

### Architecture Notes

**ARCH-024 Decision:**
- SyncWorker is provider-neutral — no ClickUp logic lives in the worker
- All provider-specific behavior is encapsulated in `src/integrations/<provider>/`
- Adding a new provider requires only a new adapter implementation; SyncWorker code is unchanged

**Security (Locksmith C3, C8):**
- `clickup_event_id` is UNIQUE (prevents replay)
- Payload is never logged (security constraint)
- Only task_id, provider, status are logged
- Database role for DML writes is `opensquad_app` (not reader-only)

### Monitoring

**Key logs to watch:**
```
[sync-worker] Started — polling every 5s
[sync-worker] Dispatched task <id> to <provider> — sync row <id> marked done
[sync-worker] Dispatch failed for task <id> to <provider>. Sync row <id> marked failed (retry_count incremented). Error: ...
[sync-worker] Task <id> not found (deleted?). Marked sync row <id> as failed.
[sync-worker] Adapter for provider <provider> not found. Marked sync row <id> as failed.
[sync-worker] Purged <N> old done rows
[sync-worker] SIGTERM received — finishing current batch
[sync-worker] Stopped
```

### Dependency on Task #1764

Task #1764 (Status Endpoint) depends on this SyncWorker implementation. It will add:
- `/api/sync-queue/:task_id` endpoint to query sync status
- Dashboard view to track sync history

This implementation provides the foundation for that work.

### Ready for Code Review

Murphy's core responsibilities:
- ✅ At-least-once delivery semantics (transactional state updates)
- ✅ Concurrent worker safety (FOR UPDATE SKIP LOCKED)
- ✅ Zero secrets logged (security constraint)
- ✅ Error handling and retry tracking
- ✅ Graceful shutdown (SIGTERM handler)
- ✅ Clean integration path (squad-api boot or standalone)

All acceptance criteria met. Code passes linting and TypeScript strict mode. Ready for review.
