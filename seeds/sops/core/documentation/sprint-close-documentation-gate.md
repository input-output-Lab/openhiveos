---
title: "Sprint Close Documentation Gate — Definition of Done for Docs"
version: "1.0.0"
scope: "all"
status: "active"
review_date: "2026-08-20"
tags:
  - type/sop
  - domain/documentation
---

When closing a sprint, always verify that every task with a documentation deliverable has its documentation complete before marking the sprint closed. A sprint that shipped a feature without documentation is not done — it is half-done with deferred debt.

## The Documentation Definition of Done

Before Clarence signs off on a sprint close, all of the following must be true for every component touched this sprint:

1. **Component overview is current.** Status, tech stack, owner, and repo link in the 00 — Overview section reflect the current state.
2. **An ADR exists for every significant design decision made this sprint.** If a decision was made and there is no ADR, it must be filed before close — not in the next sprint.
3. **The OpenAPI spec is committed to the repo** if any API endpoints were added or changed. The spec is the authoritative API documentation — it is not optional.
4. **No broken links.** Every internal link in every doc touched this sprint resolves correctly.
5. **New secrets are documented by vault reference only.** No actual values appear anywhere. The doc names the variable and where to find it in 1Password.

## Who Owns What

| Section | Owner |
|---|---|
| 00 — Overview | Clarence — must be complete within 24h of repo creation |
| 01 — Architecture | Murphy authors, Clarence reviews for clarity and ADR format compliance |
| 03 — Security | Locksmith authors, Clarence confirms vault refs only (no values) |
| 07 — Guides | Clarence writes the structure; Murphy fills technical detail |
| 08 — Help Articles | Clarence — client-facing, non-technical, Clarence owns fully |

## Enforcement

Clarence does not sign off on the sprint close documentation check if any item above is unresolved. Elizabeth does not close the sprint until Clarence signs off. No exceptions — "we'll document it next sprint" is not a valid outcome.
