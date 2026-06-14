# Sprint 12 Kickoff Summary
**Date:** 2026-06-14 09:00
**Project:** OpenHiveOS
**Facilitator:** Elizabeth

---

## Sprint Goal (LOCKED)
Ship the telemetry activity log foundation and clear the P2 dashboard bug backlog — so operators can navigate the dashboard without friction and the Factory has tool-call visibility for the first time.

**Sprint 12:** 2026-06-14 → 2026-06-27
**Health:** 🟢 Confident
**Stories:** 9 committed

---

## Day 1 Critical Path

```
Silas (08:00)
  ↓ Deliver migrations/017_tool_invocations.sql (#1774, XS)
      ↓
Cooper (09:00)
  ↓ Apply migration; confirm \dt tool_invocations
      ↓
Murphy (10:00)
  ↓ Start #1775 (T1-2: /mcp handler logging) + #1776 (T1-3: /sse handler)
```

**This gates all telemetry Track 1 work. Parallel tasks (Murphy #1777, Rocket bugs, Clarence #1771) start immediately at Day 1 09:00 — no dependency.**

---

## Binding Rulings

### R1 — #1776 Scope (Silas)
- SSE handler uses `'bridge'` FALLBACK for agent_slug
- Session registry enhancement = named tech debt (TD-S12-01)
- Mandatory: Add `-- DATA QUALITY GAP: agent_slug defaulted to 'bridge'` comment in code
- Rationale: Session registry lookup requires DB refactor; deferred to TD list

### R2 — #1754 Icon Strategy (Silas)
- **Binding:** Inline SVG only
- **No new npm packages** (Heroicons/Phosphor rejected)
- ARCH-020 owns icon system decision — this sprint does not pre-empt
- When ARCH-020 resolves, replace SVGs in one PR
- Implementation: minimal `<svg fill="currentColor" class="w-4 h-4">`, isolated per icon for clean extraction

### R3 — #1753 Root Cause (Silas)
- **NOT an onMounted / watch issue**
- `App.vue` already has `:key="$route.path"` → view remounts on every route change
- **ROOT CAUSE:** Missing `v-else` catch-all empty state in three-state contract
- FIX: Add `<EmptyState>` or content guard as final conditional branch
- Reproduction: App.vue remounts view → all refs reset → during data load, one frame exists where loading=false, error=null, data=null → blank render
- Scout must verify empty-state branch coverage before #1753 merges

### R4 — #1778 File Scope (Nova + Murphy)
- **12 files total** (not 7)
- File inventory: `~/.copilot/agents/*.agent.md`
- Target: all squad agent instruction files
- Cooper (1), Elizabeth (2), Murphy (2), Nova (1), Silas (1) have existing mentions
- Clarence (0), Locksmith (0), Meridian (0), One (0), Rocket (0), Scout (0), Zero (0) need full new sections
- **Pre-sprint action:** Murphy confirms file count against squad.manifest.json before starting #1778

---

## Coordination Actions (gates before merge)

| Action | Owner | Gate | Notes |
|---|---|---|---|
| Dual-layer tracking ruling | Silas | Before #1774 merges | Cross-project: factory_tool_usage (opensquad-mcp-server) vs tool_invocations (OpenHiveOS). Silas to confirm: both complete? Intentional dual-layer design? Reconciliation doc needed? |
| `:vscode:`/`:bridge:` segment naming | Murphy + Clarence handshake | After #1777 merges | Update `session-id.ts` in opensquad-mcp-server to reflect canonical segment values |

---

## Sprint Stories Assignment

| Day | Owner | Story | Size | Status |
|---|---|---|---|---|
| Day 1 | Silas | #1774 T1-1: Migration 017 | XS | Not started — gates all Murphy TI |
| Day 1 | Murphy | #1777 T3-1: ARCH-015 session_id doc | S | Not started — no deps |
| Day 1 | Rocket | #1753 Bug: Blank route fix | S | Not started — no deps |
| Day 1 | Rocket | #1754 Bug: Sidebar DS compliance | M | Not started — icon ruling issued |
| Day 1 | Rocket | #1755 Bug: Org chart overflow | S | Not started — no deps |
| Day 1 | Clarence | #1771 SOP v1.1 | S | Not started — no deps |
| Day 2 | Cooper | (ops gate) Apply migration 017 | — | Blocked by Silas #1774 |
| Day 2 | Murphy | #1775 T1-2: /mcp logging | S | Blocked by Cooper gate |
| Day 2 | Murphy | #1776 T1-3: /sse logging | S | Blocked by Cooper gate |
| Day 2+ | Murphy | #1778 T3-2: Agent instructions | M | Blocked by #1777 REVIEW |

---

## No Blockers Identified

✅ Silas ready to deliver migration SQL
✅ Cooper ready to apply and confirm
✅ Murphy understands #1777 start, #1778 file scope
✅ Rocket understands all three P2 bug diagnoses
✅ Clarence ready to execute SOP update

---

## Reminders

1. **Definition of Done:** All stories must pass their DoR checks before merge. Silas is the DoR authority.
2. **Scope:** Do not pull deferred stories into this sprint. #1770, #1766, #1752, #1757, #1779 are explicitly out of scope.
3. **Rulings are binding:** R1–R4 are not suggestions. Do not re-open these decisions mid-sprint.
4. **Board hygiene:** Update task status as work progresses. Elizabeth owns the board.
5. **Daily standup:** Every morning, flag blockers before they become crises.

---

**Sprint 12 is formally in session. Let's ship telemetry.**
