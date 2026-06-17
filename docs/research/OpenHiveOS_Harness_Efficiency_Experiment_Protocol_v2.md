# OpenHiveOS Harness Efficiency — Experiment Pre-Registration (v2)

**A clean, result-first, industry-agnostic protocol for measuring what the ICP actually gets**

| | |
|---|---|
| **To** | OpenHiveOS Squad · Rich Barrera · DevSecOps |
| **From** | Antonio Barrera — IO Labs |
| **Date** | June 14, 2026 |
| **Status** | Pre-registration template. Fields marked `[LOCK — owner]` must be decided **before** any run. |
| **Supersedes** | Protocol v1 (mechanistic / harness-vs-bare-model framing) |
| **Methodological basis** | AHE (arXiv 2604.25850) · Meta-Harness (arXiv 2603.28052) |

---

## How to use this document

This is a **pre-registration**, not a test plan. Every `[LOCK — owner]` field is decided before the first run, and the sign-off in §9 is dated before any data is collected. Once locked, the bar does not move after results are seen. That commitment is what converts the output from a marketing figure into a defensible one.

**What changed from v1, and why.** v1 measured the *harness* — does the substrate beat the same model with no harness. That answers a mechanism question the ICP never asks. v2 measures the *result the ICP gets*: **more delivered work per operator, at quality they would accept.** It does so with the cleanest possible comparison and nothing else bolted on.

---

## The design in one paragraph

One operator does a frozen, matched set of real deliverables **twice** — once working the conventional way, once running the OpenHiveOS squad — on the same frozen base model. Because the operator is their own control, person-to-person differences (skill, speed, style) cancel out, which removes the largest source of noise and keeps the result industry-agnostic: no external team baseline and no industry-specific historical data are imported. The primary result is the change in accepted deliverables per operator-hour, with quality held as a non-inferiority gate. Everything beyond that is optional and explicitly separated, so the core stays clean.

---

## 1. The claim and the falsifier (locked first)

- **Primary claim:** `[LOCK — Antonio]` *e.g. "An operator running the OpenHiveOS squad delivers more accepted work per hour than the same operator working conventionally, at non-inferior quality, on the frozen task set in §3."*
- **Falsifier (kill criterion):** `[LOCK — Antonio]` *e.g. "No significant per-operator gain at equal quality — or quality falls below the acceptance bar."*

We commit to reporting against this falsifier whether it confirms or kills the claim.

---

## 2. Fixed controls

- **Base model + version (frozen across both conditions):** `[LOCK — Carmack]`
- **Inference settings held constant:** `[LOCK — Carmack]`
- **OpenHiveOS commit under test (pin the SHA):** `[LOCK — Carmack]`
- **Operator fluency:** every operator is pre-trained to fluency in **both** conditions before any measured run, so the result reflects the system, not the learning curve. `[LOCK — Doshi]`
- **Not varied:** model, settings, hardware, operator identity within a pair.

---

## 3. Task set (industry-agnostic)

A frozen, representative set of deliverables the ICP repeatedly needs and can define "done" for. Stated abstractly so any industry fits: a *unit of recurring operational or knowledge work with a checkable acceptance standard.*

- **Deliverable type:** `[LOCK — Doshi]` *(one type, defined neutrally — e.g. a standard report, a resolved ticket, a completed analysis, a drafted asset)*
- **Acceptance bar = the ICP's definition of done:** `[LOCK — Doshi]` *(objective verifier preferred; if rubric-based, see §5 grader rule)*
- **Number of deliverables (n), split into two matched halves Set 1 / Set 2:** `[LOCK — Doshi]` *(halves matched on type and difficulty so the two crossover arms are comparable)*
- **Decontamination + leakage audit:** `[LOCK — Rich + Locksmith]` *(no task-specific content pre-loaded into memory, SOPs, or dispositions; manual + regex audit)*

---

## 4. Primary study — within-operator crossover (the clean spine)

Two conditions, same operator, matched tasks:

| ID | Condition | Definition |
|---|---|---|
| **A** | Conventional | The operator works the way the role is done today: the same frozen base model used as a direct assistant — **no shared memory, no governance, no squad coordination.** |
| **B** | Substrate | The same operator runs the OpenHiveOS squad on the same frozen base model. |

**Counterbalancing (this is what cancels the remaining noise):** operators are randomly split so half do Set 1 under A then Set 2 under B, and half do Set 1 under B then Set 2 under A (an AB/BA crossover). This cancels both task-half difficulty differences and order/learning effects in aggregate.

- **Number of operators (N):** `[LOCK — Antonio]` *(report paired per-operator deltas; be explicit that small N means wide intervals)*
- **Primary endpoint:** **accepted deliverables per operator-hour** (a deliverable counts only if it meets the §3 acceptance bar).
- **Quality gate (non-inferiority):** B's per-deliverable quality must be at least A's, within a pre-set margin `[LOCK — Doshi]`. If B wins throughput by dropping quality below this margin, the throughput gain does **not** count.

---

## 5. Metrics (one primary, a tight secondary set — nothing else)

| Metric | Definition | Source | Role |
|---|---|---|---|
| **Accepted deliverables / operator-hour** | Output meeting the acceptance bar, per operator working-hour | Run log + grader | **Primary** |
| Quality rate at bar | % of deliverables meeting the acceptance bar | Grader | Non-inferiority gate |
| Cost per accepted deliverable | Operator time + model tokens, per accepted deliverable | `llm_usage` cost ledger + run log | Secondary |
| Cycle time per deliverable | Wall-clock from start to accepted | Run log | Secondary *(maps to lead time / DORA in software engagements)* |
| Rework rate | Fraction needing correction after first delivery | Grader | Secondary *(maps to change-failure / DORA in software engagements)* |

- **Grader:** `[LOCK — Doshi]` — objective verifier preferred. If an LLM judge is used, validate it against human ratings first (report agreement) before it scores anything.
- **Blinding:** grader is blind to condition; output order randomized.
- **Failure convention:** infrastructure failures count as failures, not discards.

---

## 6. Run and analysis

- **Replication:** each deliverable attempted under its assigned condition; where a task is re-runnable, k ≥ 3 for a variance signal. `[LOCK — Carmack]`
- **Isolation:** each run isolated so state cannot leak between conditions. `[LOCK — Rich + Locksmith]`
- **Analysis (pre-specified to prevent post-hoc fishing):** paired per-operator comparison of the primary endpoint (B − A), reported as effect size with a confidence interval; non-inferiority test on quality. Statistical test + margins: `[LOCK — Doshi]`
- **Logging:** capture traces, thought journal, and cost ledger for every run.

---

## 7. Optional modules (run only if scope allows — kept separate so the core stays clean)

**Module E — Explanatory ablation (why the result happens).** A separate study, operator held fixed or removed: bare model (C0) vs full substrate (C1) vs single-primitive ablations (−Factory Memory, −governance, −thought journal, −SOP library), k ≥ 3 on the §3 task set. Output: a component map of which primitives carry the result. Pre-register which ablations: `[LOCK — Carmack + Doshi]`

**Module R — Knowledge retention.** Introduce a personnel swap: a *different* operator picks up a Set 2 that depends on Set 1's context. Measure output continuity under B (Factory Memory carries the context) vs A (no shared memory; context must be reconstructed). Result: whether know-how survives a person leaving.

**Module I — Independence.** Binary handoff: the ICP's own operator runs the squad from documentation alone, on a second base model, producing accepted deliverables without vendor intervention. Pass/fail plus notes. Result: whether they can run it without us.

---

## 8. Reporting commitments

- Publish the pre-registration alongside results, **including null or negative results.**
- A limitations section is mandatory: N, variance, single task type, crossover carryover (skill learned in arm 1 cannot be fully washed out — counterbalancing handles the average, not the individual).
- **Firewall lines (non-negotiable):** results describe *this* commit, on *this* task set, with *these* operators. They do not transfer to other products, other industries, or other task types without re-running. They are not equivalent to AHE/Meta-Harness benchmark scores, and not a general performance guarantee.

---

## 9. Roles and sign-off

Owners are suggestions; Antonio assigns. The sign-off date is the pre-registration lock and precedes the first run.

| Function | Suggested owner |
|---|---|
| Claim definition, operator pool, result sign-off | Antonio (Gate A / Gate B) |
| Base-model + commit freeze, run execution, ablation design | Carmack |
| Task set, acceptance bar, grader, analysis plan, operator training | Doshi |
| Decontamination, isolation, DevSecOps | Rich + Locksmith |
| Documentation + reporting | Feynman |

**Pre-registration locked on:** `[DATE — before first run]`
**Signed:** `[Antonio]` · `[Rich]` · `[Squad lead]`

---

## Appendix — How the result maps to a value-based engagement (industry-agnostic)

- **Accepted deliverables / operator-hour** is the output-per-operator result — the measured basis for any throughput claim, in place of an asserted multiple.
- **Cycle time and rework rate** supply measured before/after baselines for a success-fee or SLA layer, in whatever units the engagement uses.
- **Module E's component map** shows which primitives are load-bearing — self-critical evidence that reads as honesty, not sales.
- **Modules R and I** turn "knowledge stays" and "vendor-independence" from claims into measured endpoints.

*Run the primary study alone for the cleanest defensible result; add modules only when scope allows, and never at the cost of the core's cleanliness.*
