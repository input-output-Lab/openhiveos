# Agent Onboarding Runbook

**Purpose:** Step-by-step procedures for provisioning, rotating, and revoking agent tokens in an OpenHiveOS Squad Instance. Follow this guide every time a new agent joins the Squad or an existing agent's credentials need to be changed.

**Owner:** Clarence  
**Last updated:** 2026-05-21 (Sprint 6 — ARCH-016)  
**Source authority:** ARCH-001, ARCH-013, ARCH-014, ARCH-015, ARCH-016

---

## Contents

1. [First-time provisioning (new Squad Instance)](#1-first-time-provisioning-new-squad-instance)
2. [Rotate a single agent's token](#2-rotate-a-single-agents-token)
3. [Batch token rotation (all agents)](#3-batch-token-rotation-all-agents)
4. [Revoke an agent](#4-revoke-an-agent)
5. [Verification pattern](#5-verification-pattern)
6. [Ingestion token (Bridge) — rotation procedure](#6-ingestion-token-bridge--rotation-procedure)
7. [Enable the integration profile (mcp-gateway)](#7-enable-the-integration-profile-mcp-gateway)
8. [Troubleshooting](#8-troubleshooting)

---

## Audience

This runbook is for operators who deploy and maintain an OpenHiveOS Squad Instance. You need:

- Shell access to the host running the Squad Instance
- The `.env` file or equivalent secrets manager for the Squad
- Access to the team's 1Password vault (or equivalent) where tokens are stored

You do not need to be a developer to follow this guide.

---

## Prerequisites

- PostgreSQL is running and the migration chain (001–005) has been applied.
- `ETHOS_SEAL_SECRET` is set in your environment.
- `ETHOS_SEAL_DIR` points to a writeable directory on the host.
- `squad.manifest.json` contains all agents you want to provision.
- For Docker operations: Docker Compose is running (`docker compose ps` shows `postgres` and `migrate` healthy).
- For direct (non-Docker) operations: Node.js 20+ and `npx tsx` available.

---

## 1. First-time provisioning (new Squad Instance)

This is the canonical three-stage sequence. Run it once when setting up a new Squad.

### Stage 1 — Initialise the Ethos Seal

The Ethos Seal is the constitutional document for the Squad. It must exist before agents can be provisioned. If the Seal is already initialised, skip to Stage 2.

**Docker:**
```bash
docker compose --profile init run --rm one-init
```

**Direct (non-Docker):**
```bash
npx tsx src/scripts/one-init.ts
```

**What it does:** Creates the `ethos_seals` DB record and writes `ethos.seal.json` to `ETHOS_SEAL_DIR`. The script will confirm success with a printed fingerprint. Keep `ethos.seal.json` — it is required for boot-time verification.

**Expected output:**
```
[one-init] Ethos Seal v1 initialised. Fingerprint: <sha256-hex>
[one-init] Seal written to /ethos-seal/ethos.seal.json
```

### Stage 2 — Provision agent tokens

Provisions a bearer token for every agent listed in `squad.manifest.json`. Writes the raw tokens to a file on the host.

**Docker:**
```bash
docker compose --profile init run --rm provision
```

**Direct (non-Docker):**
```bash
npx tsx src/scripts/provision-all-agents.ts --all --write-env ./agent-tokens.env
```

**What it does:** For each agent in the manifest, generates a cryptographically random token (`salt.secret` format), stores the hash in the `agents` table, and writes `AGENT_TOKEN_<SLUG>=<token>` lines to the output file.

**Expected output:**
```
[provision] murphy     → provisioned
[provision] rocket     → provisioned
[provision] cooper     → provisioned
...
[provision] Tokens written to ./agent-tokens.env (chmod 600)
```

**Immediately after:**

1. Copy each token from `agent-tokens.env` into 1Password (or your team vault). One entry per agent.
2. Delete or `shred` the `agent-tokens.env` file from disk.
3. Set each agent's token as the `MCP_AUTH_TOKEN_<SLUG>` environment variable in the agent's VS Code workspace or environment file.

```bash
# Example — never commit this to git
export MCP_AUTH_TOKEN_MURPHY=<token-from-file>
```

### Stage 3 — Verify the dashboard

Start the squad-api (it starts automatically with `docker compose up -d`). Open the dashboard:

```
http://localhost:3005
```

The Ethos Seal view should show the active seal version and activation timestamp. If it shows an error, see [Troubleshooting](#7-troubleshooting).

---

## 2. Rotate a single agent's token

Use this when a single agent's token may be compromised, or as a scheduled rotation for one agent.

```bash
npx tsx src/scripts/provision-agent-token.ts <agent-slug>
```

**Example:**
```bash
npx tsx src/scripts/provision-agent-token.ts murphy
```

**What it does:** Generates a new token for `murphy`. The old token is preserved in the `previous_token_hash` column and remains valid for **24 hours** (the grace window). This gives you time to update the agent's environment before the old token is fully invalidated.

**Rotation steps:**

1. Run the command above. The new raw token is printed to stdout — copy it immediately.
2. Store the new token in 1Password under the agent's existing entry.
3. Update `MCP_AUTH_TOKEN_MURPHY` (or equivalent) in the agent's environment.
4. Restart the agent's VS Code session or PM2 process.
5. Verify the agent can authenticate: check `agents.last_used_at` in the DB, or watch for a successful MCP tool call.

The old token automatically expires after 24 hours. No further action needed.

> **If the token was compromised:** Rotate immediately and reduce the grace window concern by restarting the affected system promptly. Use `--revoke` (see [Section 4](#4-revoke-an-agent)) if you need instant invalidation with no grace period.

---

## 3. Batch token rotation (all agents)

Use this for a scheduled rotation of the entire Squad (e.g. quarterly). This is a high-impact operation — all agents must update their tokens within 24 hours.

> ⚠️ **Warning:** This rotates every agent's token simultaneously. All running agent sessions will continue working through the 24-hour grace window, but any agent that is not updated within that window will begin receiving 401 errors.

**Step 1 — Verify first (recommended)**

Before running the batch rotation, confirm all agents are reachable and the manifest matches the DB:

```bash
npx tsx src/scripts/provision-all-agents.ts --all --write-env /tmp/verify.env
```

Without `--force-rotate`, this command only provisions agents that are not yet in the DB. Agents that are already provisioned are logged as skipped. This is your verification that the manifest and DB are in sync.

**Step 2 — Rotate**

```bash
npx tsx src/scripts/provision-all-agents.ts --all --write-env ./agent-tokens.env --force-rotate --confirm
```

Both `--force-rotate` and `--confirm` are required. `--confirm` is a deliberate friction gate — the script will not rotate without it.

**Step 3 — Distribute tokens**

Repeat Stage 2 token distribution from [Section 1](#stage-2--provision-agent-tokens) for all agents. The 24-hour grace window starts immediately.

---

## 4. Revoke an agent

Use this when an agent is being retired from the Squad or when a token is confirmed compromised and you need immediate invalidation (no grace period).

```bash
npx tsx src/scripts/provision-agent-token.ts <agent-slug> --revoke
```

**What it does:** Sets `active = FALSE` in the `agents` table. All tokens (primary and grace-period) for the agent are rejected immediately. The row is NOT deleted — the audit trail is preserved (SEC-C7).

**Expected output:**
```
[provision] Agent "murphy" (Murphy) has been revoked.
```

To re-enable a revoked agent, run the provision script without `--revoke` for the same slug. This generates a new token and sets `active = TRUE`.

```bash
npx tsx src/scripts/provision-agent-token.ts murphy
```

---

## 5. Verification pattern

Before running a destructive operation (batch rotation, revocation), use this verification sequence:

**1. Confirm the manifest loads cleanly:**
```bash
npx tsx src/scripts/provision-all-agents.ts --all --write-env /tmp/preflight.env
```
If the manifest is missing an agent or has a slug format error, this fails fast before touching the DB.

**2. Confirm DB connectivity:**
```bash
psql $DATABASE_URL -c "SELECT slug, active, last_used_at FROM agents ORDER BY slug;"
```
Verify all expected agents are present and `active = TRUE`.

**3. Confirm the Ethos Seal is healthy:**
```bash
curl -s http://localhost:3005/api/ethos-seal \
  -H "Authorization: Bearer $DASHBOARD_TOKEN" | jq .active.version
```
A healthy response returns a version number. An error means the seal or squad-api has a problem — resolve before rotating tokens.

---

## 6. Ingestion token (Bridge) — rotation procedure

> **SEC-C10 condition.** This section is required before any production deployment of the LLM usage tracking feature (ARCH-015).

The `OPENHIVEOS_INGESTION_TOKEN` is the shared secret used by Bridge to POST usage records to squad-api at `POST /internal/usage`. It is a 64-character lowercase hex string (32 bytes of CSPRNG entropy).

**Important:** There is no revocation list at v0.2. The token is compared live from the environment variable on each request. The old token is invalidated the moment the squad-api restarts with the new value.

### When to rotate

- Quarterly (scheduled), or
- Immediately if you suspect the token has been exposed (e.g. appeared in a log file, was committed to git, or was sent over an insecure channel).

### Rotation steps

**Step 1 — Generate a new token**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output. This is your new `OPENHIVEOS_INGESTION_TOKEN`.

**Step 2 — Update Bridge**

Set the new token as `OPENHIVEOS_INGESTION_TOKEN` in Bridge's environment (PM2 `.env`, `systemd` unit, or Compose `.env`). Restart Bridge:

```bash
pm2 restart nova-telegram-bridge    # or your Bridge process name
```

> At this point, Bridge is sending the new token. squad-api is still accepting the old token. There is a brief window where Bridge and squad-api are in sync on the old token.

**Step 3 — Update squad-api**

Set the new `OPENHIVEOS_INGESTION_TOKEN` in squad-api's `.env` file. Restart squad-api:

```bash
docker compose restart squad-api    # Docker
# or
pm2 restart squad-api               # PM2
```

**Step 4 — Verify**

The old token is now invalidated. Bridge should be sending the new token and receiving `201 Created` responses. Check Bridge logs for any `401` errors — they indicate a token mismatch.

### Feature dark note

Until Bridge is deployed and `OPENHIVEOS_INGESTION_URL` is configured, the `llm_usage` table will have no rows. The Usage view in the dashboard shows an empty state message — this is correct and expected, not an error:

> *No usage data yet. Usage data appears here after Bridge connects.*

---

## 7. Enable the integration profile (mcp-gateway)

> **ARCH-016 — Stage 6 of canonical operator onboarding.** Follow this section when you are connecting a Bridge (e.g. nova-telegram-bridge, openBridge) to the Squad Instance via the SSE integration layer. This is an optional capability — it is not required for the Squad to operate.

The mcp-gateway runs under the `integration` Compose profile. It is not started by `docker compose up -d` unless you explicitly enable it.

### Prerequisites

Before starting, confirm:

- Stages 1–5 are complete (Seal initialised, agents provisioned, squad-api healthy, Bridge connected and sending usage data).
- The host `.env` file contains values for:
  - `MCP_GATEWAY_TOKEN` — 64 lowercase hex characters (see Step 1 below)
  - `MCP_GATEWAY_PORT` — defaults to `3006` if not set
  - `GATEWAY_HEALTH_PORT` — defaults to `3007` if not set; must differ from the standalone mcp container `HEALTH_PORT` (default `3000`)
- The main project `dist/` folder exists and is current. The gateway spawns the MCP server binary from this folder as a subprocess. Run `npm run build` (or `docker compose build mcp`) if in doubt.

### Step 1 — Generate the MCP gateway token

This token is the shared secret between the mcp-gateway and any Bridge connecting to it. It must be 64 lowercase hex characters (32 bytes of CSPRNG entropy). This is separate from the Bridge `OPENHIVEOS_INGESTION_TOKEN` — they are two different secrets with different scopes.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output. You will need it in the next two steps.

> **Security:** Store this token in 1Password immediately. Never commit it to git. The `gitleaks.toml` rule `openhiveos-mcp-gateway-token` will block the commit if you try — this is intentional.

### Step 2 — Set the token in .env

Add the token to the Squad Instance `.env` file:

```bash
MCP_GATEWAY_TOKEN=<64-hex-chars-from-step-1>
MCP_GATEWAY_PORT=3006
GATEWAY_HEALTH_PORT=3007
```

If you are running multiple Squad Instances on the same host, each must use a different `MCP_GATEWAY_PORT` and `GATEWAY_HEALTH_PORT` to avoid collisions.

### Step 3 — Set the token in Bridge

Set `MCP_GATEWAY_TOKEN` and `MCP_GATEWAY_URL` in the Bridge's environment. The URL format depends on your topology:

**Topology A — Bridge runs on the same host as the Squad (PM2, systemd, or local process):**

```bash
MCP_GATEWAY_TOKEN=<same-64-hex-token>
MCP_GATEWAY_URL=http://127.0.0.1:3006
```

**Topology B — Bridge runs as a Compose co-deployed container on the same host:**

```bash
MCP_GATEWAY_TOKEN=<same-64-hex-token>
MCP_GATEWAY_URL=http://openhiveos-mcp-gateway:3006
```

In Topology B, `openhiveos-mcp-gateway` is the internal Docker DNS name for the gateway container. Bridge must be in the same Docker network.

### Step 4 — Build the gateway image

```bash
docker compose build openhiveos-mcp-gateway
```

The gateway Dockerfile compiles the TypeScript gateway code. This step only needs to be repeated when the gateway source code changes.

### Step 5 — Start the gateway

```bash
docker compose --profile integration up -d openhiveos-mcp-gateway
```

The gateway starts and immediately attempts to spawn the MCP server binary as a subprocess. It fetches the tool list to confirm the subprocess is healthy before opening the SSE endpoint.

**Expected startup log:**
```
[mcp-gateway] Subprocess ready — SSE endpoint open
[mcp-gateway] SSE endpoint listening on 127.0.0.1:3006
```

If the gateway is still initialising, `GET /health` returns `503 {"status":"starting"}`. Once the subprocess is ready, it returns `200 {"status":"ok"}`.

### Step 6 — Restart Bridge

Restart Bridge so it picks up the updated `MCP_GATEWAY_TOKEN` and `MCP_GATEWAY_URL`:

```bash
pm2 restart nova-telegram-bridge    # Topology A — PM2
# or
docker compose restart bridge       # Topology B — Compose co-deploy
```

### Step 7 — Verify the success signal

The success signal is a confirmed SSE connection in the Bridge logs. Look for:

```
[mcp-gateway] SSE session established: <session-uuid>
```

This line is written by the gateway when Bridge successfully authenticates and upgrades to an SSE stream. If you see it, Stage 6 is complete.

**Health check from the host:**

```bash
curl -s http://127.0.0.1:3006/health
# Expected: {"status":"ok"}
```

**Confirm the gateway container health:**

```bash
docker compose ps openhiveos-mcp-gateway
# STATUS column should show: healthy
```

### Token rotation for mcp-gateway

Rotate the `MCP_GATEWAY_TOKEN` using the same pattern as the ingestion token:

1. Generate a new 64-hex token (Step 1 above).
2. Update `MCP_GATEWAY_TOKEN` in Bridge's environment and restart Bridge.
3. Update `MCP_GATEWAY_TOKEN` in the Squad Instance `.env` and restart the gateway:
   ```bash
   docker compose --profile integration restart openhiveos-mcp-gateway
   ```

There is no grace window for the gateway token — the old token is invalidated the moment the gateway restarts with the new value. Update Bridge first to keep the connection alive.

---

## 8. Troubleshooting

### Token not accepted (401 after provisioning)

**Symptom:** Agent receives a 401 on all MCP tool calls immediately after provisioning.

**Cause:** The agent's environment is still using an old or incorrect token, or the VS Code session has not been restarted.

**Resolution:**
1. Confirm the token was copied correctly — paste it into a text editor and check for trailing whitespace or newline characters.
2. Restart the VS Code session (or PM2 process) to reload environment variables.
3. Check `agents.active` in the DB — the agent must have `active = TRUE`.
4. If still failing, rotate the token (Section 2) and retry.

### Token not accepted during grace window (rotation)

**Symptom:** Agent receives 401 errors within 24 hours of a rotation, still using the old token.

**Cause:** The grace window is stored in `previous_token_expires_at`. If the system clock on the DB host drifts significantly, the window may appear expired.

**Resolution:** Check `previous_token_expires_at` for the agent:
```sql
SELECT slug, previous_token_expires_at FROM agents WHERE slug = 'murphy';
```
If it is in the past, the grace window has expired. Provision a fresh token (Section 2).

### `--write-env` permission denied

**Symptom:** `provision-all-agents.ts` exits with `EACCES` or `EPERM` on the `--write-env` path.

**Cause:** `PROVISION_ENV_DIR` is not writeable by the current process.

**Resolution:**
1. Confirm the directory exists: `mkdir -p $PROVISION_ENV_DIR`
2. Confirm write permission: `touch $PROVISION_ENV_DIR/.test && rm $PROVISION_ENV_DIR/.test`
3. For Docker Compose: confirm the bind mount path exists on the host before running `docker compose --profile init run --rm provision`.

### Agent slug not in manifest

**Symptom:** `provision-agent-token.ts` exits with `Agent "<slug>" not found in manifest`.

**Cause:** The slug passed to the script does not match any entry in `squad.manifest.json`.

**Resolution:**
1. Check the manifest: `cat squad.manifest.json | jq '.agents[].slug'`
2. Confirm the slug matches exactly (case-sensitive, hyphens, no spaces).
3. If the agent is new, add them to `squad.manifest.json` and rebuild the image (`docker compose build mcp`).

### Gateway container stays `unhealthy`

**Symptom:** `docker compose ps openhiveos-mcp-gateway` shows `health: starting` or `unhealthy` after more than 60 seconds.

**Cause:** The MCP subprocess failed to start. Common causes: `dist/index.js` is missing from the mounted volume, `MCP_BINARY_PATH` is wrong, or the subprocess crashed on boot (missing env var, DB not ready).

**Resolution:**
1. Check gateway logs for the subprocess error:
   ```bash
   docker compose --profile integration logs openhiveos-mcp-gateway --tail=50
   ```
2. Confirm the `dist/` folder exists on the host and contains `index.js`:
   ```bash
   ls ./dist/index.js
   ```
   If missing, run `npm run build` and restart the gateway.
3. Confirm the gateway health endpoint responds:
   ```bash
   curl -s http://127.0.0.1:${MCP_GATEWAY_PORT:-3006}/health
   ```
   - `{"status":"ok"}` — subprocess is healthy.
   - `{"status":"starting"}` — subprocess is still initialising (wait 10 seconds and retry).
   - Connection refused — the gateway container itself has not started.

### Bridge receives 401 on SSE connection

**Symptom:** Bridge logs show `401 Invalid authentication token` when connecting to the gateway.

**Cause:** `MCP_GATEWAY_TOKEN` in Bridge's environment does not match the value in the gateway's environment, or Bridge is connecting to the wrong URL (still hitting the squad-api instead of the gateway).

**Resolution:**
1. Confirm the token in both environments matches exactly (no trailing whitespace):
   ```bash
   echo -n "$MCP_GATEWAY_TOKEN" | wc -c   # Should be 64
   ```
2. Confirm `MCP_GATEWAY_URL` in Bridge points to the gateway port (default `3006`), not the squad-api port (`3005`).
3. If the token was recently rotated, confirm Bridge was restarted *before* the gateway. The gateway invalidates the old token immediately on restart.

### Bridge receives 429 on SSE connection

**Symptom:** Bridge logs show `429 Too many SSE connection attempts. Retry later.`

**Cause:** Bridge is reconnecting more than 10 times per minute to the gateway. This typically happens when Bridge has a connection loop bug or is restarting too aggressively.

**Resolution:**
1. Check Bridge's reconnection backoff settings — it should use exponential backoff, not a fixed short interval.
2. The rate limit resets after 60 seconds. Wait for the window to expire before the next connection attempt.
3. If the gateway restarted (e.g. during a deploy), Bridge will trigger the rate limit if it reconnects immediately. Add a 5-second minimum backoff before SSE reconnection.

### Port collision — gateway won't bind

**Symptom:** Gateway container exits immediately with `EADDRINUSE` or `address already in use`.

**Cause:** Another process on the host is already using `MCP_GATEWAY_PORT` (default `3006`). Common on hosts running multiple Squad Instances.

**Resolution:**
1. Find the process using the port:
   ```bash
   lsof -i :3006
   ```
2. Set a different `MCP_GATEWAY_PORT` in `.env` (e.g. `3016` for a second Squad Instance).
3. Update `MCP_GATEWAY_URL` in Bridge to match the new port.
4. Restart the gateway.
