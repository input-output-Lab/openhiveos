# Sprint Planning Notes
**Date:** 2026-06-13
**Project:** OpenHiveOS
**Facilitator:** Elizabeth
**Sprint:** 12
**Sprint Goal:** Ship the telemetry activity log foundation and clear the P2 dashboard bug backlog — so operators can navigate the dashboard without friction and the Factory has tool-call visibility for the first time.
**Sprint Start:** 2026-06-14
**Sprint End:** 2026-06-27
**Sprint Health Prediction:** 🟢 Confident

---

## Sprint Stories

| # | Story | Owner | Est | DoR | Dependencies |
|---|---|---|---|---|---|
| 1774 | T1-1: Migration 017 — `tool_invocations` schema | Silas | XS | ✅ | None — Day 1 gate for #1775/#1776 |
| 1775 | T1-2: Log tool calls in /mcp handler | Murphy | S | ✅ | #1774 applied by Cooper |
| 1776 | T1-3: Log tool calls in /sse handler (`'bridge'` fallback) | Murphy | S | ✅ | #1774 applied by Cooper |
| 1777 | T3-1: Document VS Code session_id format in ARCH-015 | Murphy | S | ✅ | None — unblocks #1778 |
| 1778 | T3-2: Add `report_usage` protocol to 12 agent instruction files | Murphy | M | ✅ | #1777 in REVIEW |
| 1753 | Bug: Blank content area on route navigation | Rocket | S | ✅ | None |
| 1754 | Bug: Sidebar navigation DS compliance | Rocket | M | ✅ | Silas icon ruling (issued — Option A) |
| 1755 | Bug: Org chart clips right-side nodes | Rocket | S | ✅ | None |
| 1771 | `bug-and-change-request-intake.md` v1.1 | Clarence | S | ✅ | None |

---

## Key Decisions Made in This Session

**D1 — #1776 scope (Silas):** T1-3 SSE handler uses `'bridge'` as the fallback `agent_slug` for Sprint 12. Session registry enhancement (real per-agent attribution for SSE calls) is named technical debt, deferred. `-- DATA QUALITY GAP` comment required in code.

**D2 — #1754 icon strategy (Silas):** Option A binding — inline SVG, no new npm packages. ARCH-020 owns the icon system decision; this sprint does not pre-empt it. Each icon authored as isolated `<svg fill="currentColor" class="w-4 h-4">` for clean future extraction.

**D3 — #1753 root cause correction (Silas):** Not an `onMounted` / `watch` issue. `App.vue` already has `:key="$route.path"` which remounts views on every path change. Real root cause: missing `v-else` catch-all empty state in the three-state contract. Fix: add `<EmptyState>` as the final conditional branch.

**D4 — #1778 scope (Nova):** 12 files, not 7. All squad agent `.agent.md` files in `~/.copilot/agents/`. Confirmed via grep: clarence, locksmith, meridian, one, rocket, scout, zero have 0 existing `report_usage` mentions. File count confirmed against squad manifest before #1778 starts.

---

## Dependency Sequence

```
DAY 1 (parallel)
├── Silas   → #1774: migrations/017_tool_invocations.sql
│               ↓ Cooper applies + confirms \dt tool_invocations
│           → #1775 (Murphy) + #1776 (Murphy) — start Day 2
│
├── Murphy  → #1777 (no deps, Day 1 start)
│               ↓ #1777 in REVIEW
│           → #1778 (Murphy) — start Day 2/3
│
├── Rocket  → #1755 (Day 1 close)
│           → #1753 (Day 1 start)
│           → #1754 (Day 1 start — icon ruling issued)
│
└── Clarence → #1771 (Day 1 start)
```

No circular dependencies. Sprint achievable with this sequencing.

---

## Coordination Actions (before respective merges)

| Action | Owner | Deadline |
|---|---|---|
| Confirm dual-layer tracking intent (`factory_tool_usage` vs `tool_invocations`) — cross-project flag from Nova | Silas | Before #1774 merges |
| Handshake on `:vscode:`/`:bridge:` segment naming in `session-id.ts` (opensquad-mcp-server) | Murphy + Clarence | After #1777 merges |
| Confirm `.agent.md` file count against squad.manifest.json | Murphy | Before #1778 starts |

---

## Backlog Refinement List

| Story | Reason Removed | Target Sprint |
|---|---|---|
| #1770 Inbound webhook (HMAC + dedup) | 🔴 GATED — SyncWorker not validated for 1 sprint in production | Sprint 13 |
| #1766 Retire clickup-mcp-server | 🔴 GATED — same gate as #1770 | Sprint 13 |
| #1752 Dashboard DS full rebuild | Shadow estimate: L effort, removed to protect sprint integrity | Sprint 13 |
| #1757 Agent full-page detail view | Duplicate #1496 must be closed first (DoR otherwise clear) | Sprint 13 |
| #1779 T3-3 Smoke test script | Deferred — T3-2 must be stable in production first | Sprint 13 |
| #1756 Projects overview chart | P3, below bug priority threshold | Sprint 13 |
| #1772 Dashboard triage inbox | Depends on #1770 (gated) | Sprint 13 |
| #1773 JIRA adapter | Sprint N+2 by design — gate: ClickUp outbound validated 1 sprint | Sprint N+2 |
| #1498 UI polish pass | P3, after P2 bugs clear | Sprint 13 |
| #1496 Agent detail (duplicate) | CLOSED — superseded by #1757 | Closed |

---

## Technical Debt Logged

| Item | Owner | Priority |
|---|---|---|
| `TD-S12-01` SSE agent attribution gap — all SSE tool calls attributed to `'bridge'`, not real agent slug | Silas (design) + Murphy (impl) | Low — SSE is legacy transport |
| `TD-S12-02` Default privileges fragility — future migrations run as different host user won't auto-grant DML to `openhiveos` | Cooper | Low — audit before next env provisioning |

---

## Board Actions Taken (this session)

- `#1496` closed (DONE) — duplicate of #1757, superseded
- `#1759` closed (DONE) — ClickUp bot scoping, completed in S11
- `#1768` closed (DONE) — sprint-workflow.md v1.4, completed in S11
- `#1769` closed (DONE) — clickup-integration-operations.md, completed in S11

Board state post-cleanup: **177 done / 0 wip / 0 review / 0 rework / 18 todo** (9 entering Sprint 12, 9 deferred to Sprint 13+).

---

## Action Items

- [ ] **Silas** — Deliver `migrations/017_tool_invocations.sql` (#1774) — **2026-06-14 morning**
- [ ] **Cooper** — Apply migration 017; confirm `\dt tool_invocations` passes — **2026-06-14**
- [ ] **Murphy** — Confirm `.agent.md` file inventory before starting #1778 — **before #1778 starts**
- [ ] **Silas** — Issue dual-layer tracking ruling (Nova flag) before #1774 merges
- [ ] **Murphy + Clarence** — Handshake on `:vscode:`/`:bridge:` segment naming after #1777 merges
- [ ] **Elizabeth** — Schedule Sprint 12 Review (2026-06-27) and Sprint 13 Planning (2026-06-28) on shared calendar

---

*Decision owner: Elizabeth. DoR authority: Silas. Cross-project validation: Nova.*
