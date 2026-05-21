---
title: "Conventional Commits — Commit Message Format"
version: "1.0.0"
scope: "all"
status: "active"
review_date: "2026-08-20"
tags:
  - type/sop
  - domain/coding
---

When writing a commit message, always follow the Conventional Commits format. A commit that does not follow this format cannot be parsed by automated changelog tooling and creates an untraceble history.

## Format

```
type(scope): short description in imperative mood
```

The description must use imperative mood — "add auth middleware" not "added auth middleware." The type declares the nature of the change. The scope is the component or module affected.

## Allowed Types

| Type | When to Use |
|---|---|
| `feat` | Adds a new capability visible to users or agents |
| `fix` | Repairs a broken behaviour |
| `chore` | Maintenance: dependency updates, tooling config, non-feature changes |
| `docs` | Documentation changes only |
| `refactor` | Code restructuring with no behaviour change |
| `test` | Adds or modifies tests only |
| `perf` | Performance improvement with no API change |
| `ci` | Changes to CI/CD pipeline configuration |

Do not invent types. If the change does not fit a type above, use `chore`.

## Breaking Changes

When a commit introduces a breaking change to a primitive contract or API, append `!` after the type and include a `BREAKING CHANGE:` footer:

```
feat!: change search_sops return shape to include source_namespace

BREAKING CHANGE: callers must handle the new `source_namespace` field.
```

## Scope Examples for OpenHiveOS

`primitives`, `auth`, `db`, `search`, `embeddings`, `ci`, `seeds`, `migrations`.

## Common Mistakes

- Do not end the subject line with a period.
- Keep the subject line under 72 characters.
- Do not combine multiple changes in one commit ("add X and fix Y") — split them into separate commits.
