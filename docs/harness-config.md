# Harness Configuration Templates

**Purpose:** Connect your AI development harness (Claude Desktop, Cursor, or any MCP-compatible client) to your OpenHiveOS Squad Instance after `install.sh` completes.

**Owner:** Clarence  
**Last updated:** 2026-05-22 (Sprint 8 — S8-09)  
**Source authority:** ARCH-001, ARCH-008, ARCH-014, sprint planning decision 2026-05-22

---

## Contents

1. [Before you start](#1-before-you-start)
2. [Your agent token](#2-your-agent-token)
3. [Claude Desktop](#3-claude-desktop)
4. [Cursor (and other stdio harnesses)](#4-cursor-and-other-stdio-harnesses)
5. [Generic stdio harness](#5-generic-stdio-harness)
6. [Security notes](#6-security-notes)
7. [Verifying the connection](#7-verifying-the-connection)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Before you start

`install.sh` must have run to completion before you configure a harness. After it finishes, confirm:

```bash
docker compose ps
```

All three services must be running: `mcp`, `squad-api`, `postgres`.

**Required on this machine:**
- Docker Desktop (or Docker Engine 24+) with Compose v2
- The OpenHiveOS repository cloned and accessible

**Your agent token is in:**
```
./provision/.env.tokens
```

---

## 2. Your agent token

`install.sh` Step 12 provisions a unique token for each agent in your Squad. The tokens are written to:

```
./provision/.env.tokens     (chmod 600 — readable only by you)
```

Open the file to find your token:

```bash
cat provision/.env.tokens
```

Each line has the format:

```
AGENT_TOKEN_<SLUG>=<32-hex-salt>.<64-hex-secret>
```

For example:
```
AGENT_TOKEN_MURPHY=a1b2c3d4...1234.e5f6a7b8...5678
AGENT_TOKEN_SILAS=...
AGENT_TOKEN_ROCKET=...
```

You will use the value on the right-hand side of `=` as `AGENT_TOKEN` in your harness configuration. Each agent must use their own token — tokens are not interchangeable.

> **Security:** Store your token in your password manager (e.g. 1Password) immediately. The token file should not be committed to git. If a token is compromised, see the [Agent Onboarding Runbook](08-agent-onboarding.md#2-rotate-a-single-agents-token) for rotation instructions.

---

## 3. Claude Desktop

> **⚠ Security advisory — Locksmith sign-off pending (due 2026-05-30).**  
> Claude Desktop stores its MCP server configuration in a local JSON file. This file must contain your `AGENT_TOKEN` in plaintext. The token is not transmitted over the network — it is passed to the process running on your machine. Treat this file with the same care as a private key. See [Section 6](#6-security-notes) for full details.

### macOS config file location

```
~/Library/Application Support/Claude/claude_desktop_config.json
```

### Configuration

Replace `/absolute/path/to/openhiveos` with the actual path to your cloned OpenHiveOS repository, and `YOUR_AGENT_TOKEN_HERE` with your token value from `provision/.env.tokens`.

```json
{
  "mcpServers": {
    "openhiveos": {
      "command": "bash",
      "args": [
        "-c",
        "cd /absolute/path/to/openhiveos && docker compose exec -i -e AGENT_TOKEN mcp node dist/index.js"
      ],
      "env": {
        "AGENT_TOKEN": "YOUR_AGENT_TOKEN_HERE"
      }
    }
  }
}
```

**How it works:**

1. Claude Desktop starts a subprocess (`bash`) and sets `AGENT_TOKEN` from the `env` block.
2. The script changes directory to the OpenHiveOS repository root.
3. `docker compose exec -i -e AGENT_TOKEN mcp node dist/index.js` runs the MCP server binary inside the already-running `mcp` container, forwarding the `AGENT_TOKEN` environment variable.
4. The MCP server resolves your agent identity from the token at startup (ARCH-001) and begins accepting tool calls over stdio.

**After editing the config:** Quit Claude Desktop fully (`⌘Q`), then reopen it.

### Multiple agents on one machine

If more than one agent uses Claude Desktop on the same machine, each must have their own entry under `mcpServers` using a unique key and their own token:

```json
{
  "mcpServers": {
    "openhiveos-murphy": {
      "command": "bash",
      "args": ["-c", "cd /absolute/path/to/openhiveos && docker compose exec -i -e AGENT_TOKEN mcp node dist/index.js"],
      "env": { "AGENT_TOKEN": "MURPHY_TOKEN_HERE" }
    },
    "openhiveos-silas": {
      "command": "bash",
      "args": ["-c", "cd /absolute/path/to/openhiveos && docker compose exec -i -e AGENT_TOKEN mcp node dist/index.js"],
      "env": { "AGENT_TOKEN": "SILAS_TOKEN_HERE" }
    }
  }
}
```

---

## 4. Cursor (and other stdio harnesses)

Cursor's MCP configuration follows the same structure as Claude Desktop. The config file is typically at:

```
~/.cursor/mcp.json
```

Use the same JSON structure as the Claude Desktop example above.

The `"env"` block and `"args"` are identical. Only the file path changes.

---

## 5. Generic stdio harness

Any MCP-compatible host that supports stdio transport can connect to OpenHiveOS. The process to start is:

**Command:** `bash`  
**Arguments:**
```
-c
cd /absolute/path/to/openhiveos && docker compose exec -i -e AGENT_TOKEN mcp node dist/index.js
```

**Environment variables to set before launch:**
```
AGENT_TOKEN=<your-token-from-provision/.env.tokens>
```

**Working directory:** The harness can set any `cwd` — the explicit `cd` in the script ensures the repo root is used regardless.

**Protocol:** MCP over stdio (JSON-RPC 2.0). The server speaks `StdioServerTransport` (ARCH-008 Decision 6).

---

## 6. Security notes

### Literal token in config files

Claude Desktop and most stdio harnesses require the `AGENT_TOKEN` to appear as a literal string in the harness config file. This is unavoidable for this integration pattern.

**Mitigations:**
- Set strict file permissions on your config: `chmod 600 ~/Library/Application\ Support/Claude/claude_desktop_config.json`
- Do not commit the config file to git.
- If the token is exposed, rotate it immediately. See the [Agent Onboarding Runbook](08-agent-onboarding.md#2-rotate-a-single-agents-token).

### docker history exposure (SEC-D3)

The dashboard agent token is baked into the Docker image layer during `install.sh`. It is visible via `docker history`. This is an accepted risk for single-tenant self-hosted installs — you control your own Docker daemon.

**Do not push your local OpenHiveOS Docker image to a public registry.** The image built by `install.sh` is for local operation only.

### Token scope

Each agent token is scoped to a single agent identity (ARCH-001). A token cannot impersonate a different agent — identity is resolved server-side by the Squad Instance, not supplied by the caller.

---

## 7. Verifying the connection

After starting your harness, confirm the connection is working:

**1. Check that the mcp container is running:**
```bash
docker compose ps mcp
```
The `STATUS` column should show `healthy`.

**2. Confirm the health endpoint:**
```bash
curl -s http://localhost:3000
# Expected: {"status":"ok"}
```

**3. Call a tool from your harness.** The simplest test is `search_memory` with a trivial query. If the tool returns a result (even an empty one), the connection is live.

**4. Confirm your identity was resolved correctly.** Call `get_disposition` or another primitive that returns agent context. The response should reflect your agent's identity — not another agent's.

---

## 8. Troubleshooting

### Connection refused / container not running

**Symptom:** The harness cannot start the process, or `docker compose ps` shows the `mcp` container is not running.

**Resolution:**
1. From the OpenHiveOS repository root, run: `docker compose up -d`
2. Wait for all services to show `healthy`.
3. Retry the harness connection.

### Tool calls fail immediately (authentication error)

**Symptom:** The MCP server starts but all tool calls return an authentication error, or the server exits shortly after starting.

**Cause:** The token value in the harness config is missing, incorrectly copied, or belongs to a revoked agent.

**Resolution:**
1. Open `provision/.env.tokens` and confirm the token value matches what is in the harness config exactly — check for leading/trailing whitespace or newline characters.
2. Confirm the agent is active in the database:
   ```bash
   docker compose exec -T postgres psql -U openhiveos -d openhiveos \
     -c "SELECT slug, active FROM agents ORDER BY slug;"
   ```
   The agent's `active` column must be `TRUE`.
3. If the token was lost or may be compromised, rotate it: see the [Agent Onboarding Runbook](08-agent-onboarding.md#2-rotate-a-single-agents-token).

### `exec` fails: container not found

**Symptom:** `docker compose exec` reports that the `mcp` service is not running.

**Cause:** The `mcp` container stopped (crash, host restart, or `docker compose down`).

**Resolution:**
```bash
cd /path/to/openhiveos
docker compose up -d
```

### Token accepted but tools return wrong agent context

**Symptom:** Tool calls succeed, but the agent identity in responses (e.g. from `get_disposition`) is wrong — it shows a different agent's data.

**Cause:** Two agents sharing the same token, or the wrong token was copied into the harness config.

**Resolution:** Each agent must use their own token from `provision/.env.tokens`. If tokens were not provisioned per-agent (only a single `AGENT_TOKEN` exists), re-run provisioning:
```bash
docker compose --profile init run --rm provision
```

---

*Harness config templates are correct as of Sprint 8 install.sh completion. If install.sh is re-run (e.g. after a token rotation), agent tokens in harness configs must be updated to match the new values in `provision/.env.tokens`.*
