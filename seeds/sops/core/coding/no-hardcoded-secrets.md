---
title: "No Hardcoded Secrets — Credential and Token Storage Rule"
version: "1.0.0"
scope: "all"
status: "active"
review_date: "2026-08-20"
tags:
  - type/sop
  - domain/coding
  - domain/security
---

When adding credentials, API keys, tokens, or any sensitive value to the codebase, never hardcode them in source files. Always load them from environment variables. A credential committed to Git — even briefly, even in a private repo — is a compromised credential. Rotation is required the moment it appears in any commit.

## The Rule

Sensitive values never appear in source code. The only place their values are written down is the team vault (1Password). In code, always read them from `process.env`:

**Correct:**
```typescript
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error('GEMINI_API_KEY is required');
```

**Never:**
```typescript
const apiKey = 'AIzaSy...'; // this is a production incident
```

## Enforcement

Two gates catch secrets before they reach `main`:

1. **Pre-commit hook** — `gitleaks` scans the diff before the commit is created. A detection blocks the commit entirely.
2. **CI gate** — the same `gitleaks` scan runs in the GitHub Actions pipeline. A detection fails the build and blocks merge.

If `gitleaks` triggers a false positive on a non-secret value, add a `# gitleaks:allow` inline comment and document the reason in the PR description. Do not disable the scanner.

## If a Secret Leaks

Rotate the credential immediately — do not wait to confirm whether it was accessed. Then use `git filter-repo` to scrub the commit from history. Tell Locksmith.

## .env.example Is Required

Every environment variable that OpenHiveOS requires must have a corresponding entry in `.env.example` with a descriptive comment explaining what it is and where to obtain it. A new variable added to the codebase without a `.env.example` entry is an incomplete PR.
