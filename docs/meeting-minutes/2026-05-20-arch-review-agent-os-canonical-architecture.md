---
title: "ARCH-005 Architecture Review — Agent OS Canonical Architecture"
date: 2026-05-20
type: meeting-minutes
status: filed
facilitator: Elizabeth
primary_voice: Silas
participants:
  - Silas
  - Murphy
  - Rocket
  - Cooper
  - Clarence
  - Nova
  - Locksmith
  - Elizabeth
tags:
  - type/meeting-minutes
  - project/opensquad
  - domain/architecture
  - domain/backend
  - domain/devops
  - domain/security
related:
  - "[[ARCH-005 — Agent OS Canonical Architecture]]"
  - "[[ARCH-003 — Agent OS Two-Tier Model]]"
  - "[[ARCH-004 — Agent OS Consolidation]]"
---

# ARCH-005 Architecture Review — Agent OS Canonical Architecture
**Date:** 2026-05-20  
**Facilitator:** Elizabeth  
**Primary Voice:** Silas  
**Filed by:** Clarence

---

## Trigger

Following ARCH-004 (filed earlier today), the Founder stated:

> "The Agent OS should be an integrated unit only with opensquad concerns — this is clean and the correct option. This leaves openBridge, nova-telegram-bridge, clickup-mcp-server and any other project/system to be considered an integration which empowers opensquad. But where I think we are being too worried about is about sprints and lifecycles. We should consider all existing components as the base but we can remove the shackles of being bound by what exists when we can create a new project where we can even challenge the tech-stack implemented currently."

Two signals in that statement. First: a cleaner OS boundary than ARCH-004 named (OS = opensquad only; everything else is integrations). Second: license to think without constraint — including questioning the current tech stack.

---

## Step 1 — Elizabeth's Problem Framing

**Problem:** ARCH-003 designated OpenSquad as the Agent OS. ARCH-004 made consolidation decisions constrained by what already exists. The Founder has now named the correct boundary: the Agent OS is OpenSquad concerns only. This creates a second question: is the current tech stack the right foundation for a deliberately designed Agent OS, or is it the foundation for a prototype that became production before anyone asked that question?

**Business constraints:** Production cannot go dark. Client delivery is in-flight. Squad capacity is constrained. Cost discipline is a real constraint.

**Technical constraints:** MCP protocol is fixed (agents talk MCP). PostgreSQL 17 + pgvector is the live data store (27 migrations in production). ARCH-001 bearer auth is live. ARCH-004 SEC-1–8 are open obligations.

**Out of scope:** Integration design for openBridge/nova-telegram-bridge/clickup-mcp-server. Individual MCP tool changes. Client project architecture. Migration execution.

**Prior context:** ARCH-003 (two-tier model, 3 open conditions), ARCH-004 (1A/3A/2A decisions, all gated), MemPalace Phase 1–4 in flight.

---

## Step 2 — Silas's Honest Current State Assessment

Before proposing options, Silas named the system for what it is:

> "The `opensquad-mcp-server` is a single-process Node.js/TypeScript/Express server running 22 MCP tools, two background workers, a hybrid BM25+pgvector search engine, and bearer token auth — all in one PM2-managed process. Express is not really doing anything. It is glue between the MCP SDK's SSE/StreamableHTTP transports and the tool handlers. The ARCH-003 two-tier model exists in prose but not in code. The boundary exists in documentation. It does not enforce itself."

---

## Step 3 — Three Options Proposed

### Option 1 — Surgical Refinement: Evolve the TypeScript Monolith
Keep Node.js/TypeScript/PostgreSQL/PM2. Implement the ARCH-003 two-tier model as enforced module boundaries: `src/primitives/` and `src/utilities/` with ESLint import boundary rules. One process, real internal boundaries. No dark period.
- **Effort:** Low
- **ARCH-003 enforcement:** Convention + lint (not process isolation)
- **Migration:** None

### Option 2 — Python Greenfield (Full Rewrite)
Python/FastAPI/SQLAlchemy 2.0 async/Alembic/MCP Python SDK. Same PostgreSQL DB. ARCH-001 reimplemented as FastAPI middleware. Python ML/embedding ecosystem native (sentence-transformers, numpy, pgvector-python). Aligns with io_sis stack.
- **Effort:** High (4–6 dev-sprints for parity)
- **ARCH-003 enforcement:** Convention + FastAPI routers (not process boundary)
- **Migration:** Full rewrite, dark period unless run parallel

### Option 3 — Two-Service MCP Architecture
Two independent MCP servers — one per ARCH-003 tier. OS Primitives service (memory, identity, SOPs, registry, token lifecycle) and Coordination Utilities service (tasks, crons, projects, cost tracking). Both TypeScript. Integrations connect ONLY to Utilities — Primitives is architecturally inaccessible. Independent deployability per tier.
- **Effort:** Medium (2–3 dev-sprints + test coverage)
- **ARCH-003 enforcement:** Process boundary (strongest — the only option that enforces without convention)
- **Migration:** Incremental from monolith, no dark period

### Silas's Position
Option 2 is the right long-term answer and the wrong near-term answer. Option 1 is the path of least regret in the short term. Option 3 is the honest implementation of ARCH-003.

**Silas's recommendation:** Option 1 immediately. Option 3 as declared target. Option 2 as a future decision gate triggered by MemPalace Phase 3/4 capability ceiling.

---

## Step 4 — Cross-Seat Review

### Murphy (Backend)

**Critical finding:** Option 2 is a clean no — but not for the reason expected. The TypeScript embedding layer already calls the Gemini API. There are no local models. Python's ML ecosystem advantage only materialises if MemPalace Phase 3/4 requires a cross-encoder reranker. That is the correct trigger for revisiting the language — not this review.

**Option 3 risk challenge:** Silas calls it "Medium." Murphy challenges this. "Medium" does not account for partial failure state complexity across multi-MCP clients (nova-telegram-bridge, copilot-telegram-bridge use `Promise.allSettled`). Graceful degradation under a two-MCP topology must be explicitly designed and tested — it is not in the estimate.

**Cleanup flag:** Dual `.ts`/`.js` files in `src/mcp/tools/` are committed build artifacts. Source of truth confusion. Must be cleaned up during the next restructure sprint regardless of option chosen.

**Tool classification work required:** Before any decomposition, Murphy must classify all 22 tools by tier. Approximate split: ~10 Primitives (memory/search, identity/token, SOPs, agent registry), ~12 Utilities (tasks, crons, projects, cost, sprint). Boundary ambiguities: `store_thought` (Primitive? — it writes to OS state), `query_tasks` with `agent_name` (Utility that reads from agent identity — a Primitive concept).

### Rocket (Frontend)

**All three options:** squad-dashboard is unaffected regardless of choice. It talks to squad-api only. squad-api talks to PostgreSQL. The MCP layer is invisible to the frontend.

**Option 2 critical branch:** If squad-api also migrates to Python/FastAPI, the ARCH-004 3A implementation contract is **entirely invalidated**. Every 3A primitive names an Express/Node.js API (`express.static()`, Helmet CSP nonce, Express SPA fallback regex, CORS startup validation). FastAPI serves static files differently. SPA fallback requires a custom exception handler. CSP nonce has no FastAPI native equivalent. The 3A contract must be re-authored before any FastAPI squad-api implementation begins. June 27 milestone A is at risk under this scenario.

**Option 2 MCP-only (squad-api stays TypeScript):** Invisible to frontend. No conflict with milestone A.

**Option 3:** squad-api becomes the single REST facade abstracting the Primitives/Utilities MCP split. Dashboard never sees the two-server topology. squad-api should read from PostgreSQL directly — not from MCP server HTTP APIs — to avoid introducing two upstream HTTP failure modes into the dashboard's loading/error model.

**Rocket's recommendation:** Option 1. Ship 3A first. Revisit Python and two-service MCP in Sprint 4+ when the embed is stable.

### Cooper (DevOps)

**Option 1:** Zero operational delta. ARCH-004 is unchanged.

**Option 2:** Full redesign of all deployment artifacts. SEC-7 and SEC-8 explicitly invalidated (node:20-alpine Trivy baseline and Knex-based init container spec are both invalid under Python). No Python operational precedent on the production host. Mixed-language system (TypeScript squad-api + Python MCP server) — two runtimes, two CVE watches, two build caches. PM2's `autorestart` and `max_memory_restart` have no Uvicorn equivalents.

**Option 3:** Two PM2 entries. Port allocation: port 3001 (Primitives), port 3005 (Utilities — next clean allocation after openbridge 3003/3004). Five Docker Compose services (up from 4 in ARCH-004 2A). `opensquad_app` CONNECTION LIMIT currently uncapped — two services double the unmanaged connection pressure on PostgreSQL before the limit is set.

**Critical:** Port 3002 conflict (google-workspace-mcp-server vs squad-api) must be resolved before any new port assignments are made.

**Cooper's recommendation:** Option 1. "Eight SEC conditions are open. The PITR gap is in Sprint 2 remediation. The Docker Compose topology is designed but not implemented. The port 3002 conflict is unresolved. This is not a system that has operational headroom for a runtime rewrite or a two-service split."

### Clarence (Documentation)

**Option 2 SEC governance vacuum:** The 8 Locksmith conditions from ARCH-004 were written against a specific TypeScript/Express/Vite stack. A Python greenfield does not inherit them automatically — it creates a question for each condition. Running without a disposition table is an audit failure, not a documentation inconvenience.

**Required tables:** ARCH-005 ADR must include an Artifact Disposition Table and an SEC Condition Disposition Table. These make ARCH-005 an architectural decision rather than a strategy memo.

**Option 3 repo question:** Whether Option 3 uses one repo (two entry points) or two repos (separate codebases) is not decided at the ARCH-005 level — it is a downstream implementation decision. Clarence flags: two-repo Option 3 doubles documentation maintenance burden. Preference: one repo, two entry points, one ADR.

### Nova (Strategic Intelligence)

**Founder's intent — nuanced reading:** The Founder said two distinct things. "Consider existing components as the base" = Option 1 premise. "Remove the shackles of being bound by what exists when we can create a new project / challenge the tech-stack" = clean-room invitation. Silas's recommendation (Option 1 now, Option 3 as target) is a correct pragmatic interpretation of the operational constraint. It is an incomplete interpretation of the Founder's signal.

**Clean-room parallel proposal:** Option 1 in production + Option 2 as a parallel 90-day R&D track. Not a replacement timeline. A time-boxed design reference: "what would we build if we started today?" Two implementation conditions: (1) time-boxed, not sprint-tracked, reports to Nova quarterly; (2) nothing ships to the clean-room in response to production pressure. Strict gate: evaluation at 90 days with pre-declared criteria.

**Option 3 positioning:** "Agent OS" is architecturally verifiable under Option 3. Under Option 1, it is a label on a monolith — defensible internally, weakens under technical scrutiny from external partners.

**Sequencing realism:** The recommended sequencing (Option 1 now, Option 3 Sprint 4+) is realistic ONLY IF ARCH-003 Conditions 2+3 are closed this sprint. Both are Silas+Nova obligations, 6+ days overdue. If not closed, Sprint 4 inherits their weight.

**Three decisions required from Richo at next L10:**
1. Parallel clean-room (Option 2 R&D track): yes or no, owner, 90-day gate criteria.
2. Confirm Option 3 as the declared architectural target.
3. Force-close ARCH-003 Conditions 2+3 obligation on Silas+Nova this sprint.

### Locksmith (Security — Binding)

**Option 1:** No new attack surface. ARCH-001 unchanged. SEC-1–8 unchanged. Cleared.

**Option 3 — token validation pattern (Locksmith-approved):** Use a shared TypeScript validation library imported by both services. **Not** independent implementations (two code surfaces to audit). **Not** a gateway auth layer (new attack surface + new failure point). Shared library: one auth code path, tested once, deployed to both. This is the required pattern before Option 3 implementation begins.

**Option 2 — binding conditions:** ARCH-001 reimplemented in Python is a new security boundary, not an extension. A full threat model review is required before any Python auth implementation reaches production. SEC-7 and SEC-8 are reset to zero under Python greenfield — both must be re-reviewed by Locksmith from scratch. ARCH-004 SEC-7/SEC-8 as currently written are **invalid** for a Python system.

**Parallel clean-room security:** If the clean-room accepts live agent connections, it must implement ARCH-001-equivalent auth from day one. If it runs in isolation (test tokens only), it may begin without a full auth review — but must be on **network isolation** before any live token is used against it.

**Locksmith's ruling:** Option 2 as production replacement is unacceptable without a mitigation plan that includes: full threat model update, ARCH-001 FastAPI re-implementation review, SEC-7 and SEC-8 reset and re-review. That mitigation plan does not exist today. Option 2 as production replacement cannot be selected at this time.

---

## Step 5 — Decision Matrix

| Option | Effort | Platform Fit | Security Risk | Ops Complexity | Milestone A Risk | Capacity Fit | ARCH-003 Enforcement |
|---|---|---|---|---|---|---|---|
| Option 1 | Low | ✅ Full | Low | No change | None | High | Convention + lint |
| Option 2 | High (4–6 sprints) | ⚠️ ML gain, runtime disruption | High (SEC-7/8 reset; new threat model) | Very High | HARD CONFLICT (if squad-api migrates) | Low | Convention only |
| Option 3 | Medium-High (w/ test coverage) | ✅ ARCH-003 truest | Medium (shared auth library required first) | Medium-High | None (after 3A) | Medium | **Process boundary** |

### Named Disagreements

1. **Silas calls Option 3 "Medium risk" — Murphy challenges this.** Partial failure state complexity under multi-MCP clients is not in the estimate. Revised: Medium-High when test coverage is included.
2. **Nova vs Silas on Option 2 framing.** Silas: "future gate." Nova: "parallel clean-room R&D track." Resolution: both are correct — they describe different things. Option 2 as production replacement = rejected now. Option 2 as R&D parallel = pending Richo's decision.
3. **Cooper's operational veto on Option 2 timing.** Upheld. 8 open SEC conditions + PITR gap + no Python precedent = no operational headroom. Timing veto, not language veto.

---

## Decisions

| Decision | Result |
|---|---|
| Immediate execution | **Option 1** — TypeScript module decomposition (`src/primitives/` + `src/utilities/` + ESLint boundary rules) this sprint |
| Declared architectural target | **Option 3** — Two-service MCP architecture, Sprint 4+, gated on ARCH-003 Conditions 2+3 + ARCH-004 SEC-1–8 closure |
| Option 2 production replacement | **Rejected at this time** (Locksmith: no mitigation plan exists; Cooper: no operational headroom; Rocket: June 27 conflict) |
| Option 2 R&D parallel clean-room | **Deferred to Richo** — decision at next L10 |

### New Architectural Policy (Locked)

**Integrations connect to the Coordination Utilities tier only.** This applies to openBridge, nova-telegram-bridge, clickup-mcp-server, and all future integrations. Convention-enforced under Option 1. Process-enforced under Option 3. Non-negotiable under either.

---

## ADR Reference

**ARCH-005** filed at: `docs/ARCH-005-agent-os-canonical-architecture.md`

Status: **Decided**  
Decision Owner: Silas  
Approved by: Elizabeth  
Filed by: Clarence  
Review Date: 2026-08-20

---

## Action Items

| Task # | Title | Owner |
|---|---|---|
| #1248 | Implement src/primitives/ + src/utilities/ module decomposition + ESLint boundary rules | Murphy |
| #1249 | Classify all 22 MCP tools by tier — produce the module ownership register first | Murphy |
| #1250 | Document two-tier module ownership register in vault (Obsidian) | Clarence |
| #1251 | Design Option 3 shared auth validation library — Locksmith-approved pattern | Silas |
| #1252 | Update docs/00-architecture.md for two-tier module structure | Silas |
| #1253 | Raise parallel clean-room (Option 2) at next L10 — get Richo's yes/no | Elizabeth |
| #1254 | Update Docker Compose 2A design for 5-service topology (Option 3 prep) | Cooper |
| #1255 | Clean up dual .ts/.js committed build artifacts in src/mcp/tools/ | Murphy |

---

## Immediate Escalations

1. **ARCH-003 Conditions 2+3 are overdue (6+ days).** Both are Silas+Nova joint obligations. These gate Option 3's Sprint 4+ commitment. If not closed this sprint, the Option 3 timeline must be revised.

2. **Richo must answer the clean-room question at the next L10.** If yes: owner named, 90-day gate criteria set before work begins. If no: Option 2 closed until MemPalace Phase 3/4 cross-encoder reranker trigger.

3. **Locksmith's Option 3 shared auth library design** must be completed before any Option 3 implementation begins. This is not a rubber-stamp — it is a design gate.

4. **Port 3002 conflict remains unresolved.** Cooper must confirm live port map before any new port assignments are made.

---

*Minutes filed by Clarence. Memories stored for Silas, Locksmith, Murphy, Rocket, Cooper, Clarence, Nova, Elizabeth (IDs 1772–1779). Tasks created: #1248–#1255.*
