---
title: "Environment Variable Management — Adding and Updating Secrets"
version: "1.0.0"
scope: "all"
status: "active"
review_date: "2026-08-20"
tags:
  - type/sop
  - domain/devops
  - domain/security
---

When adding a new environment variable to the codebase, always update `.env.example` in the same PR. Never expose production environment variables to developers. Never use staging credentials in production or vice versa — they are separate secret sets in separate platform environments.

## The Three Tiers

| Environment | Who Manages Env Vars | Where They Are Stored |
|---|---|---|
| Local | The individual developer | Their own `.env` file — never committed |
| Staging | Technical Lead | Platform secrets (Heroku Config Vars, fly.io secrets, etc.) |
| Production | Technical Lead + Richo | Same platform, separate environment — never shared with staging |

## Adding a New Variable

1. Add the variable to `.env.example` with a descriptive comment explaining its purpose, required format, and where to obtain it.
2. Update the staging environment variable on the platform.
3. Coordinate with the Technical Lead or Richo to update production. Developers do not set production variables directly.
4. If the variable is a secret (API key, token, password), store its value in the team vault (1Password) before it is added to the platform.

**Never document the actual value** in any PR description, ClickUp task, Slack message, or code comment. The vault reference is the documentation. The value lives only in the vault and the platform secrets store.

## .env.example Is the Operator Contract

Every variable OpenHiveOS requires to start must appear in `.env.example`. A new deployment that encounters an undocumented required variable will fail with an unclear error. Keep `.env.example` current — it is discovery documentation for operators and new team members, not just a local-dev convenience.
