# OpenHiveOS SOP Library

This directory contains the Standard Operating Procedures (SOPs) that power `search_sops` — the OS Primitive that agents query before taking action on any significant task.

SOPs are not documentation in the traditional sense. They are retrieval targets. An agent does not browse this folder — it generates a natural-language query from its action context and receives the most semantically relevant SOP. **What you write here determines what agents know.**

---

## Directory Structure

```
seeds/sops/
  core/           ← Authored and maintained by IO Labs
    architecture/
    coding/
    decision/
    devops/
    documentation/
    qa/
  operator/       ← Add your own SOPs here
    (any of the six category directories above)
  README.md       ← You are here
```

---

## The Six Categories

| Category | Directory | Covers |
|---|---|---|
| `Architecture` | `architecture/` | ADR standards, service boundaries, schema decisions |
| `Coding` | `coding/` | Code conventions, PR standards, branch model, secrets rules |
| `Decision` | `decision/` | How decisions are made, superseded, and recorded |
| `DevOps` | `devops/` | Deployment, local dev setup, environment management |
| `Documentation` | `documentation/` | SOP authoring, sprint close docs gate, component docs |
| `QA` | `qa/` | Security checklists, task lifecycle, pre-merge gates |

These are the only valid categories. A `.md` file placed outside a recognised category directory is skipped by the ingest runner with a warning. New categories require a schema migration and a new ADR.

---

## Adding Your Own SOPs (Operators)

Place your `.md` files in `seeds/sops/operator/<category>/`. The ingest runner picks up any `.md` file in the tree at boot — there is no registration step.

**Every SOP must include this frontmatter:**

```yaml
---
title: "Concise, action-oriented title"  # required
version: "1.0.0"                         # required; semver
scope: "all"                             # required; "all" or agent slug
status: "active"                         # required; draft | active | deprecated
review_date: "YYYY-MM-DD"               # recommended
---
```

SOPs with `status: "draft"` are skipped by the ingest runner. Use draft status for works-in-progress.

---

## Writing Effective SOPs

Agents retrieve SOPs by cosine similarity. A SOP that reads like a policy memo will not be retrieved by an agent asking a first-person operational question. Follow these four rules:

1. **Lead with the trigger.** Open with "When [situation]..." — this is the primary retrieval signal.
2. **First-person imperative.** "Always use `registerTool()`" not "The team uses `registerTool()`."
3. **One concept per file, 150–400 words.** A SOP covering multiple concepts ranks mediocre for all of them.
4. **Plain English before code.** State the rule first. One minimal example may follow.

For the full authoring standard, see `core/documentation/authoring-an-agentic-sop.md`.

---

## Shadow Warnings

If your operator SOP is semantically very similar to a core SOP (cosine similarity ≥ 0.92), the ingest runner emits a structured warning at boot:

```
WARN [sop-ingest]: operator SOP [your-file] semantically shadows core SOP [core-file] (cosine: 0.94). Both will be retrieved. Review intentional?
```

Both SOPs remain active and searchable. The warning is informational — it is not a block. If you intentionally want to override a core SOP for your deployment context, this is expected behaviour.

---

## Upgrade Behaviour

When you run `git pull && docker compose up`, the ingest runner automatically detects changes to `seeds/sops/core/` by SHA-256 content hash. Updated files are re-embedded. Unchanged files are skipped — no redundant embedding API calls.

To preview what will change before committing:

```bash
docker compose run openhive-mcp npm run seed:sops -- --dry-run
```

Output: a table of `[source_path] [namespace] [status: NEW | UPDATED | UNCHANGED]` with no writes.

---

*SOP Library — OpenHiveOS v0.1 | Maintained by Clarence | Last updated: 2026-05-20*
