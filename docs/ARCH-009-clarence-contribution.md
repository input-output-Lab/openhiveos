# Superseded

This scratch file has been incorporated into the canonical ADR.

**See:** [ARCH-009-sop-seeding-operator-onboarding.md](ARCH-009-sop-seeding-operator-onboarding.md)

This file should be deleted.

---

## 1. Agentic-First SOP Authoring Standard

### How Agents Query — and Why It Changes Everything

An agent does not open a menu, click a category, or read Section 4.2. An agent generates a natural-language query from its action context — the thing it is about to do — and calls `search_sops({ query: "...", category: "Coding", limit: 3 })`. The query is first-person and situational:

> *"How do I register a new MCP tool?"*  
> *"What's the convention for naming database migrations?"*  
> *"I need to add a secret to the environment — where does it go?"*

The retrieval result is ranked by cosine similarity between the query embedding and the `instruction` column embedding. **A SOP that scores well is one whose text is semantically close to the queries an agent would naturally generate.** Everything else follows from this constraint.

---

### Writing Pattern: Lead With the Trigger, Embed the Rule

The most retrievable sentence structure is:

> **When [trigger context], always [rule]. [Single sentence of rationale].**

Example — high retrieval quality:

> When adding a new primitive to OpenHiveOS, always place it in `src/primitives/` and register it as an MCP tool in `src/index.ts`. Primitives must never import from `src/utilities/` — use the ESLint `no-restricted-imports` rule to enforce this boundary at compile time.

Example — low retrieval quality (human-document style):

> **Section 1: Overview of the Primitive Architecture**  
> The OpenHiveOS codebase is organised into two tiers. The first tier, located in `src/primitives/`, contains...

The second form embeds as a heading and a category introduction. It does not embed as an answer to "how do I add a new primitive?" — which is the query that will actually arrive.

**Rule for every SOP sentence:** If a sentence does not contain either the trigger condition, the rule, or the rationale — cut it.

---

### Voice: First-Person Imperative

Use **first-person imperative** ("When registering a tool, always use `registerTool()`") rather than third-person declarative ("The team uses `registerTool()` for all tool registrations").

The rationale is mathematical: agents generate queries from their own action context, and those queries are first-person. The cosine similarity between "how do I register a tool" and "when registering a tool, always use registerTool()" is higher than the similarity to "the team uses registerTool()". The framing is not stylistic — it is semantic alignment by design.

Avoid passive voice entirely. "The token must be stored in the vault" is retrievable. "Tokens should be stored securely in approved vault systems where applicable" is not — the hedge words dilute the semantic mass around the actual rule.

---

### Atomic vs. Comprehensive: The Dilution Problem

**Shorter and more atomic wins.** Target 150–400 words per file. One concept, one decision, one authoring context per SOP.

The reason is cosine dilution. A 1,200-word document covering "database migrations AND schema conventions AND rollback procedures" will embed as a diffuse vector sitting in the centre of all three concepts. It will rank mediocre for every query — never high for any single one. Three 300-word atomic SOPs will each rank near the top for their respective query.

The category subdirectory structure reinforces this: when `search_sops` returns `LIMIT 3` results from the `Coding` category, those three results should be three *distinct, actionable instructions*, not three excerpts from the same conceptual blob.

Practical test: if you can describe a SOP with "it covers X *and* Y", split it.

---

### Code Examples: Use Them, Don't Rely on Them

Include **one minimal inline code example per SOP**. Do not write SOPs that are predominantly code.

The reason: embedding models convert code tokens similarly to their plain-text equivalents, but the *framing sentences around the code* carry more semantic weight than the code itself in cosine retrieval. A SOP that is 80% a code block embeds as code — not as guidance. An agent querying "what's the convention for tool registration?" needs the guidance layer to be the dominant semantic signal.

Use inline formatting (backtick-wrapped names) rather than fenced code blocks when the example is a single function call or a file path. Reserve fenced blocks for examples that require context to be readable (multi-line config, migration SQL). Keep fenced examples under 15 lines.

---

### Summary: The Four Rules

| Rule | What to Do |
|---|---|
| **Lead with the trigger** | Start the SOP body with "When [situation]..." |
| **First-person imperative** | "always use X" not "the team uses X" |
| **One concept per file** | If it covers X *and* Y, split it |
| **Frame before code** | Plain English rule before code example, always |

---

## 2. SOP File Frontmatter Specification

The ingest runner derives `category` from the directory name (`seeds/sops/coding/` → `category = 'Coding'`). The `source_path` is used as the upsert key — the UNIQUE index on `sops.source_path` ensures idempotent re-import on every boot. Everything the ingest runner cannot derive from the filesystem must come from frontmatter.

### Required Fields

```yaml
---
title: "Short, searchable title — use words an agent would search for"
version: "1.0.0"
scope: "all"         # or agent slug: "murphy", "clarence", "cooper", etc.
status: "active"     # active | deprecated | draft
---
```

**`title`** — Human-readable. Used by operators browsing `seeds/sops/` and in ingest logs. The ingest runner does not embed the title separately — it is part of the body content the `instruction` column stores. Write the title as a plain phrase, not a sentence. Searchable nouns first: "Primitive Boundary Enforcement" not "How We Enforce Primitive Boundaries".

**`version`** — Semver. `1.0.0` for new SOPs. Increment the minor version for content changes that do not change the decision (1.1.0). Increment the major version for reversals or supersessions (2.0.0). The version is stored in frontmatter and in git history — it is not persisted to the `sops` table in v0.1.

**`scope`** — Maps to the `agent` column on the `sops` table. `"all"` → agent column is `NULL` (squad-wide SOP). An agent slug ("murphy", "clarence") → that slug is written to the `agent` column. An agent querying `search_sops` without a scoping filter receives both squad-wide and agent-specific SOPs. Future: the ingest runner may support a comma-separated list for multi-agent scope.

**`status`** — The ingest runner **skips** `draft` SOPs entirely. It **upserts** `active` SOPs normally. It **marks** `deprecated` SOPs: the existing row remains in the database (remains searchable) but the ingest runner does not re-embed it on future boots. This means deprecated SOPs fade gracefully as their embedding drifts from current queries — they are not hard-deleted.

### Optional Fields

```yaml
replaces: "seeds/sops/coding/old-primitive-boundary.md"
review_date: "2026-11-20"
tags: ["mcp", "primitives", "import-boundary"]
```

**`replaces`** — The `source_path` of the SOP this one supersedes. The ingest runner uses this to set `status: deprecated` on the referenced file's row automatically. This is the only automated supersession mechanism in v0.1.

**`review_date`** — ISO 8601. Not enforced by the system in v0.1 — present for operator process governance. Clarence tracks this manually. Target: every SOP reviewed every 90 days.

**`tags`** — Array of strings. Not persisted to the `sops` table in v0.1. Present for future filtering capabilities and for operator use when browsing the repo.

### What the Ingest Runner Does With the File

After stripping frontmatter, the runner writes the full markdown body — headings, prose, and inline code — to the `instruction` column. The entire body is embedded as a single vector. This is why the authoring rules in Section 1 matter: the `instruction` content is both what the embedding model reads and what the agent reads on retrieval.

Do not include a top-level `# Heading` that repeats the title. The title is in frontmatter. The body should open directly with the first substantive sentence — the trigger condition.

---

## 3. Minimum Viable SOP Set for v0.1

One SOP per category. These are the six rows in the `sops` table that make `search_sops` demonstrably functional on first boot. Each is genuinely useful to a self-hosting Operator — not placeholder content.

---

### Coding — `seeds/sops/coding/primitive-boundary-enforcement.md`

**Title:** Primitive Boundary Enforcement

**Covers:** When extending OpenHiveOS with a new primitive, always place it in `src/primitives/` and never import from `src/utilities/` inside that directory. The ESLint `no-restricted-imports` rule enforces this at compile time — a PR that triggers the rule must not merge. If a utility is needed by a primitive, promote it to a shared primitive instead.

**Why this one:** It's the first architectural rule a contributor hits. Any agent asked to add a capability will retrieve this before touching the codebase.

---

### DevOps — `seeds/sops/devops/local-dev-stack-startup.md`

**Title:** Local Dev Stack Startup

**Covers:** How to start the OpenHiveOS stack locally using Docker Compose. Required environment variables (`DATABASE_URL`, `GEMINI_API_KEY`, `AGENT_TOKEN`), the correct startup sequence (Postgres before the MCP server), how to confirm the health endpoint is responding at `HEALTH_PORT`, and the `stdin_open: true` requirement for MCP stdio transport.

**Why this one:** The most common operator action is "get it running." This SOP is retrieved on day one by any agent helping an operator onboard.

---

### QA — `seeds/sops/qa/pre-merge-security-checklist.md`

**Title:** Pre-Merge Security Checklist

**Covers:** The minimum security checks that must pass before any code merges to main: SEC-14 branch protection is active, SEC-15 secrets scanning has run clean, SEC-16 constant-time comparison is confirmed for any auth code path, SEC-17 CVE scan is clean for the affected primitive. No merge proceeds without Locksmith sign-off on SEC-16 changes.

**Why this one:** The security gate conditions are the most consequential repeatable process in the repo. Any agent assisting with a PR will retrieve this.

---

### Architecture — `seeds/sops/architecture/adr-filing-standard.md`

**Title:** ADR Filing Standard

**Covers:** When to file a new ADR (any decision that constrains future contributors, changes a transport, auth model, data model, or inter-tier boundary), the difference between Full format (contested decisions, rejected alternatives documented) and Quick format (uncontested, low-risk decisions), who must approve (Elizabeth for all, domain lead as second), and where the file lives (`docs/ARCH-NNN-kebab-title.md`).

**Why this one:** Any agent asked to document an architectural decision will retrieve this. It prevents informal decisions being made without a record.

---

### Documentation — `seeds/sops/documentation/sprint-close-documentation-gate.md`

**Title:** Sprint Close Documentation Gate

**Covers:** A sprint task is not "Done" until its documentation is complete. For any new primitive: the 00 Overview section is current, the API surface is documented in plain English, and any architectural decision has an ADR filed. For any security change: the SEC condition number is recorded in the relevant SOP or ADR. Clarence signs off on documentation completeness before Elizabeth closes the sprint.

**Why this one:** The Definition of Done documentation requirement is the most commonly skipped process step on any team. Making it a retrievable SOP forces it into agent awareness during sprint close.

---

### Decision — `seeds/sops/decision/superseding-a-prior-decision.md`

**Title:** Superseding a Prior Decision

**Covers:** When a new decision reverses or replaces a prior ADR or SOP, the new document must explicitly name what it supersedes. For ADRs: include `supersedes: ARCH-NNN` in frontmatter and a "Supersedes" section in the body. For SOPs: set the `replaces` frontmatter field to the old file's `source_path`, increment the major version, and set the old SOP's `status` to `deprecated`. No decision is silently overridden — the trail must be complete and bidirectional.

**Why this one:** Decision archaeology is the highest-value documentation activity. When an agent asks "why did we change from X to Y?", the answer must be findable. This SOP is the process that guarantees it is.

---

## 4. Operator Onboarding SOP UX: The Discovery Path

Operators who self-host OpenHiveOS are technical. They read READMEs. They explore repos. The discovery path should meet them where they already are — it must not require a separate tutorial site, a CLI wizard, or a registration flow.

### Three Touchpoints, in Discovery Order

**Touchpoint 1 — Root `README.md` (mandatory for v0.1)**

The README quickstart section must include a subsection titled **"Customising your Squad's SOPs"**. It should be four to six sentences: SOPs live in `seeds/sops/` organised by category subdirectory; the ingest runner loads them at boot; to add a SOP, create a `.md` file in the relevant directory following the frontmatter spec; see `seeds/sops/README.md` for authoring guidelines. This is where most operators will first encounter the mechanism — not in an ADR.

**Touchpoint 2 — `seeds/sops/README.md` (ships with the repo)**

This file is the operator's authoring companion. It should cover: the directory structure and category mapping, the complete frontmatter spec (copy-pasteable example), the four authoring rules from Section 1 of this document, and one worked example showing a before/after rewrite from human-style to agentic-style. This file is authored by Clarence and is part of the v0.1 Sprint 3 deliverable.

**Touchpoint 3 — Boot-time ingest log**

When the ingest runner completes its first run, it should emit a log line at `INFO` level:

```
[sops] Loaded 6 seed SOPs across 6 categories. Add custom SOPs to seeds/sops/ — see seeds/sops/README.md.
```

This confirms to the operator that the mechanism is working and tells them where to go. It costs one `console.log` line in the ingest runner. It is the difference between an operator knowing the feature exists and an operator discovering it six weeks later by reading the source.

### What to Avoid

Do not build a CLI wizard, an interactive prompt, or a web-based SOP editor for v0.1. The operator audience at this stage is developers who are configuring the system for their team. They will write markdown files. They do not need a wizard — they need a clear spec and a working example.

---

## 5. SOP Lifecycle: Updates, Approval, and Embedding Replacement

### How a SOP Gets Updated

An operator or agent edits the `.md` file in `seeds/sops/`. The `version` frontmatter field increments. On next boot (or manual ingest runner invocation), the runner reads the file, computes a new embedding via Gemini, and upserts the row using `source_path` as the key. The `instruction` column and the `embedding` column are both replaced in a single UPDATE. The `updated_at` trigger fires automatically.

**The old embedding is silently replaced.** This is correct and intentional. The embedding is a derived artefact — it is computed from the text. When the text changes, the embedding must change. Preserving the old embedding would mean agents retrieve stale guidance. There is no value in retaining a vector that no longer matches the text it purports to represent.

The audit trail for what the SOP used to say is git history. The `source_path` UNIQUE index guarantees exactly one row per file. Version archaeology is a git operation, not a database operation.

### Approval Gate in v0.1

In v0.1, there is no in-process ratification gate for SOP changes. The approval mechanism is:

1. The SOP change is committed to a branch.
2. The PR is reviewed by the Documentation lead (Clarence) and the relevant domain lead.
3. The PR merges to main.
4. The ingest runner picks up the change on next boot.

This is sufficient for v0.1. The git PR is the approval record. The `version` field in frontmatter is the human-readable change signal.

**Deferred to Sprint 3+:** A `ratify_sop` primitive — analogous to the existing `ratify_thought` primitive — that gates a SOP going `active` behind a second-agent ratification call. Under this model, a new SOP lands with `status: draft`, is not ingested, and only transitions to `active` after a ratification event is recorded. This introduces a proper approval workflow without blocking v0.1 delivery.

### What Happens to Deprecated SOPs

When a SOP is superseded, the old file's `status` is set to `deprecated`. The ingest runner does not re-embed it on future boots. The row remains in the `sops` table and remains searchable via cosine similarity — it does not vanish.

This is intentional. A deprecated SOP may still contain the best available answer to a query about the old system's behaviour. Agents retrieving it will see the `status: deprecated` signal in the `instruction` text (the frontmatter is included in the body the ingest runner writes to `instruction`) and can adjust accordingly. Hard-deletion removes institutional memory. Deprecation preserves it with a clear warning.

The one exception: if a deprecated SOP contains a security rule that is now actively wrong (e.g., it instructs agents to use a pattern that has been found to be insecure), the Locksmith should flag it for hard-deletion from the database via a manual `DELETE FROM sops WHERE source_path = '...'` with a corresponding ADR note.

### SOP Review Cadence

Every SOP in `seeds/sops/` has an optional `review_date` field. The recommended cadence is 90 days for Coding and Architecture SOPs (they track a fast-moving codebase), 180 days for DevOps and QA SOPs, and annually for Documentation and Decision SOPs. 

In v0.1, review cadence is enforced by process, not by tooling. Clarence maintains a review schedule. Sprint 4+ consideration: a boot-time warning when the ingest runner detects SOPs whose `review_date` has passed.

---

## Filing Note

This analysis was produced by Clarence on 2026-05-20 as a contribution to ARCH-009. Elizabeth should treat Sections 2 and 3 as draft content ready for direct incorporation. Sections 1, 4, and 5 are analytical input — compress to decision record format as needed for the final ADR.

The six minimum viable SOPs in Section 3 are a Sprint 3 delivery item. The authoring of those six files is Clarence's responsibility. The `seeds/sops/README.md` is also a Clarence Sprint 3 delivery.
