---
title: "ADR Filing Standard — When and How to File an Architectural Decision Record"
version: "1.0.0"
scope: "all"
status: "active"
review_date: "2026-08-20"
tags:
  - type/sop
  - domain/architecture
---

When making a significant architectural decision — one that affects the codebase structure, service boundaries, schema, auth, or external contracts — always file an ADR before implementation begins. Decisions made without an ADR are invisible to future agents and team members. If Silas says it warrants an ADR, file it.

## When to File

File an ADR for any decision that meets one or more of these conditions:

- A new database table or schema is added
- A new inter-service contract is established
- A new external dependency is approved
- A service boundary is changed or a module is split
- A new authentication or token mechanism is introduced
- A security architecture decision is made (key rotation, encryption approach)
- A query strategy or caching layer is selected

When in doubt: ask Silas. If the decision will constrain how other agents or developers work in the future, it qualifies.

## Where ADRs Are Filed

| Scope | Location |
|---|---|
| Project-specific | `docs/` in the relevant project repo |
| Cross-project or labs-wide | `SOPs/04-engineering/adr/` |

All OpenHiveOS ADRs live in `docs/` at the repo root, numbered sequentially as `ARCH-NNN — Title.md`.

## Required Approval

Every ADR requires:
- A named **Decision Owner** (the person accountable for the decision)
- Approval by **Elizabeth** (sprint alignment gate)
- Review by **Silas** for architecture-tier decisions
- Review by **Locksmith** for decisions affecting auth, secrets, or the security surface

## ADR Format

Use the Full format for decisions with significant trade-off analysis. Use the Quick format for straightforward, uncontested decisions. Both formats require: context, decision, rationale, consequences, and a vote record.

File the ADR as a `.md` file in `docs/` on the same PR as the first implementation commit that acts on the decision. A decision that shipped without an ADR is not done — file it retroactively on the next PR.
