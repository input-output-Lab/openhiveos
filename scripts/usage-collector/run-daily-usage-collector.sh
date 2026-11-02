#!/bin/bash
# S17-OPS-02 (#2571) — Daily usage-collector wrapper for launchd.
# Local-only file (NOT in git), consistent with ecosystem.config.cjs handling.
# Runbook:
#   install:   cp scripts/usage-collector/run-daily-usage-collector.sh /usr/local/bin/ 2>/dev/null || true
#              (keep at $HOME/Sites/inputoutputco/OpenHiveOS/scripts/usage-collector/ and point plist at it)
#   plist:     ~/Library/LaunchAgents/co.inputoutput.openhiveos-usage-collector.plist
#   test run:  bash scripts/usage-collector/run-daily-usage-collector.sh
#   logs:      logs/usage-collector/usage-*.json + collector.log
#   alert:     Slack #cooper via https://srv.iomx.co/droid/message when newest output >26h old
#   unload:    launchctl unload ~/Library/LaunchAgents/co.inputoutput.openhiveos-usage-collector.plist
set -u

REPO="/Users/richo/Sites/inputoutputco/OpenHiveOS"
OUT_DIR="$REPO/logs/usage-collector"
LOG_FILE="$OUT_DIR/collector.log"
SLACK_URL="https://srv.iomx.co/droid/message"
SLACK_CHANNEL="cooper"
MAX_AGE_HOURS=26
RETENTION_DAYS=90

mkdir -p "$OUT_DIR"

log() { echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] $*" >> "$LOG_FILE"; }

alert() {
  # $1 = title, $2 = body
  curl -s -m 10 -X POST "$SLACK_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"text\":\"$2\",\"channel\":\"$SLACK_CHANNEL\",\"color\":\"#DC143C\",\"title\":\"$1\",\"footer\":\"OpenHiveOS usage-collector $(hostname)\"}" \
    > /dev/null 2>&1
}

log "=== run start ==="

# 1. Collect. --since yesterday so each run captures the last 24h window.
cd "$REPO" || { log "FATAL: cannot cd $REPO"; exit 1; }
SINCE=$(date -u -v-1d '+%Y-%m-%dT%H:%M:%SZ')
OUT_BEFORE=$(ls "$OUT_DIR"/usage-*.json 2>/dev/null | wc -l | tr -d ' ')

if ! npx tsx src/scripts/collect-usage.ts --since "$SINCE" --out "$OUT_DIR" >> "$LOG_FILE" 2>&1; then
  log "ERROR: collector run failed"
  alert "OpenHiveOS usage-collector FAILED" "Collector run failed at $(date '+%Y-%m-%d %H:%M %Z'). Check $LOG_FILE"
  exit 1
fi

OUT_AFTER=$(ls "$OUT_DIR"/usage-*.json 2>/dev/null | wc -l | tr -d ' ')
log "collector ok (files: $OUT_BEFORE -> $OUT_AFTER)"

# 2. Retention sweep — delete outputs older than RETENTION_DAYS.
DELETED=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if [ "$(find "$f" -mtime +$RETENTION_DAYS 2>/dev/null | wc -l | tr -d ' ')" -ge 1 ]; then
    rm -f "$f" && DELETED=$((DELETED + 1))
  fi
done < <(ls "$OUT_DIR"/usage-*.json 2>/dev/null)
log "retention sweep: removed $DELETED file(s) older than ${RETENTION_DAYS}d"

# 3. Freshness check — alert if newest output is older than MAX_AGE_HOURS.
NEWEST=$(ls -t "$OUT_DIR"/usage-*.json 2>/dev/null | head -1)
if [ -z "$NEWEST" ]; then
  log "ALERT: no output files exist at all"
  alert "OpenHiveOS usage-collector: NO OUTPUT" "No usage-*.json found in $OUT_DIR. Collector has never succeeded. Check $LOG_FILE"
  exit 2
fi

NEWEST_MTIME=$(stat -f %m "$NEWEST")
NOW_EPOCH=$(date +%s)
AGE_HOURS=$(( (NOW_EPOCH - NEWEST_MTIME) / 3600 ))
if [ "$AGE_HOURS" -gt "$MAX_AGE_HOURS" ]; then
  log "ALERT: newest output is ${AGE_HOURS}h old (> ${MAX_AGE_HOURS}h): $NEWEST"
  alert "OpenHiveOS usage-collector STALE" "Newest output is ${AGE_HOURS}h old (threshold ${MAX_AGE_HOURS}h): $(basename "$NEWEST"). Collector may have stopped. Check $LOG_FILE"
  exit 3
fi

log "freshness ok (newest: $(basename "$NEWEST"), ${AGE_HOURS}h old)"
log "=== run end ==="
exit 0
