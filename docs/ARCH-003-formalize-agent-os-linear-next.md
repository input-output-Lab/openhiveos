# ARCH-003 — Formalize OpenSquad as Agent OS — Linear Next Strategic Positioning Decision

**Date:** 2026-05-19
**Project:** opensquad-mcp-server
**Status:** Decided
**Decision Owner:** Silas
**Approved by:** Elizabeth

---

## Context

Linear Next launched in May 2026 with an AI-native project management interface, creating a surface-level positioning overlap with OpenSquad. This triggered a strategic review across all six seats: is OpenSquad a project management tool that should interoperate with Linear, or is it something categorically different? The review surfaced a more fundamental question — OpenSquad has organically developed capabilities (persistent agent memory, SOPs, tasks, projects, crons, thoughts, dispositions, and cost tracking) that no third-party PM tool was designed to provide. After 27 schema migrations in approximately eight weeks, the system has grown into the shared memory and coordination substrate for the entire IO Labs agent squad. The squad needed a formal position statement before Linear Next's framing solidified market perception in a direction that does not reflect what OpenSquad actually is.

---

## Decision

**Option C: Formalize OpenSquad as Agent OS. Vote: 6/6 across all seats.**

OpenSquad is formally designated the Agent Operating System for IO Labs — the shared memory, identity, coordination, and tooling layer on which the agent squad runs. It is not a project management tool. It is not a Linear competitor. It is the cognitive infrastructure of the Factory. ClickUp remains the authoritative client-facing PM platform. Linear handles whiteboard-level planning where adopted. OpenSquad owns the mind: persistent memory, agent identity, SOP authority, task state, project health, and cost accountability. The two-tier model governs the architecture going forward: **OS primitives** (memory, identity, SOPs, agent registry, token lifecycle) are stable, versioned, and formally deprecation-protected; **coordination utilities** (tasks, crons, projects, cost tracking) are active-development-pace features that may evolve without the same backwards compatibility guarantee.

---

## Rationale

The "Factory, not vendor tool" principle has been the foundational design constraint since the server's inception. Option C is the only option that follows that principle to its logical conclusion. Three observations from Silas drove the framing:

1. **The two-tier model gives every seat a stable referent.** Agents can build against OS primitives without fear of breakage. Coordination utilities can evolve quickly without threatening that stability. This resolves the recurring ambiguity about what is "safe to depend on" versus "in active flux."

2. **"Linear gets the whiteboard; OpenSquad owns the mind."** Linear Next's AI-native interface operates at the project planning layer. OpenSquad operates at the cognitive layer — below and beneath any planning tool. These are not competing for the same job. Formalizing this removes the positioning confusion before it becomes a client-facing problem.

3. **Non-dev agents are first-class citizens, not secondary users.** Nova, Clarence, and Elizabeth depend on OpenSquad's memory, identity, and SOP infrastructure as much as Murphy and Rocket depend on it. Option C's formalisation explicitly includes non-technical agent seats in the OS contract. Options A and B implicitly treated the system as developer infrastructure. That framing was wrong and Option C corrects it.

Nova's three cross-project risk flags further support Option C as the only option with a governance path:

- **Stability Promise Trap** — formalizing the OS label without versioning and deprecation policy turns the label into a liability. Option C names this risk and gates external naming on resolution.
- **Governance Vacuum** — without a defined authority for tier boundary decisions, OS primitive creep will corrupt the two-tier model within two sprints. Option C names this risk and assigns it to Silas + Nova.
- **MemPalace Classification Problem** — pgvector vs ChromaDB authority is unresolved. The vector store is load-bearing infrastructure. Option C names this risk and requires resolution before Phase 2.

---

## Trade-offs Accepted

- **External "Agent OS" naming is conditional, not immediate.** The squad accepts the cost of withholding the external identity label until stability commitments are formally defined. This delays messaging alignment with external audiences (clients, partners) but prevents premature promises.
- **Two-tier governance adds process overhead.** Every new capability shipped after this decision must be classified as either an OS primitive or a coordination utility before it lands in main. This is the correct trade. It replaces organic ambiguity with explicit, auditable decisions.
- **Option B's interop capabilities are deferred indefinitely.** The security prerequisites for a Linear MCP bridge are estimated at 6–8 weeks of prerequisite work (vault, staging environment, data classification, STRIDE threat model, webhook verification, outbound audit logging). The squad accepts this deferral in exchange for not shipping an unsafe integration surface.
- **Token lifecycle debt remains.** Three pre-existing auth weaknesses (expires_at not enforced, no atomic revocation, no rotation automation) are carried forward as sprint-ready debt. The squad accepts their continued presence for one sprint, with a hard expectation of remediation in the next.

---

## Consequences

**Architecture:**
- The two-tier model (OS primitives vs coordination utilities) is now the governing classification framework. All future capability additions must be classified against it before merging.
- The 22 existing MCP tools must be retrospectively classified within one sprint of this decision being filed.
- "Agent OS" becomes the internal identity label immediately. External use is gated on Open Condition 1.

**Schema and Infrastructure:**
- No new migrations are required by this decision alone.
- MemPalace vector store authority (Open Condition 3) will determine whether pgvector remains the sole authoritative backend or whether a ChromaDB integration path is formalised.

**Auth and Security:**
- Any PR touching auth middleware, token validation, tool routing, or DB access control requires a Locksmith gate before merge.
- Documentation-only PRs are exempt from this gate.
- Three token lifecycle items are confirmed as sprint-ready debt: expires_at enforcement in middleware, atomic revocation endpoint, rotation automation.

**Documentation (Clarence owns):**
- ARCH-003 filed and linked from `docs/README.md` and `docs/00-architecture.md`.
- The Project Glossary is updated to formally define: "Agent OS," "OS primitive," "coordination utility," and "Factory."
- `docs/00-architecture.md` and `docs/02-mcp-tools.md` are restructured to reflect the two-tier model.
- The two-tier classification table is authored as a standalone doc (`docs/09-tier-classification.md`) and linked from the architecture overview.

**Process:**
- The Definition of Done for all OpenSquad features now includes a tier classification field.
- Elizabeth enforces the classification gate at sprint close alongside existing DoD checks.

---

## Open Conditions (must be resolved before Phase 2)

1. **External Naming Gate** *(Richo decision — 48-hour window from date of filing)*
   Is the "Agent OS" label as an external-facing identity conditional on defined stability commitments? Specifically: Is a formal deprecation protocol, versioning policy, and backwards compatibility window required before the label is used with clients or in public-facing materials? Nova's position: yes, unconditionally. Murphy and Rocket are proceeding on the assumption that Phase 2 is a scheduled milestone that satisfies the commitment by default. Elizabeth will resolve the conflict and record the outcome. Until resolved, "Agent OS" is internal nomenclature only.

2. **Tier Boundary Governance** *(Silas + Nova to resolve before this ADR is filed)*
   Who holds binding authority to determine whether a given capability is an OS primitive or a coordination utility? The two-tier model has no enforcement mechanism until this authority is named. Silas proposes a lightweight RFC process with a 48-hour comment window and Silas as deciding vote. Nova's position is that any primitive reclassification requires cross-seat review given the backwards compatibility implications. This must be resolved and documented as an addendum to this ADR before Phase 2 begins.

3. **MemPalace Vector Store Authority** *(Silas + Nova to resolve before this ADR is filed)*
   pgvector (current backend, see ARCH-002) vs ChromaDB — which is the authoritative vector store for agent memory? This is not a preference question. It is a load-bearing infrastructure decision. MemPalace's architecture currently treats ChromaDB as authoritative and pgvector as a replica target via PgvectorBackend. If that relationship is to be reversed or made co-equal, the implications for ARCH-002's upsert model, the factory_memory schema, and search_memory query routing must be assessed before Phase 2 ships.

---

## Security Review

**Reviewed by:** Locksmith
**Date:** 2026-05-19
**Outcome:** Option C approved with conditions.

Option C introduces no new attack surface. The existing auth model (server-resolved agent identity via bearer token, see ARCH-001) applies unchanged. Locksmith's gate requirement — mandatory review of any PR touching auth middleware, token validation, tool routing, or DB access control — is formalised as a standing rule by this decision, not introduced as new process.

**Three token lifecycle items flagged as sprint-ready debt (pre-existing, not introduced by Option C):**
- `expires_at` is not enforced in the auth middleware. Tokens do not expire automatically. This is an active security gap.
- No atomic revocation endpoint exists. Token invalidation currently requires direct database intervention.
- No rotation automation exists. Manual rotation creates operational risk during agent handoffs or credential compromise events.

These items are confirmed as the highest-priority security backlog items for the sprint immediately following this decision. Locksmith will gate the next sprint close on a remediation plan being in place, even if implementation spans a second sprint.

---

## Rejected Alternatives

- **Option A — Hold the Line:** Acceptable on security grounds and approved by Locksmith. Rejected by unanimous squad vote as passively correct but strategically insufficient. Option A preserves the status quo without resolving the positioning ambiguity that the Linear Next launch created. It also leaves the documentation discipline tax as a recurring cost: without a formal designation, every new agent onboarding session requires re-explaining what OpenSquad is and isn't. Option A remains the designated fallback if Open Condition 1 (External Naming Gate) resolves negatively — that is, if Richo determines that the Agent OS label requires prerequisites the squad cannot satisfy before Phase 2.

- **Option B — Strategic Interop (MCP bridge to Linear API):** Vetoed by Locksmith on security grounds. OWASP findings: A01 (no data classification layer separating internal-only from Linear-safe data), A02 (Linear OAuth credentials in `.env`, no vault, no rotation), A04 (no formal threat model exists), A05 (trust model mismatch between Linear OAuth and internal bearer tokens), A08 (inbound webhook signature verification absent), A09 (no outbound data audit logging). Minimum prerequisite scope before Option B can be re-evaluated: secrets vault, staging environment, data classification layer, formal STRIDE threat model, webhook signature verification, outbound audit logging, and full token lifecycle debt remediation. Estimated prerequisite effort: 6–8 weeks. Option B is not permanently rejected — it is deferred until prerequisites are satisfied and a new security review is completed.

---

*ARCH-003 authored by Clarence. Technical rationale provided by Silas. Security ruling by Locksmith. Strategic positioning inputs from Nova. Vote confirmed by Elizabeth.*
*Review date: 2026-08-19 (90 days) or upon Phase 2 commencement, whichever is sooner.*
