# =============================================================================
# tests/install/helpers/stubs.bash
# Stub factory functions for install.sh PATH-injection testing (S8-07 Scout)
#
# Strategy: each make_stub_* creates an executable script in $STUBS_DIR.
# Tests prepend $STUBS_DIR to PATH so install.sh picks up stubs instead of
# real binaries. Stub behaviour is configured via exported env vars.
#
# Env vars read by stubs at runtime (not at stub creation time):
#   STUB_DOCKER_INFO_FAIL          — "1" → docker info exits 1 (daemon down)
#   STUB_DOCKER_COMPOSE_VERSION_FAIL — "1" → docker compose version exits 1
#   STUB_NODE_VERSION              — node --version output (default: 22.0.0)
#   STUB_NODE_MAJOR                — major version digit printed by node -e (default: 22)
#   STUB_CALL_LOG                  — file to append invocation records to
#   FAKE_TOKEN                     — token printed for --token-only capture
# =============================================================================

# Default fake DASHBOARD_TOKEN: 32 hex . 64 hex (matches token format)
FAKE_TOKEN="abcdef1234567890abcdef1234567890.abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"

# ── docker stub ──────────────────────────────────────────────────────────────
# Handles: --version, info, compose version, compose up, compose exec,
#          compose build, compose --profile init run (incl. --token-only),
#          compose up migrate, compose down
make_stub_docker() {
  cat > "${STUBS_DIR}/docker" << 'STUB'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "${STUB_CALL_LOG:-/dev/null}"
args="$*"

# docker --version
if [[ "$args" == "--version" ]]; then
  echo "Docker version 24.0.7, build afdd53b"
  exit 0
fi

# docker info (daemon liveness check)
if [[ "$args" == "info" ]]; then
  [ "${STUB_DOCKER_INFO_FAIL:-0}" = "1" ] && exit 1
  exit 0
fi

# docker compose version
if [[ "$args" == "compose version" ]]; then
  [ "${STUB_DOCKER_COMPOSE_VERSION_FAIL:-0}" = "1" ] && exit 1
  echo "Docker Compose version v2.20.0, build bcdef01"
  exit 0
fi

# docker compose exec ... pg_isready  (postgres health-check loop)
if [[ "$args" =~ pg_isready ]]; then
  exit 0
fi

# docker compose exec ... curl  (MCP health-check loop)
if [[ "$args" =~ "exec" ]] && [[ "$args" =~ "curl" ]]; then
  printf '{"status":"ok"}\n'
  exit 0
fi

# docker compose ... provision ... --token-only  (DASHBOARD_TOKEN capture)
if [[ "$args" =~ "--token-only" ]]; then
  printf '%s' "${FAKE_TOKEN:-placeholder.token}"
  exit 0
fi

# All other docker / docker compose invocations → success
exit 0
STUB
  chmod +x "${STUBS_DIR}/docker"
}

# ── node stub ────────────────────────────────────────────────────────────────
# Handles: --version, -e (major-version extraction)
make_stub_node() {
  cat > "${STUBS_DIR}/node" << 'STUB'
#!/usr/bin/env bash
printf 'node %s\n' "$*" >> "${STUB_CALL_LOG:-/dev/null}"
case "${1:-}" in
  --version)
    echo "v${STUB_NODE_VERSION:-22.0.0}"
    exit 0
    ;;
  -e)
    # install.sh: node -e "process.stdout.write(process.version.slice(1).split('.')[0])"
    printf '%s' "${STUB_NODE_MAJOR:-22}"
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
STUB
  chmod +x "${STUBS_DIR}/node"
}

# ── npm stub ─────────────────────────────────────────────────────────────────
# Handles: --version, ci, run
make_stub_npm() {
  cat > "${STUBS_DIR}/npm" << 'STUB'
#!/usr/bin/env bash
printf 'npm %s\n' "$*" >> "${STUB_CALL_LOG:-/dev/null}"
case "${1:-}" in
  --version)
    echo "10.2.0"
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
STUB
  chmod +x "${STUBS_DIR}/npm"
}

# ── openssl stub ─────────────────────────────────────────────────────────────
# Handles: version, rand -hex N
make_stub_openssl() {
  cat > "${STUBS_DIR}/openssl" << 'STUB'
#!/usr/bin/env bash
printf 'openssl %s\n' "$*" >> "${STUB_CALL_LOG:-/dev/null}"
case "${1:-}" in
  version)
    echo "OpenSSL 3.0.0 7 Sep 2021"
    exit 0
    ;;
  rand)
    # rand -hex 32 → 64 deterministic hex chars (safe to use as fake secret)
    echo "cafebabe1234567890abcdef1234567890abcdef1234567890abcdef12345678"
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
STUB
  chmod +x "${STUBS_DIR}/openssl"
}

# ── sleep stub ───────────────────────────────────────────────────────────────
# No-op — eliminates delays in postgres and health-check retry loops
make_stub_sleep() {
  cat > "${STUBS_DIR}/sleep" << 'STUB'
#!/usr/bin/env bash
exit 0
STUB
  chmod +x "${STUBS_DIR}/sleep"
}

# ── .env fixture ─────────────────────────────────────────────────────────────
# Pre-populated .env so:
#   • Step 2 idempotency prompt fires but "N" keeps it as-is
#   • Step 4 GEMINI_API_KEY prompt is skipped (key already set)
#   • COMPANY_* are empty → Step 7 prompts will fire
make_env_fixture() {
  local env_file="${WORK_DIR}/.env"
  cat > "$env_file" << 'ENVEOF'
DATABASE_URL=postgresql://openhiveos:cafebabe1234567890abcdef1234567890abcdef1234567890abcdef12345678@localhost:5432/openhiveos
POSTGRES_PASSWORD=cafebabe1234567890abcdef1234567890abcdef1234567890abcdef12345678
APP_PASSWORD=deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678
GEMINI_API_KEY=test-gemini-key-12345
ETHOS_SEAL_SECRET=deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678
ETHOS_SEAL_PATH=./ethos.seal.json
ETHOS_SEAL_DIR=./ethos-seal
PROVISION_ENV_DIR=./provision
HEALTH_PORT=3000
SQUAD_API_PORT=3005
AGENT_TOKEN=
VITE_DASHBOARD_AGENT_TOKEN=
COMPANY_NAME=
COMPANY_MISSION=
COMPANY_NICHE=
COMPANY_3YEAR=
COMPANY_VALUES=
ENVEOF
  chmod 600 "$env_file"
}

# Variant: pre-populated with all five COMPANY_* set (for TC-IS12 idempotency)
# Values intentionally contain no spaces — install.sh uses `source "$ENV_FILE"` with
# `set -o allexport`, which fails if a value contains spaces and is not shell-quoted.
# TC-IS12 only needs to verify the "already set → skip prompts" path, not space handling.
make_env_fixture_with_company() {
  make_env_fixture
  local env_file="${WORK_DIR}/.env"
  sed -i.bak \
    -e "s|^COMPANY_NAME=.*|COMPANY_NAME=AcmeCorp|" \
    -e "s|^COMPANY_MISSION=.*|COMPANY_MISSION=WebuildGreatThings|" \
    -e "s|^COMPANY_NICHE=.*|COMPANY_NICHE=SoftwareForEnterprise|" \
    -e "s|^COMPANY_3YEAR=.*|COMPANY_3YEAR=ScaleTo100MARR|" \
    -e "s|^COMPANY_VALUES=.*|COMPANY_VALUES=excellence,innovation,integrity|" \
    "$env_file"
  rm -f "${env_file}.bak"
}

# ── stdin builder ─────────────────────────────────────────────────────────────
# Produces stdin content for a complete install.sh run.
#
# Reads consumed in order (when .env already exists + GEMINI_API_KEY is set):
#   1. Step 2: OVERWRITE (y/N)
#   2. Step 7: INPUT_COMPANY_NAME
#   3. Step 7: INPUT_COMPANY_MISSION
#   4. Step 7: INPUT_COMPANY_NICHE
#   5. Step 7: INPUT_COMPANY_3YEAR
#   6. Step 7: INPUT_COMPANY_VALUES
#
# When .env does NOT exist (overwrite='y'), Step 4 adds one more GEMINI read.
# Extra trailing blank lines are appended by _run_install to absorb any
# remaining reads without hitting EOF (which would cause set -e to abort).
#
# Usage: stdin_for <overwrite> [name] [mission] [niche] [3year] [values]
stdin_for() {
  local overwrite="${1:-N}"
  printf '%s\n' "$overwrite"
  printf '%s\n' "${2:-}"  # COMPANY_NAME
  printf '%s\n' "${3:-}"  # COMPANY_MISSION
  printf '%s\n' "${4:-}"  # COMPANY_NICHE
  printf '%s\n' "${5:-}"  # COMPANY_3YEAR
  printf '%s\n' "${6:-}"  # COMPANY_VALUES
}
