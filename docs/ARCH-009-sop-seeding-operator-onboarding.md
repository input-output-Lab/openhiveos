---
title: "ARCH-009 — SOP Seeding, Operator Onboarding, and Agentic-First Orientation"
date: 2026-05-20
status: Proposed — Deferred to Onboarding Sprint
decision_owner: Silas
approved_by: Elizabeth
filed_by: Clarence
authored_by: Elizabeth, Silas, Clarence, Murphy
adr: ARCH-009
related: ARCH-003, ARCH-005, ARCH-006, ARCH-008
tags:
  - type/adr
  - project/openhiveos
  - domain/architecture
  - domain/backend
  - domain/devops
  - domain/documentation
review_date: 2026-08-20
---

# ARCH-009 — SOP Seeding, Operator Onboarding, and Agentic-First Orientation

**Date:** 2026-05-20  
**Project:** OpenHiveOS  
**Status:** Proposed — Deferred to Onboarding Sprint  
**Decision Owner:** Silas  
**Approved By:** Elizabeth  
**Filed By:** Clarence  
**Authored By:** Elizabeth, Silas, Clarence, Murphy  
**Related:** ARCH-003, ARCH-005, ARCH-006, ARCH-008

---

## Context

`search_sops` is an OS Primitive — stable and deprecation-protected. It performs a pgvector cosine similarity search over the `sops` table to retrieve the most semantically relevant Standard Operating Procedure for a given query. On a Self-Hosted Deployment (ARCH-006), the Operator starts with a completely empty `sops` table. An empty table means `search_sops` returns nothing. Agents operating without SOPs are agents operating without the institutional "Way" — they will function, but they will not operate with the disciplined, consistent behaviour that makes an agent squad trustworthy.

This is not a UX gap. It is a product integrity gap. The IO Labs internal Squad works because SOPs were populated before agents were given access. A Self-Hosted Operator does not get that foundation automatically under the current architecture.

This ADR answers three questions:

1. **How do SOPs get into the database on first boot?** (Seeding mechanism)
2. **How does an Operator add their own SOPs, and how do they learn to do so?** (Operator onboarding)
3. **How should SOPs be written so that agents can actually retrieve them?** (Agentic-first orientation standard)

Implementation of all decisions in this ADR is deferred to the Onboarding Sprint. The ADR is filed now because the decisions constrain schema, query contracts, and directory conventions that cannot be changed after seeding code ships without a breaking migration.

---

## Decision

### Decision 1 — Seeding Mechanism: `.md` files in `seeds/sops/`, ingested at boot

SOP entries are authorised by `.md` files committed to the `seeds/sops/` directory in the OpenHiveOS repository. An ingest runner reads these files at each boot, computes a SHA-256 content hash per file, and upserts rows into the `sops` table keyed on `source_path`. If the content hash is unchanged, the row is not modified and no embedding API call is made. If the content has changed, the runner re-embeds and updates the row. If no row exists for the path, a new row is inserted.

The ingest runner runs as a boot step between `checkFingerprint()` and `resolveIdentity()` in `src/index.ts`.

**Vote:** 4/4 (Elizabeth, Silas, Clarence, Murphy).

### Decision 2 — Directory Structure and Namespace Convention

The `seeds/sops/` tree is split into two namespace directories:

```
seeds/sops/
  core/           ← shipped by IO Labs; source_namespace = 'core'
    coding/
    devops/
    qa/
    architecture/
    documentation/
    decision/
  operator/       ← added by the Operator; source_namespace = 'operator'
    coding/
    devops/
    (any category subdirectory)
  README.md       ← operator discovery touchpoint; ships with repo
```

The `source_namespace` value (`core` or `operator`) is assigned exclusively by the ingest runner based on directory path. No API input, CLI flag, or frontmatter field can override this assignment. An Operator cannot claim `source_namespace = 'core'` through any mechanism.

The `operator/` directory ships empty (except a `.gitkeep`). Operators add `.md` files to it. Any `.md` file in the tree — at any depth — is ingested. There is no hardcoded file list.

**Vote:** 4/4.

### Decision 3 — Category Constraint

Operator SOPs are constrained to the existing six-value category enum: `Coding`, `DevOps`, `QA`, `Architecture`, `Documentation`, `Decision`. A new category requires a schema migration and a new ADR. Free-text or custom categories are not permitted. The ingest runner enforces this by mapping the subdirectory name to the enum; any `.md` file in an unrecognised subdirectory is skipped with a structured warning.

**Vote:** 4/4.

### Decision 4 — Schema Delta (required before implementation)

The Onboarding Sprint migration must add the following columns to the `sops` table before the ingest runner is built:

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `content_hash` | `TEXT` | `NULL` (backfilled at first ingest) | Idempotency key — detects file changes without re-reading all rows |
| `source_namespace` | `TEXT NOT NULL` | `'core'` | Namespace provenance. `CHECK (source_namespace IN ('core', 'operator'))` |

The unique index must be on `source_path`. A secondary index on `content_hash` is recommended for upgrade diffing queries.

No other schema changes are required by this ADR.

**Vote:** 4/4.

### Decision 5 — `search_sops` Query Contract is Frozen

`search_sops` is an OS Primitive. Its query contract — accepting `query`, `category` (optional), and `limit` — is frozen. No `source_namespace` filter parameter will be added to `search_sops`. Both namespaces participate in the same HNSW index and the same cosine similarity query. The most semantically relevant SOP wins regardless of namespace. Namespace filtering is a Coordination Utilities-tier concern if it is ever required; it does not belong in the Primitive.

The `agent` column on `sops` is attribution, not access control. Any agent may retrieve any SOP via `search_sops` regardless of the `agent` column value.

**Vote:** 4/4.

### Decision 6 — Upgrade Safety: Auto-Update with Dry-Run Mode

When an Operator upgrades OpenHiveOS (`git pull && docker compose up`), the ingest runner automatically detects content hash changes in `seeds/sops/core/` and re-embeds updated core SOP files. This is the correct default behaviour. An Operator who runs `git pull` has accepted the new version. Silent staleness is a worse failure mode than a behavioural update.

Transparency is provided by a `--dry-run` mode in the ingest runner:

```
docker compose run openhive-mcp npm run seed:sops -- --dry-run
```

Output: a structured table of `[source_path] [namespace] [status: NEW | UPDATED | UNCHANGED]` with no writes. Operators can inspect what will change before committing. The dry-run output should also be emitted at INFO level in the standard boot log.

**Vote:** 4/4.

### Decision 7 — Operator SOP Shadow Warning

After embedding an operator SOP, the ingest runner runs a similarity check against all core SOPs in the same category. If cosine similarity meets or exceeds 0.92 against any core SOP row, the runner emits a structured warning to stdout:

```
WARN [sop-ingest]: operator SOP [source_path] semantically shadows core SOP
      [id: N, source_path: ...] (cosine: 0.94). Both will be retrieved.
      Review intentional? See seeds/sops/README.md for override guidance.
```

The ingest proceeds regardless. This warning is visible in Docker logs. The exact threshold (0.92) is empirically tunable during the implementation sprint without a new ADR.

**Vote:** 4/4.

### Decision 8 — Embedding API Unavailability at Boot

If the Gemini embedding API is unavailable at boot time:

- **If the `sops` table is non-empty** (previous ingest succeeded): warn-and-continue. Agents operate on the existing SOP set. A boot log message flags that the SOP seed step was skipped.
- **If the `sops` table is empty** (first boot, no prior ingest): fail fast with a non-zero exit and a clear error message. An empty `sops` table on a fresh deployment is a product integrity failure — the Squad must not serve traffic without its SOP foundation.

**Vote:** 4/4.

### Decision 9 — Agentic-First SOP Authoring Standard

All SOPs committed to `seeds/sops/` — whether core or operator — must follow the agentic-first authoring standard:

**Rule 1 — Lead with the trigger.** Open the body with "When [situation]..." The trigger sentence is the primary semantic signal for retrieval. An agent querying "how do I register a new MCP tool" must match this sentence before reading the rest.

**Rule 2 — First-person imperative voice.** Write "Always use `registerTool()`" not "The team uses `registerTool()`." The query voice and the SOP voice must match. Third-person narration distances the SOP from the agent's perspective and reduces cosine similarity to first-person agent queries.

**Rule 3 — One concept per file, 150–400 words.** Multi-concept documents produce mediocre cosine scores for every query rather than high scores for one. A SOP that covers five things is five SOPs that aren't getting retrieved.

**Rule 4 — Frame in plain language before any code.** The plain-English rule carries more semantic weight than the code block. State the rule first. One minimal code example may follow. Never lead with a code block.

**Frontmatter spec:**

```yaml
---
title: "Concise, action-oriented title"   # required
version: "1.0.0"                          # required; semver
scope: "all"                              # required; "all" or agent slug
status: "active"                          # required; draft | active | deprecated
                                          # status: draft → skipped by ingest runner
replaces: ""                              # optional; source_path of superseded SOP
review_date: "YYYY-MM-DD"                 # optional
tags: []                                  # optional
---
```

The `replaces` field, when populated, triggers the ingest runner to set `status = 'deprecated'` on the superseded SOP row. The deprecated row remains in the DB and remains searchable — it is not deleted. Hard-deletion requires a Locksmith flag for security-wrong content only.

**Vote:** 4/4.

### Decision 10 — Minimum Viable SOP Set for v0.1

OpenHiveOS must ship with at least one SOP per category so `search_sops` is demonstrably functional on first boot. Clarence owns authoring. The following six SOPs are mandated for the Onboarding Sprint:

| Category | File | Covers |
|---|---|---|
| `Coding` | `core/coding/primitive-boundary-enforcement.md` | All OS Primitive tools live in `src/primitives/`. The ESLint no-restricted-imports rule blocks `src/utilities/**` from importing `src/primitives/**`. Never bypass this boundary. |
| `DevOps` | `core/devops/local-dev-stack-startup.md` | Starting the OpenHiveOS local dev stack: Docker Compose command, required env vars, how to verify the health endpoint is green before connecting an agent. |
| `QA` | `core/qa/pre-merge-security-checklist.md` | SEC-14 through SEC-20 gate conditions from ARCH-007. Every PR touching auth, tokens, or the agents table must pass all conditions before merge. |
| `Architecture` | `core/architecture/adr-filing-standard.md` | When to file an ADR, the Full vs. Quick format, required approval chain (decision_owner + Elizabeth), and the `docs/` filing location. |
| `Documentation` | `core/documentation/sprint-close-documentation-gate.md` | Definition of Done documentation requirement: every sprint-close PR must include updated docs. No docs = not Done. |
| `Decision` | `core/decision/superseding-a-prior-decision.md` | How to supersede a prior decision: use the `replaces` frontmatter field, update the original ARCH's status to Deprecated, add a body reference. Bidirectional supersession trail is mandatory. |

### Decision 11 — Operator Discovery Path

Operators learn that they can add their own SOPs through three touchpoints, in discovery order:

1. **README quickstart** (`README.md` at repo root): A "Customising your Squad SOPs" section links to `seeds/sops/README.md`.
2. **`seeds/sops/README.md`** (ships with repo): Plain-language guide explaining the `operator/` directory, the frontmatter spec, the six-category constraint, and the shadow warning. This is the primary operator documentation artifact for SOP customisation.
3. **Boot log line**: At the close of a successful ingest run, the runner emits: `[sop-ingest] N core SOPs, M operator SOPs loaded. Add your own to seeds/sops/operator/ — see seeds/sops/README.md`. This is the zero-friction discovery touchpoint for Operators who skipped the README.

No CLI wizard or interactive prompt in v0.1. Discovery is documentation-first.

---

## Rationale

**Why `.md` files, not SQL seed data?** SQL seed rows cannot carry pre-computed embeddings — embeddings require a live Gemini API call at insert time. `.md` files are the natural authoring format for SOPs, are reviewable in PRs, forkable by Operators, and are the source of truth. The database is a projection.

**Why `source_namespace TEXT` rather than `is_core BOOLEAN`?** A boolean is architecturally insufficient. `source_namespace` encodes provenance, enables unambiguous category-and-namespace queries, and opens the namespace dimension (a future `certified-partner` tier) without premature abstraction. Two values locked by CHECK — a new namespace requires a migration and an ADR. That is the correct governance gate.

**Why is `search_sops` contract frozen?** It is an OS Primitive — stable and deprecation-protected (ARCH-003, ARCH-005). Adding a `source_namespace` parameter would be a breaking change to the primitive contract and would corrupt the relevance signal. The value of the primitive is that agents ask a question and the most relevant SOP wins — full stop.

**Why are operator SOPs not silently blocked when they shadow a core SOP?** The self-hosted model (ARCH-006) means the Operator owns their deployment. A school deploying OpenHiveOS may intentionally replace IO Labs guidance with domain-specific process. That is the product promise. Silent blocking is paternalistic. Structured warnings give visibility without removing Operator sovereignty.

**Why first-person imperative voice for SOPs?** The agent's query is first-person: "how do I register a tool," "what should I do when..." The cosine similarity between the query embedding and the SOP embedding is highest when both are in the same voice. Third-person narration creates a systematic retrieval gap. This is not a style preference — it is a retrieval quality constraint.

---

## Consequences

### Immediate consequences (locked by this ADR, no implementation yet)

1. **No implementation before the Onboarding Sprint.** No ingest runner code, no `seeds/sops/` directory, no schema migration may be committed until the Onboarding Sprint is formally opened. This ADR is the gate.

2. **The Onboarding Sprint migration must be the first PR.** `content_hash` and `source_namespace` must be in the database before the ingest runner is built. Migration number is reserved as `002_sop_namespacing.sql`.

3. **The `seeds/sops/core/` and `seeds/sops/operator/` directory conventions are locked.** They are canonical paths referenced by documentation, scripts, and the upgrade runbook. Changing them after the Onboarding Sprint ships is a breaking change to all Operator deployments.

4. **The six-category enum is locked.** `Coding`, `DevOps`, `QA`, `Architecture`, `Documentation`, `Decision`. Any new category requires a migration and a new ADR.

5. **The agentic-first authoring standard (Decision 9) applies immediately** to all SOPs authored in the IO Labs Obsidian vault. Existing vault SOPs that do not comply must be refactored by Clarence before they are committed to `seeds/sops/core/`.

6. **`docs/glossary.md` must be updated** to add entries for: `seeds/sops/`, `core SOP`, `operator SOP`, `source_namespace`, `ingest runner`, `agentic-first`. Clarence, Onboarding Sprint Day 1.

### Deferred to Onboarding Sprint implementation

7. Exact cosine similarity threshold for shadow warnings (0.92 is the working assumption — empirically tunable).
8. Dry-run mode CLI interface (`--dry-run` flag, table output format).
9. Full ingest runner implementation (`scripts/ingest-sops.ts` or `src/sops/ingest.ts` — Murphy to decide at implementation time).
10. Whether the ingest runner is called from `src/index.ts` directly or as a Docker Compose `command` pre-hook.
11. Error handling detail for the Gemini API unavailability at non-first-boot.
12. Operator SOP ratification gate (`ratify_sop` primitive) — deferred to Sprint 3+ if required.

---

## Security Notes

**Namespace integrity:** `source_namespace` is assigned exclusively by the ingest runner based on directory path. No user input, API call, or frontmatter field can set `source_namespace = 'core'`. This is an application-layer enforcement constraint — not a database constraint. The ingest runner implementation must never read `source_namespace` from the `.md` frontmatter.

**SOP injection via file system:** An attacker with write access to the `seeds/sops/operator/` directory could inject a SOP designed to manipulate agent behaviour. This attack surface is bounded by the Operator's infrastructure access controls — it is not an OpenHiveOS application vulnerability. The structured warning for semantic shadow detection partially mitigates this by making unexpected SOP additions visible at boot.

**Embedding API key exposure:** The ingest runner calls the Gemini embedding API. The API key (`GEMINI_API_KEY`) must not be logged at any verbosity level during the ingest step. This is an existing constraint from the current codebase — the ingest runner inherits it.

*Security review by Locksmith to be completed before the Onboarding Sprint opens. This section is a preliminary assessment only.*

---

## Six-Vertical Applicability

| Vertical | ARCH-009 Impact |
|---|---|
| Marketing Agency | Operator adds client-specific SOPs to `seeds/sops/operator/` per client Squad Instance |
| Insurance Agency | Core SOPs must meet compliance language standards; Operator may override with regulator-approved language |
| Software Factory (IO Labs) | Primary beneficiary of the minimum viable SOP set; internal Squad runs on core SOPs from Day 1 |
| Finance Squad (IO Labs) | Finance-specific SOPs (accounting process, tax procedures) go in `seeds/sops/operator/` |
| Internal Marketing Team | SOPs for content workflows, UTM governance added to `seeds/sops/operator/` |
| School | Student data handling SOPs must be Operator-authored; no IO Labs core SOP covers FERPA/GDPR-K specifics |

---

*Filed by Clarence. Authored collaboratively by Elizabeth (synthesis), Silas (architecture), Clarence (documentation standards), Murphy (implementation design). Implementation gates the Onboarding Sprint — no code before that sprint opens.*
