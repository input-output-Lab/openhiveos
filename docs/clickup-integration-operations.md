---
title: "ClickUp Integration Operations"
date: 2026-06-13
updated: 2026-06-13
author: "Cooper, Clarence"
owner: "Cooper"
status: active
version: "1.0"
review_date: 2026-09-13
tags:
  - type/sop
  - project/openhiveos
  - domain/backend
  - domain/integrations
  - audience/ops
doc_id: "SOP-CLICKUP-OPS"
related:
  - "[[ARCH-024-external-task-sync-clickup-async-queue]]"
  - "[[sprint-workflow]]"
---

# ClickUp Integration Operations

> [!info] Ownership
> **Owner:** Cooper (DevOps) · **Co-author:** Clarence (Documentation) · **Last Updated:** 2026-06-13 · **Next Review:** 2026-09-13

---

## Purpose

This SOP defines how to operate, monitor, and troubleshoot the ClickUp integration in OpenHiveOS. It covers SyncWorker health monitoring, bot permission management, webhook credential rotation, dead-letter queue investigation, and the inbound task triage process.

If the SyncWorker is not pushing status updates to ClickUp, or if tasks are not appearing from ClickUp, start here.

---

## Audience

**Cooper** (DevOps) — primary operator. This is your runbook.

**Clarence** (Documentation) — responsible for keeping this SOP current after each sprint that touches the integration.

**Elizabeth** (PM) — read-only reference. If a task is stuck in `done` in OpenSquad but not `Closed` in ClickUp after 60 seconds, raise it to Cooper using this SOP.

---

## Prerequisites

- Access to the OpenHiveOS server (SSH or local terminal).
- `.env` loaded: run `set -a && source .env && set +a` before any terminal commands below.
- PM2 access: verify with `pm2 status`.
- ClickUp Workspace Admin access (required only for bot permission changes and webhook registration).
- 1Password access to retrieve or rotate secrets.

---

## Expected Outcome

After following any procedure in this SOP:
- The sync_queue is draining normally (pending count at or near 0).
- The SyncWorker is processing status changes from OpenSquad to ClickUp within ~5 seconds.
- Operators can verify ClickUp task statuses match OpenSquad without manual intervention.

---

## Troubleshooting (Quick Reference)

Start here before running any full procedure.

| Symptom | Most Likely Cause | Go To |
|---|---|---|
| ClickUp tasks not updating | SyncWorker down or API token invalid | [Section 2 — SyncWorker Health](#2-syncworker-health-monitoring) |
| Many failed sync_queue entries | Bad API token or bot lacks list access | [Section 3 — Dead-Letter Queue](#3-dead-letter-queue-investigation) |
| Inbound ClickUp task not appearing | Webhook not registered or signature mismatch | [Section 4 — Webhook Secret Rotation](#4-webhook-secret-rotation) |
| Triage inbox growing | Inbound tasks pending review | [Section 5 — Triage Promotion](#5-inbound-task-triage-promotion-workflow) |

---

## 1. Bot Account Permission Scoping

### Purpose

The ClickUp bot account (identified by `CLICKUP_BOT_USER_ID` in `.env`) must only have access to the specific lists it needs to operate. This limits the damage if credentials are ever compromised.

**Minimum required access:**
- `OpenHiveOS Backlog` — reads and writes task updates from stakeholder submissions
- `OpenHiveOS Sprint [N]` (current active sprint) — reads and writes active sprint task updates

**When to run this procedure:**
- After initial ARCH-024 deployment
- At the start of each new sprint (update the sprint list the bot can access)
- After a security incident involving the bot credentials

### Procedure: Scope Bot to Minimum Lists

**Prerequisite:** Access to ClickUp workspace admin console. Only IO Labs workspace Admins can manage bot permissions.

#### Step 1: Identify the Bot User

1. Log into ClickUp as an Admin: https://app.clickup.com/
2. Navigate to **Workspace Settings** (gear icon, top-left)
3. Select **Apps & Integrations** → **API Apps** (or **Installed Apps**)
4. Find the **OpenHiveOS Bot** entry (bot user created for this integration)
5. Note the bot's display name and ID (match against `CLICKUP_BOT_USER_ID` in `.env`)

#### Step 2: Review Current Access

1. Click on the OpenHiveOS Bot to view its details
2. Check which Lists the bot currently has access to (should be displayed under "List Access" or "Workspaces" section)
3. Record the current scope for audit purposes

#### Step 3: Remove Unnecessary List Access

1. From the bot details page, locate the **Remove Access** or **Revoke** option for each list the bot should NOT access
2. **Remove access** from all lists EXCEPT:
   - `OpenHiveOS Backlog`
   - `OpenHiveOS Sprint 11` (or the current active sprint label)
3. Note: If the bot is granted workspace-level access, you may only be able to grant/revoke at the workspace level. In that case, note this limitation for the audit trail and document in the incident runbook.

#### Step 4: Grant Access to Required Lists (if not already granted)

1. Ensure the bot account has READ + WRITE access to:
   - `OpenHiveOS Backlog`
   - `OpenHiveOS Sprint 11`
2. Verify the permission level: should be **Can Create/Edit/Delete** or **Team Member** equivalent (not "View Only")

#### Step 5: Verify Bot Access

1. Switch to a terminal and verify connectivity:

```bash
# Test bot API token against the ClickUp API
# This command should succeed if the token is valid

curl -s -X GET "https://api.clickup.com/api/v2/user" \
  -H "Authorization: $CLICKUP_BOT_API_TOKEN" | jq '.user | {id, email, username}'
```

Expected output (example):
```json
{
  "id": "123456789",
  "email": "openhiveos-bot@clickup.io",
  "username": "OpenHiveOS Bot"
}
```

2. Verify the bot can read tasks in the Backlog list:

```bash
# Get the Backlog list ID from ClickUp UI (Settings > Lists > OpenHiveOS Backlog > copy ID from URL)
LIST_ID="<paste_list_id_here>"

curl -s -X GET "https://api.clickup.com/api/v2/list/$LIST_ID/task" \
  -H "Authorization: $CLICKUP_BOT_API_TOKEN" | jq '.tasks | length'
```

This should return a number (count of tasks in the list). If you get a 403 or 404 error, the bot lacks access to this list.

#### Step 6: Document the Scoping Decision

Create or update the **ClickUp Bot Access Audit Log** (in Obsidian or team docs):

- **Date:** 2026-06-13
- **Actor:** Cooper
- **Action:** Scope bot account to Backlog + Sprint 11 lists
- **Rationale:** ARCH-024 security posture — minimum required access
- **Lists Before:** [list all lists the bot had access to before]
- **Lists After:** `OpenHiveOS Backlog`, `OpenHiveOS Sprint 11`
- **Verification:** Bot API token tested successfully against ClickUp v2 API; read access confirmed to Backlog list

### Rollback Procedure

If the bot scoping causes operational issues (e.g., the bot cannot sync tasks in a necessary list):

1. Add the affected list back to the bot's access scope in ClickUp workspace settings
2. Verify the issue is resolved by checking sync_queue for successful messages
3. Escalate to Elizabeth + Silas to determine if the scope definition was incomplete
4. Update this SOP with the corrected list scope

---

## 2. SyncWorker Health Monitoring

### Overview

The SyncWorker is a background process embedded in the `squad-api` service (started at squad-api startup via `startSyncWorker(pool)`). It is **not** a separate PM2 process. It polls the `sync_queue` table every 10–30 seconds and dispatches pending synchronization tasks (currently only ClickUp updates).

### Health Check Procedure

#### Check 1: Verify SyncWorker is Running

```bash
# SyncWorker runs inside squad-api; verify squad-api is healthy
pm2 status squad-api

# Expected output:
# ✓ squad-api online (or similar "online" status)
```

If squad-api is stopped or errored, restart it:

```bash
pm2 restart squad-api
pm2 logs squad-api --lines 50  # Review logs for startup errors
```

#### Check 2: Monitor sync_queue Activity

```bash
# Connect to OpenHiveOS database and check queue state
cd /Users/richo/Sites/inputoutputco/OpenHiveOS
set -a && source .env && set +a

# Check pending queue entries
psql "$DATABASE_URL" -c "
SELECT COUNT(*) as pending_count FROM sync_queue WHERE status = 'pending' OR retry_count > 0;
SELECT COUNT(*) as done_count FROM sync_queue WHERE status = 'done' AND created_at > NOW() - INTERVAL '1 hour';
"
```

Expected output:
- `pending_count` should be 0 or very small (processed within 10–30 seconds)
- `done_count` should reflect recent task updates (if any occurred in the past hour)

#### Check 3: Inspect Failed Sync Operations

```bash
# List all failed sync operations (retry_count > 2)
psql "$DATABASE_URL" -c "
SELECT id, task_id, provider, status, retry_count, created_at, updated_at
FROM sync_queue
WHERE retry_count > 2 OR status = 'failed'
ORDER BY updated_at DESC
LIMIT 20;
"
```

If you see many failures:
1. Check squad-api logs for ClickUp API errors
2. Verify CLICKUP_BOT_API_TOKEN is valid (see Step 5 in "Scope Bot" section above)
3. Check ClickUp API status page: https://status.clickup.com/

#### Check 4: Review Recent Logs

```bash
# Tail squad-api logs for SyncWorker activity
pm2 logs squad-api --lines 100 | grep -i "syncworker\|clickup"
```

Look for messages like:
- `[clickup-sync] Task <id> synced to ClickUp successfully` (✓ good)
- `[clickup-sync] Task <id> sync to ClickUp failed: ...` (⚠️ investigate)

---

## 3. Dead-Letter Queue Investigation

### When to Use This Procedure

- SyncWorker logs show repeated failures for the same task(s)
- `sync_queue` shows entries with `status = 'failed'` and `retry_count > 3`
- Stakeholders report that OpenHiveOS task updates are not appearing in ClickUp

### Investigation Steps

#### Step 1: Identify Dead-Letter Entries

```bash
cd /Users/richo/Sites/inputoutputco/OpenHiveOS
set -a && source .env && set +a

psql "$DATABASE_URL" -c "
SELECT id, task_id, provider, payload, status, retry_count, error_message, created_at, updated_at
FROM sync_queue
WHERE retry_count > 3 OR (status = 'failed' AND updated_at < NOW() - INTERVAL '5 minutes')
ORDER BY updated_at DESC;
"
```

For each dead-letter entry, note:
- `task_id` (link to OpenHiveOS task)
- `error_message` (reason for failure)
- `retry_count` (how many times retry was attempted)

#### Step 2: Root Cause Analysis

Common failure causes (in order of likelihood):

| Cause | Symptom | Resolution |
|-------|---------|-----------|
| **Invalid ClickUp API token** | All sync_queue entries fail immediately | Verify CLICKUP_BOT_API_TOKEN in .env; regenerate in ClickUp if expired |
| **Bot lacks access to target list** | Errors mention "403 Forbidden" or "Task not found" | Use "Scope Bot to Minimum Lists" procedure to grant access to required lists |
| **ClickUp API rate limit** | Failures spike at certain times; "429 Too Many Requests" error | Backoff is exponential (1s, 2s, 4s); check queue size; may need to slow polling interval |
| **External task link missing** | Error message "Task <id> not linked to ClickUp" | Task exists in OpenHiveOS but has no corresponding ClickUp external_id in `external_task_links` table |
| **ClickUp API outage** | Many failures within short time window; check https://status.clickup.com/ | Wait for ClickUp to recover; manual retry after recovery |

#### Step 3: Remediate

**If the cause is an invalid token:**
1. Regenerate CLICKUP_BOT_API_TOKEN in ClickUp workspace settings
2. Update .env with the new token
3. Restart squad-api: `pm2 restart squad-api`
4. Monitor: `pm2 logs squad-api --lines 50 | grep clickup`

**If the cause is missing bot access:**
1. Run the "Scope Bot to Minimum Lists" procedure above
2. No restart needed; SyncWorker will retry automatically on next poll

**If the cause is missing external_task_link:**
1. Check if the task should have a corresponding ClickUp ID:
   ```bash
   psql "$DATABASE_URL" -c "
   SELECT id, title, status FROM tasks WHERE id = <task_id>;
   SELECT * FROM external_task_links WHERE task_id = <task_id>;
   "
   ```
2. If the task should not sync to ClickUp, manually delete the sync_queue entry:
   ```bash
   psql "$DATABASE_URL" -c "
   DELETE FROM sync_queue WHERE id = <sync_queue_id> AND retry_count > 3;
   "
   ```

**If the cause is ClickUp API outage:**
1. Wait for ClickUp to recover (monitor https://status.clickup.com/)
2. No action needed; SyncWorker will retry automatically (exponential backoff)
3. If failures persist after recovery, escalate to Silas (architect)

#### Step 4: Monitor Resolution

After remediation:
```bash
# Check that pending queue is clearing
watch -n 10 "psql \"$DATABASE_URL\" -c \"SELECT COUNT(*) FROM sync_queue WHERE status != 'done';\""

# Exit with Ctrl+C when queue is clear
```

---

## 4. Webhook Secret Rotation

### Context

ClickUp sends inbound webhook payloads to `POST /api/webhooks/clickup`. Each payload is signed with HMAC-SHA256 using the `CLICKUP_WEBHOOK_SECRET`. OpenHiveOS verifies this signature before processing any inbound event (security gate: prevents injection attacks).

**Security principle:** Rotate secrets on a schedule (recommended: every 90 days) or immediately if compromised.

### Rotation Procedure

#### Step 1: Generate a New Secret

```bash
# Generate a new 64-byte (512-bit) random secret
NEW_SECRET=$(openssl rand -hex 32)
echo "New secret: $NEW_SECRET"

# Store this secret securely (e.g., 1Password)
```

#### Step 2: Update ClickUp Webhook Configuration

1. Log into ClickUp as an Admin
2. Navigate to **Workspace Settings** → **Webhooks** (or **API Apps** → OpenHiveOS Bot)
3. Find the webhook registered for `POST /api/webhooks/clickup`
4. Edit the webhook and update the **Signing Secret** or **HMAC Secret** field with `$NEW_SECRET`
5. Save the webhook configuration in ClickUp

#### Step 3: Update OpenHiveOS Configuration

1. Update `.env`:
   ```bash
   CLICKUP_WEBHOOK_SECRET=$NEW_SECRET
   ```

2. Restart squad-api to load the new secret:
   ```bash
   pm2 restart squad-api
   pm2 logs squad-api --lines 50
   ```

3. Verify the new secret is loaded:
   ```bash
   # Check that no webhook verification errors appear in logs
   pm2 logs squad-api | grep -i "webhook\|hmac\|signature" | head -20
   ```

#### Step 4: Test Inbound Webhooks (Optional)

Trigger a test ClickUp event (e.g., create a new task in ClickUp) and verify it is received:

```bash
psql "$DATABASE_URL" -c "
SELECT id, external_task_id, provider, sync_state, created_at
FROM external_task_links
WHERE provider = 'clickup'
ORDER BY created_at DESC
LIMIT 1;
"
```

If a new entry appears within 30 seconds of your test action, webhooks are working.

#### Step 5: Document the Rotation

Update the **Secret Rotation Audit Log**:
- **Date:** 2026-06-13 (example)
- **Secret:** CLICKUP_WEBHOOK_SECRET
- **Actor:** Cooper
- **Action:** Rotated; old secret revoked
- **Rationale:** [routine 90-day rotation / security incident / etc.]

---

## 5. Inbound Task Triage Promotion Workflow

### Context

When ClickUp sends an inbound webhook event (e.g., a stakeholder creates a task in ClickUp), it is received at `POST /api/webhooks/clickup`, verified, and inserted into `external_task_links` with `sync_state: 'triage'`. The task is now pending **agent promotion** before it enters the active OpenHiveOS task set.

**Human-in-the-loop review:** This prevents noise and ensures only legitimate external submissions become OpenHiveOS work items.

### Promotion Procedure

#### Step 1: List Pending Triage Tasks

```bash
cd /Users/richo/Sites/inputoutputco/OpenHiveOS
set -a && source .env && set +a

psql "$DATABASE_URL" -c "
SELECT 
  etl.id,
  etl.external_id,
  etl.external_url,
  etl.sync_state,
  etl.created_at,
  etl.metadata
FROM external_task_links etl
WHERE etl.sync_state = 'triage'
ORDER BY etl.created_at ASC;
"
```

#### Step 2: Review Each Task in ClickUp

For each pending triage task:
1. Open the external_url in ClickUp
2. Review:
   - Task title and description
   - Assigned to (check if it's a team member or unknown submitter)
   - Priority / Due date
   - Any attachments or context
3. Make a decision: **Promote** (add to OpenHiveOS backlog) or **Reject** (mark as spam/duplicate)

#### Step 3a: Promote Task (Add to OpenHiveOS)

If the task is legitimate and should be worked on:

```bash
# Update sync_state to 'promoted'
psql "$DATABASE_URL" -c "
UPDATE external_task_links
SET sync_state = 'promoted', updated_at = NOW()
WHERE id = <link_id> AND sync_state = 'triage';
"

# Elizabeth then creates a corresponding OpenHiveOS task (via the standard intake SOP)
# and links it back to the ClickUp task via external_task_links.task_id
```

#### Step 3b: Reject Task (Mark as Spam/Not Relevant)

If the task is spam, off-topic, or a duplicate:

```bash
psql "$DATABASE_URL" -c "
UPDATE external_task_links
SET sync_state = 'rejected', metadata = jsonb_set(metadata, '{rejection_reason}', '\"spam\" or \"duplicate\" or \"out of scope\"')
WHERE id = <link_id> AND sync_state = 'triage';
"

# Optionally, close the task in ClickUp manually or via SyncWorker update
```

---

## 6. Runbook: Production Incident — Sync Failures

### Symptom

- Developers report that task updates in OpenHiveOS do not appear in ClickUp within 5 minutes
- Multiple failures appear in `sync_queue` table
- squad-api logs show repeated ClickUp API errors

### Immediate Response (First 5 Minutes)

1. **Check SyncWorker Health:**
   ```bash
   pm2 status squad-api
   pm2 logs squad-api --lines 100 | tail -50
   ```

2. **Check ClickUp API Status:**
   - Navigate to https://status.clickup.com/ (in browser)
   - If ClickUp is experiencing an outage, document and wait for recovery
   - No further action needed; SyncWorker will auto-retry

3. **Check queue depth:**
   ```bash
   psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM sync_queue WHERE status != 'done';"
   ```
   - If queue > 100: likely a rate-limiting or connectivity issue

### Diagnostic Phase (5–15 Minutes)

1. **Check bot API token validity:**
   ```bash
   curl -s -X GET "https://api.clickup.com/api/v2/user" \
     -H "Authorization: $CLICKUP_BOT_API_TOKEN" | jq '.user.id'
   ```
   - If error: token is invalid; regenerate in ClickUp and restart squad-api

2. **Check bot list access:**
   ```bash
   # Get Backlog list ID from ClickUp; then test:
   curl -s -X GET "https://api.clickup.com/api/v2/list/<LIST_ID>/task?limit=1" \
     -H "Authorization: $CLICKUP_BOT_API_TOKEN"
   ```
   - If 403 Forbidden: bot lacks access; run "Scope Bot to Minimum Lists" procedure

3. **Inspect specific failure:**
   ```bash
   psql "$DATABASE_URL" -c "
   SELECT id, task_id, error_message, retry_count
   FROM sync_queue
   WHERE status = 'failed'
   ORDER BY updated_at DESC LIMIT 1;
   " | jq '.error_message'
   ```

### Resolution

- If **ClickUp outage:** Wait for recovery; monitor queue clearing
- If **invalid token:** Regenerate and restart squad-api
- If **bot access denied:** Add bot to required lists
- If **other error:** Escalate to Silas (architect) with error_message + sync_queue context

### Post-Incident

- Document the incident in the Status Page (external communication)
- Run a brief RCA (root cause analysis):
  - What was the failure mode?
  - Why wasn't it caught before it impacted developers?
  - What runbook improvement or monitoring enhancement is needed?
- Update this SOP if needed

---

## Appendix A: Useful Queries

### List All Pending Sync Operations

```sql
SELECT id, task_id, provider, status, retry_count, created_at
FROM sync_queue
WHERE status != 'done'
ORDER BY created_at DESC;
```

### Count Successful Syncs in the Last Hour

```sql
SELECT COUNT(*) as synced_today
FROM sync_queue
WHERE status = 'done' AND created_at > NOW() - INTERVAL '1 hour';
```

### Find External Task Links with No OpenHiveOS Task

```sql
SELECT etl.id, etl.external_id, etl.provider, etl.created_at
FROM external_task_links etl
LEFT JOIN tasks t ON etl.task_id = t.id
WHERE t.id IS NULL;
```

### Export ClickUp Task URLs for Manual Review

```sql
SELECT etl.external_url, etl.sync_state, etl.created_at
FROM external_task_links etl
WHERE provider = 'clickup'
ORDER BY created_at DESC;
```

---

## Appendix B: Emergency Contacts

- **Integration Owner:** Silas (Architect)
- **DevOps Owner:** Cooper
- **Product Owner:** Elizabeth
- **Security Review:** Locksmith (for credential rotation or security incidents)

---

---

## Related Documents

- [[ARCH-024-external-task-sync-clickup-async-queue|ARCH-024 — External Task Sync: ClickUp Async Queue]] — Architecture decision that defined the SyncWorker, sync_queue, and adapter pattern this SOP operates against.
- [[sprint-workflow|Sprint Workflow SOP v1.4]] — The sprint workflow SOP. References this document for sync failure investigation.
- [[ARCH-023-pending-close-task-state-machine|ARCH-023 — pending-close Status in Task State Machine]] — The M3 gate that code-enforces Elizabeth-only task closure.

---

## Version History

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-06-13 | Cooper | Initial draft — bot scoping, SyncWorker health, dead-letter queue, webhook rotation, triage workflow, incident runbook |
| 1.0.1 | 2026-06-13 | Clarence | Frontmatter, Audience, Prerequisites, Expected Outcome, Troubleshooting quick reference, related docs, version history — Clarence Standard review |

---

**Owner:** Cooper · **Review Date:** 2026-09-13 · **Doc ID:** SOP-CLICKUP-OPS
