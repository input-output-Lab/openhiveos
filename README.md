# OpenHiveOS

**The open operating system for AI agent teams.**

Each Squad is a hexagon — isolated, self-contained, sovereign. Hexagons tile perfectly. That is the architecture: federated deployments that share no state, scale independently, and compose into a hive.

---

## What it is

OpenHiveOS is the cognitive infrastructure layer that an AI agent team runs on. It gives a Squad of agents:

- **A shared memory store** — agents write and retrieve semantic memories, cross-referenced and ranked
- **A thought journal** — agents log reasoning, surface concerns, and propose realizations for peer ratification
- **A SOP library** — standing operating procedures retrieved by semantic search at decision time
- **A disposition system** — per-agent behavioral sliders that shift how an agent communicates under pressure
- **A verified agent registry** — every tool call is scoped to one Squad; agents cannot impersonate each other

OpenHiveOS is not a framework. It is not an agent. It is the substrate.

---

## Architecture

OpenHiveOS uses a two-tier model:

| Tier | Purpose | Who connects |
|---|---|---|
| **OS Primitives** | Memory, thoughts, SOPs, dispositions, agent registry | Agents only — via bearer token |
| **Coordination Utilities** | Tasks, projects, schedules, cross-agent coordination | External integrations — via API |

The two tiers share a database but are enforced as separate import boundaries at the code level. An integration that connects to Coordination Utilities cannot touch OS Primitives.

### OS Primitives

| Primitive | What it does |
|---|---|
| `store_memory` | Write a memory entry with Gemini-generated embedding |
| `search_memory` | Retrieve memories by semantic similarity + BM25 reranking |
| `search_sops` | Find relevant SOPs by category and semantic query |
| `store_thought` | Log a typed thought (analysis, concern, decision, hypothesis, realization, pushback) |
| `query_thoughts` | Read the thought journal — filter by agent, type, date range, or ratification state |
| `ratify_thought` | Promote a peer's realization into memory — cross-agent, never self |
| `get_disposition` | Read an agent's current behavioral disposition profile |
| `set_disposition` | Adjust an agent's disposition sliders |

### The Squad

Each deployed instance of OpenHiveOS is one Squad. One Squad has:

- One PostgreSQL database (with `pgvector`)
- One MCP server process
- Its own `squad.manifest.json` — the authoritative agent roster
- Its own bearer tokens, scoped only to that Squad's agents

One operator can run many Squads. Squads communicate via [openBridge](https://github.com/input-output-Lab/openbridge).

---

## Stack

| Component | Technology |
|---|---|
| Runtime | Node.js ≥ 20 |
| Language | TypeScript (strict) |
| Protocol | [Model Context Protocol](https://modelcontextprotocol.io) |
| Database | PostgreSQL 17 + pgvector |
| Embeddings | Google Gemini (`gemini-embedding-001`, 768d) |
| Deployment | Docker Compose |

---

## Prerequisites

- Node.js 20 or later
- PostgreSQL 17 with the `pgvector` extension installed
- A Google Gemini API key

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/input-output-Lab/openhiveos.git
cd openhiveos
npm install
```

### 2. Configure environment

Create a `.env` file in the project root:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/openhiveos
GEMINI_API_KEY=your-gemini-api-key
HEALTH_PORT=3000
```

### 3. Set up PostgreSQL

Install `pgvector` and create the database:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Then apply the founding schema:

```bash
psql "$DATABASE_URL" -f migrations/001_init.sql
```

### 4. Configure your Squad manifest

Edit `squad.manifest.json` to define your agent roster:

```json
{
  "version": "1.0.0",
  "squad": "your-squad-name",
  "agents": [
    { "slug": "agent-one", "name": "Agent One", "role": "Your role description" }
  ]
}
```

Each `slug` is the identifier used in all tool calls. It must be lowercase kebab-case.

### 5. Build and start

```bash
npm run build
npm start
```

On startup, OpenHiveOS will:
1. Validate all required environment variables
2. Connect to PostgreSQL
3. Verify the schema fingerprint — all required tables and extensions must be present
4. Start the health server on `HEALTH_PORT`
5. Start the MCP server on stdio

### 6. Verify

```bash
curl http://localhost:3000
```

Expected response:

```json
{
  "status": "ok",
  "version": "0.2.0",
  "squad": "your-squad-name",
  "agents": ["agent-one"],
  "db": "connected"
}
```

---

## Development

```bash
npm run dev        # tsx watch mode
npm run typecheck  # TypeScript strict check
npm run lint       # ESLint --max-warnings 0
```

---

## Project Structure

```
src/
  config.ts              # Zod-validated env schema — fails fast on startup
  health.ts              # HTTP health server (GET /)
  index.ts               # Entry point — boot sequence + MCP server
  db/
    client.ts            # pg Pool
    fingerprint.ts       # Boot schema guard
    queries/
      memory.ts          # Memory read/write
      sops.ts            # SOP search
      thoughts.ts        # Thought journal + disposition
  embeddings/
    gemini.ts            # Gemini embedding-001, 768d, 3-retry backoff
  primitives/            # One file per OS Primitive tool
  search/
    bm25.ts              # Okapi-BM25 hybrid reranker
    sanitizer.ts         # Query sanitizer (injection guard)
  squad/
    manifest.ts          # squad.manifest.json loader + validators
  utilities/             # Coordination Utility tools (added in Sprint 2+)
migrations/
  001_init.sql           # Founding schema — agents, sops, memories, thoughts, dispositions
squad.manifest.json      # Agent roster for this Squad instance
```

---

## Health Check

The health endpoint is designed for Docker and load balancer health checks.

| Status | HTTP | Meaning |
|---|---|---|
| `ok` | 200 | MCP server running, database connected |
| `degraded` | 503 | Database unreachable — do not route traffic |

---

## Inter-Squad Communication

Squads communicate via [openBridge](https://github.com/input-output-Lab/openbridge) — a peer-to-peer message bus using Ed25519 key pairs and a TOFU trust model. Each bridge connection is between exactly two Squad Instances. There is no central broker.

---

## Smoke Tests

Verify the LLM usage ingestion path end-to-end (requires a running server and a configured `.env`):

```bash
bash scripts/smoke_report_usage.sh
```

Asserts: HTTP 201 on first POST, correct row in `llm_usage`, HTTP 409 on replay, and field-level value checks.

---

## License

See [LICENSE](LICENSE).

---

## Built by Input Output Labs

[inputoutput.co](https://inputoutput.co)
