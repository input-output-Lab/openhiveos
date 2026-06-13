# Bug reports

**Reviewed:** 2026-06-12 — Elizabeth  
**Assignee:** Rocket (all items)

---

## bug-01 — P2 · Task #1752
### Dashboard — Design system compliance
The dashboard UI does not match the IO Labs neo-brutal design system. Typography weights, border treatment, and color tokens are all non-compliant.

**Reference:** http://localhost:6006/?path=/story/experiments-neo-brutal-landing--navbar-hero-paper-white  
**Task:** #1752 "Bug: Dashboard UI does not match IO Labs neo-brutal design system"  
![alt text](<Screenshot 2026-06-12 at 21.34.13.png>)

---

## bug-02 — P2 · Task #1753
### Dashboard — Blank screen on route navigation
When changing screens the content area renders blank (white). Works after hard refresh. Likely a Vue router lifecycle / `onMounted` issue.

**Task:** #1753 "Bug: Blank content area on route navigation — works only after hard refresh"  
![alt text](<Screenshot 2026-06-12 at 21.48.33.png>)

---

## bug-03 — P2 · Task #1754
### Dashboard — Sidebar nav non-compliance
Sidebar nav icons and active/hover states do not match the DS nav specification.

**Task:** #1754 "Bug: Sidebar navigation not compliant with design system spec"  
![alt text](<Screenshot 2026-06-12 at 21.49.41.png>)

---

## bug-04 — P2 · Task #1755
### Dashboard — Org chart clipped
The org chart clips right-side nodes (Locksmith branch cut off). Container overflow is hidden rather than scrollable.

**Task:** #1755 "Bug: Org chart clips right-side nodes — Locksmith branch not visible"  
![alt text](<Screenshot 2026-06-12 at 21.50.44.png>)

---

## change-request-01 — P3 · Task #1756
### Dashboard — Projects overview chart
Add a projects chart to the Dashboard home view for a first-glance overview of project health and status.

**Task:** #1756 "Feature: Add projects overview chart to Dashboard home view"

---

## change-request-02 — P3 · Task #1757
### Dashboard — Agent full-page view
Replace the agent detail side drawer with a dedicated full-page view at `/agents/:slug`. The drawer lacks space for the full reasoning ledger and agent metadata.

**Task:** #1757 "Feature: Agent full-page detail view to replace side drawer"  
![alt text](<Screenshot 2026-06-12 at 21.46.20.png>)