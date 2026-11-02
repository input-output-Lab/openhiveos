#!/bin/bash
# S17-OPS-03 (#2572) — Weekly price-sync wrapper for launchd.
# Fetches LiteLLM prices, diffs against llm_model_prices, writes staging report
# to logs/price-sync/, and alerts Slack when a material diff exists.
# NEVER applies — apply-prices.ts is a separate human-reviewed step.
#
# plist: ~/Library/LaunchAgents/co.inputoutput.openhiveos-price-sync.plist
# test run:  bash scripts/usage-collector/run-weekly-price-sync.sh
# logs:      logs/price-sync/price-diff-*.json + price-sync.log
# alert:     Slack #cooper via https://srv.iomx.co/droid/message when diff found
# unload:    launchctl unload ~/Library/LaunchAgents/co.inputoutput.openhiveos-price-sync.plist
set -u

REPO="/Users/richo/Sites/inputoutputco/OpenHiveOS"
OUT_DIR="$REPO/logs/price-sync"
LOG_FILE="$OUT_DIR/price-sync.log"
SLACK_URL="https://srv.iomx.co/droid/message"
SLACK_CHANNEL="cooper"

mkdir -p "$OUT_DIR"

log() { echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] $*" >> "$LOG_FILE"; }

alert() {
  # $1 = title, $2 = body
  curl -s -m 10 -X POST "$SLACK_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"text\":\"$2\",\"channel\":\"$SLACK_CHANNEL\",\"color\":\"#FF8C00\",\"title\":\"$1\",\"footer\":\"OpenHiveOS price-sync $(hostname)\"}" \
    > /dev/null 2>&1
}

log "=== price-sync start ==="
cd "$REPO" || { log "FATAL: cannot cd $REPO"; exit 1; }

# launchd has no shell env — load .env for DATABASE_URL (idempotent under shells).
set -a
# shellcheck disable=SC1091
source "$REPO/.env" 2>/dev/null || { log "FATAL: cannot source $REPO/.env"; exit 1; }
set +a

set +e
npx tsx scripts/usage-collector/sync-prices.ts >> "$LOG_FILE" 2>&1
SYNC_EXIT=$?
set -e

case $SYNC_EXIT in
  0)
    log "no material changes"
    ;;
  10)
    log "DIFF FOUND — alerting for human review"
    CHANGED=$(python3 -c "
import json
r = json.load(open('$OUT_DIR/latest-diff.json'))
print(', '.join(c['canonical_slug'] for c in r['changed']))
" 2>/dev/null || echo 'see latest-diff.json')
    alert "OpenHiveOS price-sync: CHANGES DETECTED" "Material price diffs for: $CHANGED. Report: logs/price-sync/latest-diff.json. Review then apply with apply-prices.ts. (No auto-apply — SC-2.)"
    ;;
  *)
    log "ERROR: sync-prices exited $SYNC_EXIT"
    alert "OpenHiveOS price-sync FAILED" "sync-prices.ts exited $SYNC_EXIT at $(date '+%Y-%m-%d %H:%M %Z'). Check $LOG_FILE"
    exit 1
    ;;
esac

# Retention: keep 26 weeks of diff reports.
find "$OUT_DIR" -name 'price-diff-*.json' -mtime +182 -delete 2>/dev/null || true

log "=== price-sync end ==="
exit 0
