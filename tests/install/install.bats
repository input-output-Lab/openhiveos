#!/usr/bin/env bats
# =============================================================================
# S8-07 — install.sh behaviour tests
# Scout, Sprint 8
#
# Strategy: PATH-injected stubs — fake binaries placed in $STUBS_DIR and
# prepended to PATH before each test. install.sh runs in an isolated tmpdir
# with a stub docker-compose.yml to pass the root guard.
#
# Coverage:
#   TC-IS11        Root guard (no docker-compose.yml)
#   TC-IS1–IS7    Step 1 — one prereq absent/broken each
#   TC-IS8         Step 1 — all prereqs present
#   TC-IS9–IS10   Step 2 — .env idempotency (keep / overwrite)
#   TC-IS12–IS16  Step 7 — company ethos (already set / full / partial /
#                           SEC-D9 pipe char / skip all)
# =============================================================================

# shellcheck disable=SC2030,SC2031  # BATS subshell variable export behaviour

# Absolute path to the installer — resolved from this file's location
INSTALL_SH="$(cd "$(dirname "${BATS_TEST_FILENAME}")/../.." && pwd)/install.sh"

load 'helpers/stubs'

# ── Lifecycle ────────────────────────────────────────────────────────────────

setup() {
  # Isolated working directory — install.sh runs from here
  WORK_DIR="$(mktemp -d)"

  # Minimal docker-compose.yml so the root guard passes
  touch "${WORK_DIR}/docker-compose.yml"

  # Stub executable directory — prepended to PATH in _run_install
  STUBS_DIR="${WORK_DIR}/stubs"
  mkdir -p "$STUBS_DIR"

  # Invocation recorder — assert on what the script called
  STUB_CALL_LOG="${WORK_DIR}/calls.log"

  export STUB_CALL_LOG STUBS_DIR FAKE_TOKEN

  # Default happy-path stubs (all binaries present, all succeed)
  make_stub_docker
  make_stub_node
  make_stub_npm
  make_stub_openssl
  make_stub_sleep

  # Default .env fixture (GEMINI set → key prompt skipped; COMPANY_* empty)
  make_env_fixture
}

teardown() {
  rm -rf "$WORK_DIR"
}

# ── Test runner helper ────────────────────────────────────────────────────────
#
# Runs install.sh inside $WORK_DIR with $STUBS_DIR prepended to PATH.
# stdin content is written to a file; extra trailing blank lines are appended
# so that any remaining read -r calls hit empty strings rather than EOF
# (which would trigger set -e and abort the script prematurely).

_run_install() {
  local stdin_content="${1:-}"
  local stdin_file="${WORK_DIR}/stdin.txt"
  # Trailing newlines absorb reads beyond those explicitly provided
  printf '%s\n\n\n\n\n\n\n\n' "$stdin_content" > "$stdin_file"
  # 2>&1 merges stderr so fail() error messages appear in $output
  run bash -c \
    "cd '${WORK_DIR}' && PATH='${STUBS_DIR}:${PATH}' bash '${INSTALL_SH}' < '${stdin_file}' 2>&1"
}

# Variant for "binary not found" tests.
# Uses a minimal PATH so that real binaries installed by homebrew, nvm, or OrbStack
# are not found even when the corresponding stub has been removed from $STUBS_DIR.
#
# Optional second arg overrides the clean PATH (default: stubs + /usr/bin + /bin).
# TC-IS7 uses "${STUBS_DIR}:/bin" because macOS ships /usr/bin/openssl (LibreSSL) —
# /bin only is safe for openssl-absent testing because install.sh exits at the
# `command -v openssl` guard before reaching any awk/sed/grep calls.
_run_install_nofind() {
  local stdin_content="${1:-}"
  local clean_path="${2:-${STUBS_DIR}:/usr/bin:/bin}"
  local stdin_file="${WORK_DIR}/stdin.txt"
  printf '%s\n\n\n\n\n\n\n\n' "$stdin_content" > "$stdin_file"
  run bash -c \
    "cd '${WORK_DIR}' && PATH='${clean_path}' bash '${INSTALL_SH}' < '${stdin_file}' 2>&1"
}

# =============================================================================
# TC-IS11 — Root guard
# =============================================================================

@test "TC-IS11: exits 1 if docker-compose.yml not found in cwd" {
  rm -f "${WORK_DIR}/docker-compose.yml"
  _run_install ""
  [ "$status" -ne 0 ]
  [[ "$output" =~ "run install.sh from the repository root" ]]
}

# =============================================================================
# TC-IS1 through TC-IS7 — Step 1: prerequisite checks
# =============================================================================

@test "TC-IS1: exits 1 and reports 'Docker not found' when docker absent" {
  rm -f "${STUBS_DIR}/docker"
  _run_install_nofind "$(stdin_for N)"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Docker not found" ]]
}

@test "TC-IS2: exits 1 and reports daemon not running when docker info fails" {
  export STUB_DOCKER_INFO_FAIL=1
  _run_install "$(stdin_for N)"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Docker daemon is not running" ]]
}

@test "TC-IS3: exits 1 and reports Compose v2 missing when docker compose version fails" {
  export STUB_DOCKER_COMPOSE_VERSION_FAIL=1
  _run_install "$(stdin_for N)"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Docker Compose v2 plugin not found" ]]
}

@test "TC-IS4: exits 1 and reports 'Node.js not found' when node absent" {
  rm -f "${STUBS_DIR}/node"
  _run_install_nofind "$(stdin_for N)"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Node.js not found" ]]
}

@test "TC-IS5: exits 1 and reports 'Node.js 22+' when node major version < 22" {
  export STUB_NODE_MAJOR=21
  _run_install "$(stdin_for N)"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Node.js 22+" ]]
}

@test "TC-IS6: exits 1 and reports 'npm not found' when npm absent" {
  rm -f "${STUBS_DIR}/npm"
  _run_install_nofind "$(stdin_for N)"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "npm not found" ]]
}

@test "TC-IS7: exits 1 and reports 'openssl not found' when openssl absent" {
  rm -f "${STUBS_DIR}/openssl"
  # macOS ships /usr/bin/openssl (LibreSSL) — exclude /usr/bin entirely.
  # Safe: install.sh exits at the `command -v openssl` guard before any awk/grep calls.
  _run_install_nofind "$(stdin_for N)" "${STUBS_DIR}:/bin"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "openssl not found" ]]
}

# =============================================================================
# TC-IS8 — Step 1: all prereqs present
# =============================================================================

@test "TC-IS8: Step 1 outputs version confirmation for all five prereqs" {
  _run_install "$(stdin_for N)"
  [[ "$output" =~ "Docker:" ]]
  [[ "$output" =~ "Compose:" ]]
  [[ "$output" =~ "Node.js:" ]]
  [[ "$output" =~ "npm:" ]]
  [[ "$output" =~ "openssl:" ]]
}

# =============================================================================
# TC-IS9, TC-IS10 — Step 2: .env idempotency
# =============================================================================

@test "TC-IS9: keeps existing .env when operator answers N" {
  # Inject a sentinel value — if Step 2 overwrites .env from scratch, sentinel is gone
  echo "SENTINEL=existing-content-preserved" >> "${WORK_DIR}/.env"

  _run_install "$(stdin_for N)"

  [[ "$output" =~ "Keeping existing .env" ]]
  grep -q "^SENTINEL=existing-content-preserved" "${WORK_DIR}/.env"
}

@test "TC-IS10: overwrites .env when operator answers y — legacy content absent" {
  # Inject a sentinel line into the existing .env
  echo "OLD_SENTINEL=yes" >> "${WORK_DIR}/.env"

  _run_install "$(stdin_for y)"

  # The overwritten .env must not contain the sentinel
  run grep "OLD_SENTINEL" "${WORK_DIR}/.env"
  [ "$status" -ne 0 ]
}

# =============================================================================
# TC-IS12 through TC-IS16 — Step 7: company ethos
# =============================================================================

@test "TC-IS12: skips company prompts when all COMPANY_* already set in .env" {
  make_env_fixture_with_company
  _run_install "$(stdin_for N)"
  # Note: "COMPANY_*" contains a regex metachar (*) — match on the unique trailing phrase instead
  [[ "$output" =~ "skipping prompts" ]]
}

@test "TC-IS13: writes all five COMPANY_* vars to .env when fully provided" {
  _run_install "$(stdin_for N \
    'Acme Corp' \
    'We build great things' \
    'Software for Enterprise' \
    'Scale to 100M ARR' \
    'excellence,innovation,integrity')"

  grep -q "^COMPANY_NAME=Acme Corp"                    "${WORK_DIR}/.env"
  grep -q "^COMPANY_MISSION=We build great things"     "${WORK_DIR}/.env"
  grep -q "^COMPANY_NICHE=Software for Enterprise"     "${WORK_DIR}/.env"
  grep -q "^COMPANY_3YEAR=Scale to 100M ARR"           "${WORK_DIR}/.env"
  grep -q "^COMPANY_VALUES=excellence,innovation,integrity" "${WORK_DIR}/.env"
  [[ "$output" =~ "COMPANY_* vars written to .env" ]]
}

@test "TC-IS14: warns on partial company input and leaves COMPANY_NAME empty (all-or-nothing)" {
  # Provide NAME + MISSION but leave NICHE, 3YEAR, VALUES empty
  _run_install "$(stdin_for N 'Acme Corp' 'We build great things' '' '' '')"

  [[ "$output" =~ "Partial company configuration" ]]
  local line
  line="$(grep "^COMPANY_NAME=" "${WORK_DIR}/.env")"
  [[ "$line" == "COMPANY_NAME=" ]]
}

@test "TC-IS15: SEC-D9 — warns and blocks write when pipe char present in company field" {
  # Pipe char in COMPANY_NAME — should trigger SEC-D9 guard
  _run_install "$(stdin_for N \
    'Acme|Corp' \
    'We build great things' \
    'Software for Enterprise' \
    'Scale to 100M ARR' \
    'excellence,innovation,integrity')"

  [[ "$output" =~ "cannot contain the '|' character" ]]
  # COMPANY_NAME must NOT have been written
  local line
  line="$(grep "^COMPANY_NAME=" "${WORK_DIR}/.env")"
  [[ "$line" == "COMPANY_NAME=" ]]
}

@test "TC-IS16: skips write and produces no warning when all five company fields left blank" {
  _run_install "$(stdin_for N '' '' '' '' '')"

  # No partial-config warning — blank means skip, not attempt
  [[ ! "$output" =~ "Partial company configuration" ]]
  # COMPANY_* remain empty in .env
  local line
  line="$(grep "^COMPANY_NAME=" "${WORK_DIR}/.env")"
  [[ "$line" == "COMPANY_NAME=" ]]
}
