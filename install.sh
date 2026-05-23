#!/usr/bin/env bash
# =============================================================================
# OpenHiveOS — Self-Hosted Installer  (install.sh)
# Sprint 8, Stories S8-05a + S8-05b
#
# Usage:  ./install.sh
#         Run from the repository root. Safe to re-run (idempotent).
#
# ── Prerequisites ─────────────────────────────────────────────────────────────
#   • Docker Engine 24+ with Compose v2  (docker compose, not docker-compose)
#   • Node.js 22+ and npm  ← dashboard build runs on the HOST (Path A)
#   • openssl  (secret generation)
#
# ── Steps ─────────────────────────────────────────────────────────────────────
#   1  Check prerequisites
#   2  .env setup (prompts before overwriting existing file)
#   3  Generate cryptographic secrets
#   4  Write .env  (SEC-D4: printf only — never unquoted echo $SECRET)
#   5  Start PostgreSQL + apply migrations
#   6  Initialise Ethos Seal  (ARCH-013, one-time)
#   7  [PLACEHOLDER S8-03] Company ethos init
#   8  Provision dashboard agent token  (--token-only capture)
#   9  Build dashboard on host  (Node 22, Path A)
#  10  Build Docker images with dashboard token baked in
#  11  Start all services
#  12  Provision squad agent tokens
#  13  Generate harness configuration files  (S8-05b)
#  14  Print harness connection instructions
#
# ── Security ──────────────────────────────────────────────────────────────────
#   SEC-D3: The VITE_DASHBOARD_AGENT_TOKEN is baked into the locally-built
#   Docker image and visible via 'docker history'. For single-tenant self-
#   hosted installs this is acceptable — you control your own Docker daemon.
#   Never push this image to a public registry.
#
#   SEC-D4: All secrets are written to .env via printf '%s\n', never via
#   unquoted echo $SECRET or heredoc that could trigger shell expansion.
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Terminal colours
# ---------------------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BOLD='\033[1m'; RESET='\033[0m'

CURRENT_STEP=""

fail() {
  echo -e "\n${RED}${BOLD}✗ Step failed: ${CURRENT_STEP}${RESET}"
  echo -e "${RED}  Error: ${1}${RESET}" >&2
  exit 1
}

trap 'fail "unexpected error (exit code $?)"' ERR

step() {
  CURRENT_STEP="${1}"
  echo -e "\n${BOLD}▶ ${1}${RESET}"
}

ok()   { echo -e "${GREEN}  ✓ ${1}${RESET}"; }
warn() { echo -e "${YELLOW}  ⚠  ${1}${RESET}"; }

# Guard: must run from repo root
if [ ! -f "$(pwd)/docker-compose.yml" ]; then
  echo -e "${RED}Error: run install.sh from the repository root directory.${RESET}" >&2
  exit 1
fi

echo -e "\n${BOLD}OpenHiveOS — Self-Hosted Installer${RESET}"
echo    "Sprint Goal: operator runs install.sh → fully working OpenHiveOS"
echo    "──────────────────────────────────────────────────────────────────"

# =============================================================================
# Step 1 — Prerequisites
# =============================================================================
step "Step 1: Checking prerequisites"

if ! command -v docker &>/dev/null; then
  fail "Docker not found. Install Docker Engine 24+ from https://docs.docker.com/engine/install/"
fi
docker info &>/dev/null || fail "Docker daemon is not running. Start it and re-run."
ok "Docker: $(docker --version)"

if ! docker compose version &>/dev/null; then
  fail "Docker Compose v2 plugin not found. See: https://docs.docker.com/compose/install/"
fi
ok "Compose: $(docker compose version)"

if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install Node.js 22+ from https://nodejs.org (required for dashboard build — Path A)."
fi
NODE_MAJOR=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")
if [ "$NODE_MAJOR" -lt 22 ]; then
  fail "Node.js 22+ required for the dashboard build (found: $(node --version)). See https://nodejs.org"
fi
ok "Node.js: $(node --version)"

if ! command -v npm &>/dev/null; then
  fail "npm not found — should be bundled with Node.js. Reinstall from https://nodejs.org"
fi
ok "npm: $(npm --version)"

if ! command -v openssl &>/dev/null; then
  fail "openssl not found. Install via: brew install openssl  OR  apt install openssl"
fi
ok "openssl: $(openssl version | awk '{print $1" "$2}')"

# =============================================================================
# Step 2 — .env setup (idempotent)
# =============================================================================
step "Step 2: Setting up .env"

ENV_FILE="$(pwd)/.env"
SKIP_ENV_WRITE=false

if [ -f "$ENV_FILE" ]; then
  warn ".env already exists."
  printf "  Overwrite existing .env? [y/N] "
  read -r OVERWRITE
  if [[ ! "${OVERWRITE:-N}" =~ ^[Yy]$ ]]; then
    echo "  Keeping existing .env."
    SKIP_ENV_WRITE=true
  fi
fi

# =============================================================================
# Step 3 — Generate cryptographic secrets
# =============================================================================
step "Step 3: Generating cryptographic secrets"

if [ "$SKIP_ENV_WRITE" = false ]; then
  POSTGRES_PASSWORD=$(openssl rand -hex 32)
  APP_PASSWORD=$(openssl rand -hex 32)
  ETHOS_SEAL_SECRET=$(openssl rand -hex 32)
  ok "POSTGRES_PASSWORD  — 64 hex chars (256-bit)"
  ok "APP_PASSWORD       — 64 hex chars (SEC-7 credential isolation)"
  ok "ETHOS_SEAL_SECRET  — 64 hex chars (ARCH-013)"
else
  # Load existing values for subsequent steps
  # shellcheck disable=SC1090
  set -o allexport; source "$ENV_FILE"; set +o allexport
  ok "Using existing secrets from .env"
fi

# =============================================================================
# Step 4 — Write .env  (SEC-D4: printf only)
# =============================================================================
step "Step 4: Writing .env"

if [ "$SKIP_ENV_WRITE" = false ]; then
  mkdir -p ethos-seal provision

  # SEC-D4: all secrets written via printf '%s\n' — never via echo $SECRET.
  # printf prevents any shell interpretation of the secret value itself.
  {
    printf '# OpenHiveOS — generated by install.sh  (do not commit)\n'
    printf '# Rotate all secrets on any compromise.\n\n'

    printf '# ── PostgreSQL (superuser — migrate service only) ───────────────\n'
    printf 'DATABASE_URL=postgresql://openhiveos:%s@localhost:5432/openhiveos\n' "$POSTGRES_PASSWORD"
    printf 'POSTGRES_PASSWORD=%s\n\n' "$POSTGRES_PASSWORD"

    printf '# ── SEC-7: runtime credential isolation (migration 007) ─────────\n'
    printf '# opensquad_app has DML only (no DDL, CONNECTION LIMIT 25).\n'
    printf '# After migration 007 applies, run:\n'
    printf '#   psql -U openhiveos -d openhiveos -c "ALTER ROLE opensquad_app PASSWORD '"'"'<value>'"'"';"\n'
    printf '# Then set APP_PASSWORD to the same value.\n'
    printf 'APP_PASSWORD=%s\n\n' "$APP_PASSWORD"

    printf '# ── Gemini API key (embeddings — required for SOP ingest) ───────\n'
    printf 'GEMINI_API_KEY=\n\n'

    printf '# ── Ethos Seal (ARCH-013) ────────────────────────────────────────\n'
    printf 'ETHOS_SEAL_SECRET=%s\n' "$ETHOS_SEAL_SECRET"
    printf 'ETHOS_SEAL_PATH=./ethos.seal.json\n'
    printf 'ETHOS_SEAL_DIR=./ethos-seal\n'
    printf 'PROVISION_ENV_DIR=./provision\n\n'

    printf '# ── HTTP ports ───────────────────────────────────────────────────\n'
    printf 'HEALTH_PORT=3000\n'
    printf 'SQUAD_API_PORT=3005\n\n'

    printf '# ── Agent tokens (set by install.sh steps 8 + 12) ───────────────\n'
    printf 'AGENT_TOKEN=\n'
    printf 'VITE_DASHBOARD_AGENT_TOKEN=\n'
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok ".env written (mode 600)"
fi

# Source .env for subsequent steps
# shellcheck disable=SC1090
set -o allexport; source "$ENV_FILE"; set +o allexport

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo ""
  warn "GEMINI_API_KEY is required for SOP embedding and agent memory."
  printf "  Enter your Gemini API key (leave empty to skip and edit .env manually): "
  read -r USER_GEMINI_KEY
  if [ -n "$USER_GEMINI_KEY" ]; then
    # SEC-D4: write via sed + printf chain — value never unquoted on the command line
    sed -i.bak "s|^GEMINI_API_KEY=.*|GEMINI_API_KEY=$(printf '%s' "$USER_GEMINI_KEY")|" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
    GEMINI_API_KEY="$USER_GEMINI_KEY"
    ok "GEMINI_API_KEY written to .env"
  else
    warn "Skipping GEMINI_API_KEY — SOP ingestion will fail at boot without it."
  fi
fi

# =============================================================================
# Step 5 — Start PostgreSQL + apply migrations
# =============================================================================
step "Step 5: Starting PostgreSQL and applying migrations"

docker compose up -d postgres

echo "  Waiting for PostgreSQL to become healthy..."
RETRIES=24
until docker compose exec -T postgres pg_isready -U openhiveos -d openhiveos &>/dev/null; do
  RETRIES=$((RETRIES - 1))
  [ "$RETRIES" -le 0 ] && fail "PostgreSQL did not become healthy within 120 seconds."
  sleep 5
done
ok "PostgreSQL healthy"

# Run migrate as a tracked service so depends_on: service_completed_successfully
# is satisfied for subsequent --profile init services.
docker compose up migrate
ok "Migrations applied"

# =============================================================================
# Step 6 — Initialise Ethos Seal (ARCH-013)
# =============================================================================
step "Step 6: Initialising Ethos Seal (ARCH-013)"

mkdir -p ethos-seal

docker compose --profile init run --rm one-init
ok "Ethos Seal initialised → ./ethos-seal/"

# =============================================================================
# Step 7 — Company ethos init (ARCH-018 S8-03)
# =============================================================================
step "Step 7: Company ethos init (optional)"

# Reload .env so any values set in Step 4 are current.
# shellcheck disable=SC1090
set -o allexport; source "$ENV_FILE"; set +o allexport

# If all five COMPANY_* vars are already set in .env, skip prompting.
if [ -n "${COMPANY_NAME:-}" ] && [ -n "${COMPANY_MISSION:-}" ] && \
   [ -n "${COMPANY_3YEAR:-}" ]  && [ -n "${COMPANY_VALUES:-}" ] && \
   [ -n "${COMPANY_NICHE:-}" ]; then
  ok "COMPANY_* vars already set in .env — skipping prompts."
else
  echo ""
  echo "  Company identity is optional. Agents use it via the get_company_ethos tool."
  echo "  Press Enter to skip any field (you can add these later and run one-init --revise)."
  echo ""

  printf "  COMPANY_NAME    (legal/operating name): "
  read -r INPUT_COMPANY_NAME
  printf "  COMPANY_MISSION (single sentence):       "
  read -r INPUT_COMPANY_MISSION
  printf "  COMPANY_NICHE   ([service] for [market]): "
  read -r INPUT_COMPANY_NICHE
  printf "  COMPANY_3YEAR   (3-year target state):   "
  read -r INPUT_COMPANY_3YEAR
  printf "  COMPANY_VALUES  (comma-separated list):  "
  read -r INPUT_COMPANY_VALUES

  # Write to .env only if at least one field was provided
  if [ -n "$INPUT_COMPANY_NAME" ] || [ -n "$INPUT_COMPANY_MISSION" ] || \
     [ -n "$INPUT_COMPANY_NICHE" ] || [ -n "$INPUT_COMPANY_3YEAR" ]  || \
     [ -n "$INPUT_COMPANY_VALUES" ]; then

    # Validate all-or-nothing: if any field is set, all must be set.
    if [ -z "$INPUT_COMPANY_NAME" ] || [ -z "$INPUT_COMPANY_MISSION" ] || \
       [ -z "$INPUT_COMPANY_NICHE" ] || [ -z "$INPUT_COMPANY_3YEAR" ]  || \
       [ -z "$INPUT_COMPANY_VALUES" ]; then
      warn "Partial company configuration — all five fields are required together."
      warn "Skipping company init. Add all five COMPANY_* vars to .env and run:"
      warn "  docker compose --profile init run --rm one-init --revise"
      INPUT_COMPANY_NAME=""
    else
      # SEC-D9: reject '|' in any company field — it is the sed delimiter used below.
      # Using case pattern matching (no external tools required).
      _pipe_found=0
      for _val in "$INPUT_COMPANY_NAME" "$INPUT_COMPANY_MISSION" "$INPUT_COMPANY_NICHE" \
                  "$INPUT_COMPANY_3YEAR" "$INPUT_COMPANY_VALUES"; do
        case "$_val" in *\|*) _pipe_found=1 ;; esac
      done
      if [ "$_pipe_found" -eq 1 ]; then
        warn "Company field values cannot contain the '|' character (pipe)."
        warn "Please re-run install.sh and avoid '|' in any company field."
        warn "Tip: use commas, semicolons, or dashes as separators instead."
        INPUT_COMPANY_NAME=""
      else
        # SEC-D4 + SEC-D9: write via sed + printf — values never unquoted on the command line.
        # '|' validated absent above; sed delimiter is safe.
        sed -i.bak "s|^COMPANY_NAME=.*|COMPANY_NAME=$(printf '%s' "$INPUT_COMPANY_NAME")|" "$ENV_FILE"
        sed -i.bak "s|^COMPANY_MISSION=.*|COMPANY_MISSION=$(printf '%s' "$INPUT_COMPANY_MISSION")|" "$ENV_FILE"
        sed -i.bak "s|^COMPANY_NICHE=.*|COMPANY_NICHE=$(printf '%s' "$INPUT_COMPANY_NICHE")|" "$ENV_FILE"
        sed -i.bak "s|^COMPANY_3YEAR=.*|COMPANY_3YEAR=$(printf '%s' "$INPUT_COMPANY_3YEAR")|" "$ENV_FILE"
        sed -i.bak "s|^COMPANY_VALUES=.*|COMPANY_VALUES=$(printf '%s' "$INPUT_COMPANY_VALUES")|" "$ENV_FILE"
        rm -f "${ENV_FILE}.bak"

        COMPANY_NAME="$INPUT_COMPANY_NAME"
        COMPANY_MISSION="$INPUT_COMPANY_MISSION"
        COMPANY_NICHE="$INPUT_COMPANY_NICHE"
        COMPANY_3YEAR="$INPUT_COMPANY_3YEAR"
        COMPANY_VALUES="$INPUT_COMPANY_VALUES"
        ok "COMPANY_* vars written to .env"
      fi  # SEC-D9 pipe-char check
    fi  # all-or-nothing validation
  fi  # at least one field provided
fi  # COMPANY_* not already set

# Run one-init --revise to seal company identity into the Ethos Seal (ARCH-018).
# one-init reads COMPANY_* from the environment — no interactive prompts for these fields.
if [ -n "${COMPANY_NAME:-}" ] && [ -n "${COMPANY_MISSION:-}" ] && \
   [ -n "${COMPANY_3YEAR:-}" ]  && [ -n "${COMPANY_VALUES:-}" ] && \
   [ -n "${COMPANY_NICHE:-}" ]; then
  docker compose --profile init run --rm \
    -e COMPANY_NAME="${COMPANY_NAME}" \
    -e COMPANY_MISSION="${COMPANY_MISSION}" \
    -e COMPANY_3YEAR="${COMPANY_3YEAR}" \
    -e COMPANY_VALUES="${COMPANY_VALUES}" \
    -e COMPANY_NICHE="${COMPANY_NICHE}" \
    one-init --revise
  ok "Company identity sealed into Ethos Seal via one-init --revise"
else
  warn "Company identity not configured. Skipping company seal."
  warn "To add later: set COMPANY_* vars in .env, then run:"
  warn "  docker compose --profile init run --rm one-init --revise"
fi

# =============================================================================
# Step 8 — Provision dashboard agent token  (--token-only capture)
# =============================================================================
step "Step 8: Provisioning dashboard agent token"

# Build the production image — needed to run provision-agent-token.js.
# VITE_DASHBOARD_AGENT_TOKEN is NOT passed here; dashboard-build stage runs
# with an empty token (the image from this build is used only for provisioning).
# The final image with the real token is built in Step 10.
docker compose build mcp
ok "MCP server image built (provisioning helper)"

# Capture the dashboard token via --token-only (Murphy S8-02 flag).
# stdout = raw token value only; all other output goes to stderr.
# We override DATABASE_URL to use the openhiveos superuser here — opensquad_app
# may not have its password configured yet (migration 007 sets up the role, but
# APP_PASSWORD must be set via ALTER ROLE by the operator after first boot).
# SEC-D4: token is captured into a variable — never echoed to the terminal.
DASHBOARD_TOKEN=$(
  docker compose --profile init run --rm -T \
    -e DATABASE_URL="postgresql://openhiveos:${POSTGRES_PASSWORD}@postgres:5432/openhiveos" \
    provision \
    node dist/scripts/provision-agent-token.js dashboard --token-only \
  2>/dev/null
) || fail "Dashboard token provisioning failed. Run: docker compose --profile init logs provision"

[ -z "$DASHBOARD_TOKEN" ] && fail "Dashboard token is empty after provisioning."

# Write token to .env (SEC-D4: printf via sed)
sed -i.bak "s|^VITE_DASHBOARD_AGENT_TOKEN=.*|VITE_DASHBOARD_AGENT_TOKEN=$(printf '%s' "$DASHBOARD_TOKEN")|" "$ENV_FILE"
rm -f "${ENV_FILE}.bak"
ok "Dashboard agent token provisioned and written to .env"

# =============================================================================
# Step 9 — Build dashboard on host  (Node 22 — Path A)
# =============================================================================
step "Step 9: Building dashboard on host (Path A — host npm build)"

# SEC-D3: token baked into local-only Docker image in Step 10. This image is
# not pushed to any registry. Anyone with Docker access on this host can read
# the token via 'docker history'. Acceptable for single-tenant self-hosted installs.

DASHBOARD_DIR="$(pwd)/packages/dashboard"
[ -f "$DASHBOARD_DIR/package.json" ] \
  || fail "packages/dashboard/package.json not found. Ensure you are running from the repo root."

pushd "$DASHBOARD_DIR" > /dev/null
npm ci --prefer-offline
# Pass the token as an environment variable only — never as a CLI argument.
VITE_DASHBOARD_AGENT_TOKEN="$DASHBOARD_TOKEN" npm run build
popd > /dev/null

ok "Dashboard built → dist/dashboard/"

# =============================================================================
# Step 10 — Build Docker images with dashboard baked in
# =============================================================================
step "Step 10: Building Docker images with dashboard token"

# The dashboard-build Docker stage (S8-04) receives the token via ARG.
# SEC-D3: token is baked into the image layer — see header note.
# Only squad-api needs the dashboard; mcp is also rebuilt to share the image cache.
docker compose build \
  --build-arg "VITE_DASHBOARD_AGENT_TOKEN=${DASHBOARD_TOKEN}" \
  mcp squad-api

ok "Docker images built with dashboard baked in"

# =============================================================================
# Step 11 — Start all services
# =============================================================================
step "Step 11: Starting all services"

docker compose up -d

echo "  Waiting for services to become healthy..."
RETRIES=12
HEALTH_CHECK_PASSED=false
until [ "$RETRIES" -le 0 ]; do
  if docker compose exec -T mcp curl -sf "http://localhost:${HEALTH_PORT:-3000}" 2>/dev/null | grep -q '"status"'; then
    HEALTH_CHECK_PASSED=true
    break
  fi
  RETRIES=$((RETRIES - 1))
  sleep 5
done

if [ "$HEALTH_CHECK_PASSED" = true ]; then
  ok "All services healthy"
else
  warn "Health check timed out — services may still be warming up. Check: docker compose ps"
fi

# =============================================================================
# Step 12 — Provision squad agent tokens
# =============================================================================
step "Step 12: Provisioning squad agent tokens"

mkdir -p provision

# provision-all-agents.js excludes 'dashboard' (provisioned separately in Step 8).
docker compose --profile init run --rm provision
chmod 600 provision/.env.tokens 2>/dev/null || true
ok "Squad agent tokens → ./provision/.env.tokens"

# =============================================================================
# Step 13 — Generate harness configuration files
# =============================================================================
step "Step 13: Generating harness configuration files"

mkdir -p harness

# Capture the absolute repo path now — baked into the generated config.
REPO_PATH="$(pwd)"

# Generate harness/claude-desktop.json using Node.js (already a prerequisite).
# Reads provision/.env.tokens to build one MCP server entry per agent.
# SEC: file is chmod 600 immediately after write — same protection as the token file.
REPO_PATH="$REPO_PATH" node << 'NODESCRIPT'
const fs = require('fs');
const repoPath = process.env.REPO_PATH;
const tokensRaw = fs.readFileSync('provision/.env.tokens', 'utf8').trim();
const servers = {};
for (const line of tokensRaw.split('\n')) {
  const m = line.match(/^AGENT_TOKEN_([A-Z_]+)=(.+)$/);
  if (!m) continue;
  const slug = m[1].toLowerCase();
  const token = m[2].trim();
  servers[`openhiveos-${slug}`] = {
    command: 'bash',
    args: [
      '-c',
      `cd "${repoPath}" && docker compose exec -i -e AGENT_TOKEN mcp node dist/index.js`
    ],
    env: { AGENT_TOKEN: token }
  };
}
const out = JSON.stringify({ mcpServers: servers }, null, 2) + '\n';
fs.writeFileSync('harness/claude-desktop.json', out);
NODESCRIPT

chmod 600 harness/claude-desktop.json
ok "Harness configs written → ./harness/claude-desktop.json  (chmod 600)"

# =============================================================================
# Step 14 — Install complete
# =============================================================================
step "Step 14: Install complete"

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║  OpenHiveOS is running!                      ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${RESET}"
echo ""
echo "  MCP stdio:    docker compose exec -i mcp"
echo "  Health:       http://localhost:${HEALTH_PORT:-3000}"
echo "  Dashboard:    http://localhost:${SQUAD_API_PORT:-3005}"
echo ""
echo "  Squad tokens: ./provision/.env.tokens  (chmod 600)"
echo ""
echo -e "${BOLD}Harness configuration (Claude Desktop, etc.):${RESET}"
echo "  Generated config: ./harness/claude-desktop.json  (chmod 600)"
echo "  Reference docs:   docs/harness-config.md"
echo "  Agent runbook:    docs/08-agent-onboarding.md"
echo ""
echo -e "${YELLOW}  ⚠  SEC-D3: This host's Docker image contains the dashboard token.${RESET}"
echo -e "${YELLOW}     Do not push this image to a public registry.${RESET}"
echo ""
echo "  To check status:  docker compose ps"
echo "  To view logs:     docker compose logs -f mcp"
echo "  To stop:          docker compose down"
echo ""
