# OpenHiveOS — Harness Research: What We Know, What We Need to Measure

> **STATUS: DRAFT — Internal review only. Do not distribute or reference externally.**

| | |
|---|---|
| **To** | Rich Barrera |
| **From** | Nova — Chief of Staff, IO Labs |
| **Date** | June 14, 2026 |
| **Version** | v0.1 — Draft for review |
| **Next action** | Review by Rich → Squad review → Gate A sign-off before any external use |

---

## The situation in one paragraph

Two independent research groups — Fudan/Qiji Zhifeng and Stanford/MIT — used opposite engineering methods and reached the same conclusion: the harness layer (orchestration, tools, memory, middleware) is where measurable, transferable performance lives — not the model and not the prose prompt. That convergence is a genuine research event. It converts our core thesis — that the orchestration layer is the differentiable thing — from internal framing into external consensus backed by peer-reviewed arXiv papers. We are not yet in a position to claim a specific performance number for OpenHiveOS itself. Those are two different statements, and this memo holds both.

---

## 1. What the research validates (defensible today)

**Validated by two independent papers using opposite engineering methods:**

1. **The harness layer is the measurable differentiator** — not the model, not the prose prompt. AHE's component ablation isolates tools, middleware, and long-term memory as the load-bearing components; the system prompt alone *regresses* (−2.3 points).
2. **Long-term memory is structural, not decorative.** AHE's ablation singles it out as one of three components that carry durable, transferable gains across benchmarks and model families.
3. **Raw, retrievable experience access outperforms compressed summaries — significantly.** Meta-Harness's ablation: full-trace interface = 50.0 median accuracy; summaries = 34.9; scores-only = 34.6. Summaries do not recover the signal and can hurt.
4. **Gains transfer across model families.** A frozen harness improved on one model family transferred +5.1 to +10.1 points across three others. The architecture bet is not model-locked.

OpenHiveOS embodies all four of these properties by design: typed retrievable memory, peer governance, persistent collective experience, vendor-independent substrate. The external papers validate the *architecture thesis*, not our specific delivery numbers.

**The canonical firewall sentence — this phrasing must not drift:**

> *"The field is converging on the harness layer from two directions, and OpenHiveOS is a runtime expression of that consensus for a coordinated team."*

**What we do not say — ever:**
- That OpenHiveOS reproduces AHE or Meta-Harness benchmark results. Those are build-time optimizer results on coding benchmarks. OpenHiveOS is a runtime governance substrate. Different category, different evidence.
- That OpenHiveOS currently runs an automatic self-improvement loop. It accumulates experience; it does not yet mutate its own configuration against measured outcomes with rollback.

---

## 2. What we do not yet know (the measurement gap)

We do not have our own measured data for the claim that matters to any serious buyer: **more accepted deliverables per operator-hour, at non-inferior quality.**

The research validates the principle. It does not provide our number.

This is not a problem — it is a pre-registration opportunity. Asserting an unverified performance multiple to any buyer before we have run the experiment is a risk. The scientific position is the stronger commercial position: *"we are pre-registering a rigorous protocol to measure this before we claim it."* That is what defensible looks like to a technical buyer. It is also honest.

The asymmetry is real: the downside of an unverified claim that gets tested and fails is much larger than the downside of a measured result that takes one more quarter to produce.

---

## 3. The path to a defensible number: Protocol v2

Antonio's experiment protocol (v2) is correctly designed for this. Key properties:

- **Within-operator crossover** — same operator runs both conditions on matched task sets. Person-to-person skill differences cancel out, which is the largest source of noise in productivity studies.
- **Pre-registered falsifier** — the kill criterion is locked before any run. The result is evidence either way. This is what separates a measurement from a demonstration.
- **Primary endpoint is the right one** — accepted deliverables per operator-hour, with quality held as a non-inferiority gate. Throughput that comes from dropping quality below the acceptance bar does not count.
- **Reporting commitment includes null and negative results.** This is the commitment that makes a positive result mean something.

### What must be decided before the first run

All `[LOCK — owner]` fields in Protocol v2 must be decided in one meeting, with the pre-registration signed and dated before any run touches a real task set. Moving the bar after results are seen invalidates the result.

| Decision | Owner | Status |
|---|---|---|
| Primary claim + falsifier (exact wording) | Antonio | Open |
| Base model + version (frozen across both conditions) | Carmack | Open |
| OpenHiveOS commit SHA under test | Carmack | Open |
| Task set definition + acceptance bar | Doshi | Open |
| Number of operators (N) | Antonio | Open |
| Analysis plan + statistical margins | Doshi | Open |
| Decontamination + leakage audit | Rich + Locksmith | Open |
| Run log schema (instrumentation prerequisite) | Carmack | Not yet scoped |

The run log schema deserves a specific callout: the `llm_usage` cost ledger exists (ARCH-022), but there is currently no schema tying operator session time to deliverable outcomes. This must be defined as part of the commit freeze — it is a prerequisite for calculating the primary endpoint, and it is on the critical path for any future self-tuning meta-layer.

---

## 4. Technical gaps that gate operational claims

The research brief (§7) lists the current OpenHiveOS gaps honestly. That list was assessed against a Sprint 9 snapshot. **The first action is verifying which of these are closed on `main` today** — Engineering, one week.

Beyond the generic framing in the brief, the regulatory context of a 14-country LATAM fintech buyer adds a specific filter. The gaps that matter most in that context:

| Gap | Why it matters in regulated fintech | Status needed before any operational claim |
|---|---|---|
| **Encryption-at-rest** | ISMS controls required for CNBV IFPE authorization; verbatim Postgres storage is not sufficient documentation | Verified closed |
| **External egress (Gemini embeddings)** | Transaction semantics and counterparty patterns are encoded in embeddings; third-party embedding computation may conflict with data-residency requirements under Mexican data protection law (LFPDPPP) | Architecture decision needed |
| **PII/PAN redaction** | SPEI payloads contain CLABE, RFC, counterparty names; AML data may carry LFPIORPI obligations; regex-only coverage will miss LATAM regional ID formats (CURP, RUT, CPF, etc.) | Locksmith must define test cases; not an Engineering-only call |
| **Immutable audit log** | CNBV may require audit trails for SPEI-adjacent operations; `last_used_at` + usage ledger is not sufficient for regulatory audit | Scoped work needed |
| **Tier isolation (monolith)** | A compromised agent context has read access to all squad data; in a fintech deployment this could include SPEI transaction context; blast radius is unacceptable | Highest-priority architectural item |

The question for this review is not "which are closable inside any client timeline." The question is: **which must be closed and independently verified before we make any operational claim in a signed proposal?** Those two lists are likely not the same.

---

## 5. The self-tuning meta-layer — correctly labeled future work

The research opens a credible roadmap story: a meta-layer that evolves the SOP library, disposition defaults, and memory-surfacing rules from measured squad outcomes. The design would combine AHE's falsifiable change manifest with Meta-Harness's full-trace access, applied to a *governed* self-improvement loop — something neither paper has.

This is future work. It is not a sprint item. Two prerequisites before it is sprint-ready:

1. **Read-only shadow mode first.** The meta-layer observes and proposes changes without applying them, for a full sprint evaluation period, before it is granted any write access to dispositions or SOPs. AHE's own stated #1 weakness is regression blindness — the loop predicts fixes well but cannot foresee what it breaks. Applied to a live squad, that risk is asymmetric. Shadow mode is not optional.
2. **Protocol v2's primary endpoint must be defined first.** "Accepted deliverables per operator-hour" is the candidate optimization target. The meta-layer needs the run log instrumentation to operate — which means that instrumentation is on the critical path for both the experiment and the meta-layer.

The roadmap story is credible. Do not pull it into a sprint until the shadow mode gate is designed.

---

## 6. What we can say now vs. what requires measured data

| Statement | Status |
|---|---|
| "The harness layer is the measurable differentiator — validated by two independent research groups using opposite methods" | Defensible now |
| "OpenHiveOS embodies the architecture both papers identify as load-bearing: retrievable memory, typed experience, peer governance, vendor-independence" | Defensible now |
| "OpenHiveOS delivers [X×] more work per operator" | Cannot claim until Protocol v2 is run and pre-registered results are published |
| "OpenHiveOS is production-ready for a regulated LATAM fintech" | Cannot claim until gap list is verified closed on `main` and independently audited |

The scientific position is the strong position. We know what we know. We are measuring what we don't. That is a better story to a technical buyer — particularly one whose CTO and lead architect will ask for the methodology — than an unverified multiple.

---

## 7. Recommended sequence

### Immediate (this week)
- [ ] **Lock the firewall sentence** in Obsidian vault — one canonical phrasing, referenced by all downstream assets. **Clarence**
- [ ] **Verify gap list against `main`** — closed/open status for each item in §4. Not the Sprint 9 snapshot. **Murphy + Rich**
- [ ] **Locksmith assessment** — which gaps are regulatory deal-blockers vs. roadmap disclosures under LFPDPPP / CNBV / LFPIORPI intersection. **Locksmith**

### Near-term (before Protocol v2 runs)
- [ ] **Schedule the `[LOCK]` meeting** — one session, all Protocol v2 fields decided, pre-registration signed and dated. **Antonio chairs · Carmack + Doshi + Rich + Locksmith attend**
- [ ] **Define the run log schema** — Carmack scopes as part of the commit freeze. Small task, high leverage.

### Quarter-scale (producing the defensible number)
- [ ] **Run Protocol v2** — primary study first. Optional modules (E, R, I) only if scope allows and only if they do not compromise the core study's cleanliness.
- [ ] **Publish pre-registration alongside results**, including null or negative results.

---

## Open questions for this review

1. Is the "two methods, one conclusion" framing accurate under Squad scrutiny before it enters any proposal copy? (Antonio + Rich — Gate A)
2. Which of the §4 gaps are already closed on `main`? (Engineering — one week)
3. Can the `[LOCK]` meeting be scheduled in the next two weeks? (Antonio)
4. Which gaps require independent verification vs. internal declaration before they can support an operational claim? (Locksmith)

---

*Nova — Chief of Staff, IO Labs*
*Draft v0.1 · June 14, 2026*
*Not for external distribution. Pre-Gate A.*
