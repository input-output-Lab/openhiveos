---
title: "Authoring an Agentic SOP — The Standard for Writing SOPs"
version: "1.0.0"
scope: "all"
status: "active"
review_date: "2026-08-20"
tags:
  - type/sop
  - domain/documentation
---

When writing a new SOP for OpenHiveOS, always follow the agentic-first authoring standard defined in ARCH-009 Decision 9. An agent retrieves SOPs by cosine similarity — not by category browsing. A SOP that cannot be retrieved by an agent's natural-language query does not exist operationally, regardless of how well it is written.

## The Four Rules

**Rule 1 — Lead with the trigger.** Open the body with "When [situation]..." The trigger sentence is the primary semantic signal for retrieval. An agent querying "how do I register a new MCP tool" must match this sentence before reading anything else.

**Rule 2 — First-person imperative voice.** Write "Always use `registerTool()`" not "The team uses `registerTool()`." Agents generate first-person queries. The SOP voice must match the query voice. Third-person narration reduces cosine similarity to first-person agent queries.

**Rule 3 — One concept per file, 150–400 words.** A SOP covering two concepts embeds as a diffuse vector that ranks mediocre for both. Two atomic SOPs each rank near the top for their respective query. If you can describe a SOP with "it covers X *and* Y," split it.

**Rule 4 — Frame in plain language before any code.** State the rule in plain English first. The plain-English sentence carries more semantic weight than the code block. One minimal code example may follow the rule. Never open with a code block.

## Required Frontmatter

```yaml
---
title: "Concise, action-oriented title"  # required — use words an agent would search for
version: "1.0.0"                         # required; semver
scope: "all"                             # required; "all" or agent slug
status: "active"                         # required; draft | active | deprecated
review_date: "YYYY-MM-DD"               # recommended
tags: []                                 # optional
replaces: ""                             # optional; source_path of superseded SOP
---
```

A SOP with `status: "draft"` is skipped by the ingest runner — it does not enter the database until status is set to `active`.

## Where to Place New SOPs

Core SOPs authored by IO Labs go in `seeds/sops/core/<category>/`. Operator SOPs go in `seeds/sops/operator/<category>/`. The six valid categories are: `coding`, `devops`, `qa`, `architecture`, `documentation`, `decision`. Files outside these directories are skipped by the ingest runner with a warning.
