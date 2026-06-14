#!/usr/bin/env bash
# smoke_report_usage.sh — Sprint 13 task #1779
# Smoke test for POST /internal/usage ingestion path.
#
# Tests:
#   1. POST → 201 (create)
#   2. DB row exists with correct fields
#   3. POST again → 409 (UNIQUE replay guard)
#   4. Field verification (agent_slug, model, provider)

set -euo pipefail

# ---------------------------------------------------------------------------
# Load environment
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: .env not found at $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

# ---------------------------------------------------------------------------
# Validate required env vars
# ---------------------------------------------------------------------------
if [[ -z "${OPENHIVEOS_INGESTION_TOKEN:-}" ]]; then
  echo "ERROR: OPENHIVEOS_INGESTION_TOKEN is not set in .env" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set in .env" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Build test payload
# ---------------------------------------------------------------------------
SESSION_ID="murphy:vscode:$(date +%s)000"
BASE_URL="http://localhost:3005"
ENDPOINT="$BASE_URL/internal/usage"

PAYLOAD=$(cat <<EOF
{
  "session_id": "$SESSION_ID",
  "loop_index": 0,
  "agent_slug": "murphy",
  "model": "claude-sonnet-4-5",
  "provider": "anthropic",
  "prompt_tokens": 1000,
  "completion_tokens": 200,
  "cost_usd": 0.005
}
EOF
)

PASS=0
FAIL=0

pass() { echo "  ✓ $1"; ((PASS++)) || true; }
fail() { echo "  ✗ $1" >&2; ((FAIL++)) || true; }

echo ""
echo "smoke_report_usage — session_id: $SESSION_ID"
echo "==========================================="

# ---------------------------------------------------------------------------
# Assertion 1: POST → 201
# ---------------------------------------------------------------------------
echo ""
echo "[1] POST /internal/usage → expect 201"

HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$ENDPOINT" \
  -H "Authorization: Bearer $OPENHIVEOS_INGESTION_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

if [[ "$HTTP_STATUS" == "201" ]]; then
  pass "HTTP 201 received"
else
  fail "Expected 201, got $HTTP_STATUS"
  echo "  Hint: Is the server running at $BASE_URL? Is the ingestion token correct?" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Assertion 2: DB row exists with correct fields
# ---------------------------------------------------------------------------
echo ""
echo "[2] Verify row in llm_usage"

ROW_COUNT=$(psql "$DATABASE_URL" -t -A -c \
  "SELECT COUNT(*) FROM llm_usage WHERE session_id = '$SESSION_ID' AND loop_index = 0;")

if [[ "$ROW_COUNT" == "1" ]]; then
  pass "1 row found in llm_usage for session_id"
else
  fail "Expected 1 row, found $ROW_COUNT"
  exit 1
fi

# ---------------------------------------------------------------------------
# Assertions 4a–4c: Field values
# ---------------------------------------------------------------------------
echo ""
echo "[4] Verify field values"

AGENT_SLUG=$(psql "$DATABASE_URL" -t -A -c \
  "SELECT agent_slug FROM llm_usage WHERE session_id = '$SESSION_ID' AND loop_index = 0;")
MODEL=$(psql "$DATABASE_URL" -t -A -c \
  "SELECT model FROM llm_usage WHERE session_id = '$SESSION_ID' AND loop_index = 0;")
PROVIDER=$(psql "$DATABASE_URL" -t -A -c \
  "SELECT provider FROM llm_usage WHERE session_id = '$SESSION_ID' AND loop_index = 0;")

if [[ "$AGENT_SLUG" == "murphy" ]]; then
  pass "agent_slug = 'murphy'"
else
  fail "agent_slug mismatch: got '$AGENT_SLUG'"
fi

if [[ "$MODEL" == "claude-sonnet-4-5" ]]; then
  pass "model = 'claude-sonnet-4-5'"
else
  fail "model mismatch: got '$MODEL'"
fi

if [[ "$PROVIDER" == "anthropic" ]]; then
  pass "provider = 'anthropic'"
else
  fail "provider mismatch: got '$PROVIDER'"
fi

# ---------------------------------------------------------------------------
# Assertion 3: Re-POST → 409 (UNIQUE replay guard)
# ---------------------------------------------------------------------------
echo ""
echo "[3] Re-POST identical payload → expect 409 (replay guard)"

HTTP_STATUS_2=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$ENDPOINT" \
  -H "Authorization: Bearer $OPENHIVEOS_INGESTION_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

if [[ "$HTTP_STATUS_2" == "409" ]]; then
  pass "HTTP 409 received (UNIQUE constraint replay guard)"
else
  fail "Expected 409, got $HTTP_STATUS_2"
  exit 1
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "==========================================="
TOTAL=$((PASS + FAIL))
if [[ "$FAIL" -eq 0 ]]; then
  echo "PASSED  $PASS/$TOTAL assertions"
  echo ""
  exit 0
else
  echo "FAILED  $FAIL/$TOTAL assertions" >&2
  echo ""
  exit 1
fi
