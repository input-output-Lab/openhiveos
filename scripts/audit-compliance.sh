#!/usr/bin/env bash
# scripts/audit-compliance.sh — S18-QA-02 (task 2563) compliance audit
# Owner: Scout. Re-runnable: run on 2026-11-16 for the final one-week window.
#
# The four compliance metrics from the L10 2026-10-29 spec:
#   M1 % tasks created with all four estimate fields
#   M2 % sessions with non-zero task-attributed usage
#   M3 % done tasks with worklogs
#   M4 approver rule adherence (pending-close -> done)
#
# Usage: ./scripts/audit-compliance.sh [window_days]
set -euo pipefail
cd "$(dirname "$0")/.."

WINDOW="${1:-7}"
DB_URL="$(grep '^DATABASE_URL' .env | cut -d= -f2-)"
psql "$DB_URL" -P pager=off <<SQL
\echo === S18-QA-02 compliance audit — window: ${WINDOW} days — $(date -u +%Y-%m-%dT%H:%M:%SZ) ===

\echo '' 
\echo '--- M1: % tasks with all four estimate fields (per agent) ---'
SELECT assignee_agent_slug AS agent,
       COUNT(*) AS tasks,
       ROUND(100.0 * COUNT(*) FILTER (
         WHERE estimated_hours IS NOT NULL
           AND billing_low IS NOT NULL
           AND billing_high IS NOT NULL
           AND estimate_confidence IS NOT NULL
       ) / COUNT(*), 1) AS pct_compliant
  FROM tasks
 WHERE created_at >= now() - interval '${WINDOW} days'
   AND assignee_agent_slug IS NOT NULL
 GROUP BY assignee_agent_slug
 ORDER BY pct_compliant DESC, tasks DESC;

\echo ''
\echo '--- M2: usage attribution (per agent) ---'
SELECT agent_slug AS agent,
       COUNT(*) AS usage_rows,
       COUNT(DISTINCT session_id) AS sessions,
       ROUND(100.0 * COUNT(*) FILTER (WHERE task_id IS NOT NULL) / COUNT(*), 1) AS pct_task_attributed,
       ROUND(100.0 * COUNT(*) FILTER (WHERE cost_usd > 0) / COUNT(*), 1) AS pct_cost_nonzero
  FROM llm_usage
 WHERE recorded_at >= now() - interval '${WINDOW} days'
 GROUP BY agent_slug
 ORDER BY usage_rows DESC;

\echo ''
\echo '--- M3: % done tasks with worklogs ---'
SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE w.task_id IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct_with_worklogs,
       COUNT(*) AS done_total,
       COUNT(*) FILTER (WHERE w.task_id IS NULL) AS without_worklogs,
       (SELECT COUNT(*) FROM task_worklogs) AS worklog_rows_total
  FROM tasks t
  LEFT JOIN (SELECT DISTINCT task_id FROM task_worklogs) w ON w.task_id = t.id
 WHERE t.status = 'done';

\echo ''
\echo '--- M4: approver adherence on pending-close -> done (window) ---'
SELECT COUNT(*) AS done_transitions,
       COUNT(*) FILTER (WHERE changed_by = 'system:sql') AS unattributed_sql,
       COUNT(*) FILTER (WHERE changed_by = 'nova') AS nova_approved,
       COUNT(*) FILTER (WHERE changed_by NOT IN ('system:sql','nova','system:auto_close')
                        AND changed_by IS NOT NULL) AS other_actor
  FROM task_status_history
 WHERE from_status = 'pending-close'
   AND to_status = 'done'
   AND changed_at >= now() - interval '${WINDOW} days';

\echo ''
\echo '--- M4b: unattributed done transitions detail (sample, latest 10) ---'
SELECT task_id, changed_by, changed_at::timestamp(0) AS at
  FROM task_status_history
 WHERE from_status = 'pending-close' AND to_status = 'done' AND changed_by = 'system:sql'
   AND changed_at >= now() - interval '${WINDOW} days'
 ORDER BY changed_at DESC
 LIMIT 10;
SQL
