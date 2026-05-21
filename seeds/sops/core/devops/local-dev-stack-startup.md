---
title: "Local Dev Stack Startup — Docker Compose"
version: "1.0.0"
scope: "all"
status: "active"
review_date: "2026-08-20"
tags:
  - type/sop
  - domain/devops
  - project/openhiveos
---

When starting the OpenHiveOS local development stack, always use Docker Compose. Never run the TypeScript server directly against a live database — environment variables and container networking will differ from the expected configuration and the health fingerprint check will fail.

## Required Environment Variables

Before running the stack, copy `.env.example` to `.env` and populate all required values:

- `DATABASE_URL` — PostgreSQL connection string (points to the local `openhive_db` container)
- `GEMINI_API_KEY` — Required for SOP and memory embedding generation
- `AGENT_TOKEN` — Bearer token for the agent identity under test
- `AGENT_SLUG` — Slug of the agent (e.g., `murphy`, `clarence`, `cooper`)

Never commit your `.env` file. It is listed in `.gitignore`.

## Starting the Stack

```bash
docker compose up
```

Use `--build` only when you have modified the `Dockerfile` or `package.json`:

```bash
docker compose up --build
```

## Verifying the Stack Is Healthy

Wait for the health endpoint to respond before connecting an agent client:

```bash
curl http://localhost:3000/health
# Expected: {"status":"ok","agent":"murphy","fingerprint":"..."}
```

If the health endpoint returns a non-200 response or the fingerprint is wrong, inspect the logs:

```bash
docker compose logs openhive-mcp --tail=50
```

## Stopping the Stack

```bash
docker compose down
```

To remove the database volume and reset to a clean state:

```bash
docker compose down -v
```

Use volume removal only when you need to re-run migrations from scratch. It destroys all local data — do not use it as a debugging shortcut.
