---
title: "Getting Started — Installation Guide"
date: 2026-06-15
status: published
decision_owner: clarence
tags:
  - type/guide
  - domain/operations
  - domain/deployment
  - audience/operators
  - audience/developers
---

# Getting Started — Installation Guide

This guide walks you through installing and running OpenHiveOS on your machine or server.

**Time estimate:** 10–15 minutes for a fresh installation  
**Prerequisites:** Docker 24+, Node.js 22+, PostgreSQL 17 (installed automatically)  
**Audience:** Operators and developers setting up a self-hosted Squad Instance

---

## What You'll Get

After installation, you will have:

- One complete OpenHiveOS deployment (one "Squad")
- A PostgreSQL database with semantic memory, thoughts, SOPs, and agent registry
- An MCP server process listening on port 3000 (configurable)
- A fully-functional operator dashboard accessible at http://localhost:6006
- Agent bearer tokens provisioned and ready for use

---

## Prerequisites

Before you start, verify you have these tools installed:

| Tool | Version | Purpose | Install |
|---|---|---|---|
| **Docker Engine** | 24+ | Container runtime | [docker.com/engine/install](https://docs.docker.com/engine/install/) |
| **Docker Compose** | v2 plugin | Orchestration | Included with Docker Desktop |
| **Node.js** | 22+ | Dashboard build (host) | [nodejs.org](https://nodejs.org) |
| **npm** | Bundled | Package manager | Included with Node.js |
| **openssl** | Any | Secret generation | `brew install openssl` (macOS) or `apt install openssl` (Linux) |

### Check prerequisites

```bash
docker --version          # Docker Engine 24+
docker compose version    # Docker Compose v2
node --version           # v22+
npm --version            # Should exist
openssl version          # Should exist
```

If any tool is missing, install it using the links above. The installer script will halt with a clear error message if a prerequisite is not found.

---

## Installation Steps

### Step 1: Clone the Repository

```bash
git clone https://github.com/input-output-lab/openhiveos.git
cd openhiveos
npm install
```

### Step 2: Run the Installer

From the repository root, run the automated installer:

```bash
./install.sh
```

The installer will:
1. ✓ Verify all prerequisites are installed
2. ✓ Prompt you for `.env` configuration (or keep existing)
3. ✓ Generate cryptographic secrets securely
4. ✓ Start PostgreSQL in a Docker container
5. ✓ Apply database migrations
6. ✓ Initialize the Ethos Seal (one-time company identity)
7. ✓ Provision agent bearer tokens
8. ✓ Build the operator dashboard
9. ✓ Start all services

The entire process is **idempotent** — you can re-run `./install.sh` safely at any time. It will ask before overwriting your `.env` file.

### Step 3: Verify Installation

Once the installer completes, verify all services are running:

```bash
docker compose ps
```

You should see:

```
NAME              STATUS          PORTS
openhiveos-db-1   Up (healthy)    5432/tcp
openhiveos-app-1  Up (healthy)    3000/tcp
```

### Step 4: Access the Dashboard

Open your browser and navigate to:

```
http://localhost:6006
```

You should see the OpenHiveOS operator dashboard. This is your control panel for managing agents, viewing thoughts, executing SOPs, and monitoring the Squad.

---

## Configuration

The installer creates a `.env` file in the repository root. You can edit it to customize your deployment.

### Key Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://openhiveos:${POSTGRES_PASSWORD}@localhost:5432/openhiveos` | PostgreSQL connection string |
| `GEMINI_API_KEY` | (required) | Google Gemini API key for embeddings |
| `HEALTH_PORT` | `3000` | MCP server listen port |
| `DASHBOARD_PORT` | `6006` | Operator dashboard port |

### To use your own PostgreSQL server

If you prefer to use an existing PostgreSQL server instead of the Docker container:

1. Edit `.env` and set `DATABASE_URL` to your PostgreSQL connection string
2. Ensure the database exists and `pgvector` extension is installed
3. Re-run `./install.sh` — it will use your external database

---

## Connecting Agents

Once OpenHiveOS is running, agents connect via the Model Context Protocol using bearer tokens.

### Get your agent tokens

The installer prints agent tokens to the terminal. You can also retrieve them:

```bash
docker compose exec app npm run list-tokens
```

Each token is scoped to **one Squad only**. Tokens from another Squad Instance will be rejected.

### Connect an agent (example)

```javascript
import { MCP_SDK } from '@io-labs/mcp-client';

const client = new MCP_SDK({
  transport: 'sse',
  baseUrl: 'http://localhost:3000',
  bearerToken: 'your-agent-token-here',
});

await client.store_memory({
  content: 'I am Murphy, the backend engineer.',
  metadata: { agent: 'murphy', domain: 'coding' },
});
```

See the [MCP SDK documentation](../coordination-utilities-reference.md) for the full API.

---

## Troubleshooting

### "Docker daemon is not running"

**Solution:** Start Docker Desktop (macOS/Windows) or the Docker daemon (Linux):

```bash
# macOS
open -a Docker

# Linux (systemd)
sudo systemctl start docker
```

### "Node.js 22+ required"

**Solution:** Upgrade Node.js:

```bash
# Using Homebrew (macOS)
brew install node@22

# Using nvm (all platforms)
nvm install 22
nvm use 22
```

### "PostgreSQL password authentication failed"

**Solution:** Clear `.env` and re-run the installer to regenerate secrets:

```bash
rm .env
./install.sh
```

### "Port 3000 already in use"

**Solution:** Edit `.env` and change `HEALTH_PORT`:

```env
HEALTH_PORT=3001
```

Then restart:

```bash
docker compose restart app
```

### "Dashboard not loading at localhost:6006"

**Solution:** Check that the dashboard container is running:

```bash
docker compose ps
docker compose logs dashboard
```

If the logs show build errors, rebuild:

```bash
docker compose down
./install.sh
```

### "Migrations failed during startup"

**Solution:** Inspect the database logs:

```bash
docker compose logs db
```

If the database is corrupted, reset it:

```bash
docker compose down -v  # WARNING: deletes data
./install.sh
```

---

## Next Steps

### 1. Configure Your Company Identity

Update the Ethos Seal with your company name, mission, and values:

```bash
docker compose exec app npm run configure-ethos-seal
```

This is a one-time setup per Squad Instance.

### 2. Add Your First Agent

Provision tokens for your agent team. Each agent needs a unique bearer token:

```bash
docker compose exec app npm run provision-agents --names murphy,rocket,scout,locksmith
```

### 3. Review SOPs

SOPs (Standing Operating Procedures) guide agent behavior at decision time. See the [SOP library reference](../coordination-utilities-reference.md) for how to author and deploy SOPs.

### 4. Monitor and Scale

- **Health checks:** `curl http://localhost:3000/health`
- **Logs:** `docker compose logs -f app`
- **Database queries:** Connect a psql client to inspect memories, thoughts, and agents

---

## For Production Deployments

This guide covers **local development**. For production deployments on cloud infrastructure:

1. **Host on stable infrastructure** — cloud VMs (AWS EC2, Google Cloud VM, Azure VM) or Kubernetes clusters
2. **Use managed PostgreSQL** — AWS RDS, Google Cloud SQL, or Azure Database for PostgreSQL
3. **Enable HTTPS** — terminate TLS at a reverse proxy (nginx, Caddy, or cloud load balancer)
4. **Audit and harden** — follow [Security & Compliance](../ARCH-002-pgvector-backend-pk-convention.md) guidelines
5. **Set environment variables securely** — use secrets management (AWS Secrets Manager, HashiCorp Vault, etc.)

For detailed production guidance, see [Deployment Procedures](../00-inception.md).

---

## Support & Feedback

If you encounter issues:

1. **Check troubleshooting above** — most problems have solutions listed
2. **Review logs** — `docker compose logs [service]` for detailed error messages
3. **Report bugs** — Open a GitHub issue with logs and reproduction steps
4. **Discuss with the team** — Reach out on our community channels

---

## What Happens Next?

After installation:

- **Agents can connect** via MCP bearer tokens and start storing memories, logging thoughts, and retrieving SOPs
- **Operators can monitor** Squad health via the dashboard
- **Data persists** in PostgreSQL with semantic embeddings for rapid retrieval
- **Thoughts are journal-tracked** for cross-agent ratification and continuous improvement

You now have a fully-functional OpenHiveOS Squad ready for agent teams.

---

## Related Documentation

- [OpenHiveOS Inception](./00-inception.md) — Product vision and architecture foundation
- [Coordination Utilities Reference](./coordination-utilities-reference.md) — Full MCP API surface
- [Ethos Seal Configuration](./ARCH-013-the-one-ethos-seal.md) — Company identity system
- [Agent Onboarding](./08-agent-onboarding.md) — Provisioning new agents
