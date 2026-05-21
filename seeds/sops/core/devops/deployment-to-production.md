---
title: "Deployment to Production — Manual Trigger Protocol"
version: "1.0.0"
scope: "all"
status: "active"
review_date: "2026-08-20"
tags:
  - type/sop
  - domain/devops
---

When deploying to production, always treat it as a deliberate, reviewed action — not a mechanical step after a merge. Only the Technical Lead triggers production deployments. Developers do not have direct production access.

## Go-Live Conditions

Before triggering a production deployment, all of the following must be true:

1. The PR has been merged to `main`.
2. The CI pipeline on `main` is green — all tests, lint, and security gates pass.
3. The feature has been tested on staging by the PM.
4. The PM has provided written staging sign-off (a task comment is sufficient).
5. There are no open blocking issues on the deploy.

If any condition is unmet, do not deploy. Tag the PM or Technical Lead to resolve.

## Deployment Steps

1. Confirm all go-live conditions above are met.
2. SSH to the production server.
3. Navigate to the project directory.
4. Pull the latest code: `git pull origin main`.
5. Run database migrations if applicable: `npm run migrate` or the stack-specific command.
6. Restart the service: `docker compose up -d --build`.
7. Verify the health endpoint responds correctly.
8. Post confirmation in the project Slack channel with the deployed commit hash.

## Rollback

If the health endpoint fails after deployment, roll back immediately — do not investigate the failure while the broken version is serving traffic:

```bash
git checkout <previous-commit-hash>
docker compose up -d --build
```

Roll back first. Investigate after. Document the incident in the task and tag Locksmith if the failure involved auth or data integrity.
