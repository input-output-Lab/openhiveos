---
title: "Pre-Merge Security Checklist — SEC-14 Through SEC-20"
version: "1.0.0"
scope: "all"
status: "active"
review_date: "2026-08-20"
tags:
  - type/sop
  - domain/qa
  - domain/security
  - project/openhiveos
---

When merging any PR that touches auth logic, bearer tokens, the `agents` table, or a new OS Primitive, always verify all seven gate conditions before approving. These are the SEC-14 through SEC-20 gates defined in ARCH-007. Every condition is a hard gate — not advisory. A PR missing any condition does not merge.

## The Seven Gate Conditions

**SEC-14 — Branch Protection Active**
`main` has branch protection enabled. Direct pushes to `main` are blocked. Verify in repository settings before the first PR on any new repo.

**SEC-15 — Secrets Scanning Wired**
The `gitleaks` pre-commit hook and CI scan are both active. Confirm the CI secrets-scanning step is green on the PR. If the step is absent, block the PR and tag the Technical Lead.

**SEC-16 — Timing-Safe Token Comparison**
All token hash comparisons use `timingSafeEqual` (Node.js `crypto` module). Locksmith must sign off on this condition — Murphy cannot self-certify SEC-16.

**SEC-17 — Dependency CVE Scan Passes**
Run `npm audit` (or Trivy for container images) locally. No high or critical CVEs may be present at merge time. Document any suppressed findings with justification in the PR description.

**SEC-18 — STRIDE Threat Model Committed**
Required once, before the v0.1 tag. The STRIDE threat model document must be committed to `docs/` before the first OS Primitive ships. For post-v0.1 PRs: verify the threat model has been updated if the PR changes the attack surface.

**SEC-19 — Zero Internal IO Labs References**
Run `grep -r "inputoutput\|io_labs\|io-labs\|iolabs" src/` — output must be empty. This is a hard CI gate. No internal company references may ship in the open-source codebase.

**SEC-20 — Rate Limiting Documented**
Every new public-facing endpoint must have rate limiting documented as a requirement, even if the implementation is deferred. Document in the PR description or in the relevant section of `docs/`.

## Who Signs Off

Locksmith is a required reviewer on all PRs that trigger this checklist. Tag Locksmith on PR open — do not wait until the PR is otherwise ready.
