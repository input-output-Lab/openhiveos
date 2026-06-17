# SOP-001: OpenHiveOS Documentation Organization

**Owner:** Clarence (Documentation Specialist)  
**Last Updated:** 2026-06-15  
**Review Date:** 2026-09-15

---

## Purpose

Establish a single source of truth for where every type of documentation belongs in the OpenHiveOS project. Ensures new documents land in the correct folder on creation, reducing organizational friction.

---

## Audience

Every team member who creates documentation: developers writing ADRs, architects writing decision records, testers writing audit reports, project managers writing sprint reviews, and team leads writing retrospectives.

---

## Where Documentation Goes

### ✅ Root Level (`/`)

**ONLY:** `README.md` (project overview) and config/build files

### ✅ `docs/`

**General project documentation:**
- `CHANGELOG.md` — Release notes, version history
- `*.md` for foundational guides, handbooks, brand materials
- Architectural Decision Records (`ARCH-*.md`)
- API specifications (`openapi.yaml`)
- Tool reference guides (`*-reference.md`)
- Glossary and standardization documents

**Rule:** If it's referenced from the project README or landing page, it lives in `docs/`.

### ✅ `docs/minutes/`

**Sprint and meeting documents:**
- Sprint reports: `S[N]-*.md` or `SPRINT-[N]-*.md`
- Meeting minutes: `YYYY-MM-DD-*.md`
- Sprint retrospectives: `S[N]-RETROSPECTIVE.md`
- Release sign-offs: `S[N]-RELEASE-SIGN-OFF.md`
- Sprint closure reports: `S[N]-CLOSURE-REPORT.md`
- Scorecard metrics: `S[N]-SCORECARD-METRICS.md`

**Rule:** If it describes what happened in a sprint or meeting, it goes here.

### ✅ `docs/audits/`

**Compliance, audit, and task-specific reports:**
- Accessibility audits: `TASK-*-ACCESSIBILITY-AUDIT.md`
- Design system audits: `TASK-*-DS-COMPLIANCE-AUDIT.md`
- Security reviews: `TASK-*-SECURITY-AUDIT.md`
- Task implementation summaries: `TASK-*-IMPLEMENTATION.md`
- Compliance reports: `COMPLIANCE-*.md`

**Rule:** If it's a review, audit, or verification of something done, it goes here.

### ✅ `docs/[project-name]/` (Future)

When OpenHiveOS expands beyond a single codebase, project-specific docs will be organized as:
- `docs/squad-api/` — squad-api service documentation
- `docs/dashboard/` — dashboard frontend documentation
- etc.

---

## Decision Tree

**I'm writing a document. Where does it go?**

```
Is it about a sprint or meeting?
  ├─ YES → docs/minutes/
  └─ NO ↓

Is it an audit, review, or verification?
  ├─ YES → docs/audits/
  └─ NO ↓

Is it architectural?
  ├─ YES (ARCH-*.md) → docs/
  └─ NO ↓

Is it general project guidance, brand, or release notes?
  ├─ YES → docs/
  └─ NO ↓

If unsure, ask Clarence or check this SOP.
```

---

## Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Sprint Report | `S[N]-SPRINT-NAME.md` | `S14-RELEASE-READINESS.md` |
| Meeting Minutes | `YYYY-MM-DD-SUBJECT.md` | `2026-06-15-L10.md` |
| Retrospective | `S[N]-RETROSPECTIVE.md` | `S14-RETROSPECTIVE.md` |
| Audit | `TASK-[ID]-AUDIT-TYPE.md` | `TASK-1797-DS-COMPLIANCE-AUDIT.md` |
| Architectural Decision | `ARCH-[N]-TITLE.md` | `ARCH-025-NEW-DECISION.md` |
| Changelog | `CHANGELOG.md` (root-level in docs/) | — |

---

## Expected Outcomes

- ✅ New documents land in the correct folder on first creation
- ✅ Historical documents are organized consistently
- ✅ No "where is this doc?" friction
- ✅ Obsidian vault structure is scannable and predictable
- ✅ Team members know exactly where to look for any document type

---

## Validation Checklist

Before publishing a document:

- [ ] File is named per the convention above
- [ ] File is in the correct folder per the decision tree
- [ ] File has frontmatter with title, date, tags, owner
- [ ] File starts with H1 heading matching the title in frontmatter
- [ ] File has no broken wikilinks
- [ ] File is not in the root folder (unless `README.md` or config)

---

## Troubleshooting

**Q: I have an old document in the root. Where should it move?**  
A: Check the naming and content:
- Sprint/sprint-like? → `docs/minutes/`
- Audit/review/task report? → `docs/audits/`
- Architecture? → `docs/` (as ARCH-*.md)
- Brand/guide/foundational? → `docs/`

**Q: I don't know what type my document is.**  
A: Describe it in one sentence. If it mentions "sprint", "meeting", "retrospective", or a date → `docs/minutes/`. If it mentions "audit", "review", or "verified" → `docs/audits/`. Otherwise → `docs/`.

**Q: Do I need to update the main README when I add a new document?**  
A: Only if it's a high-level guide or brand material that new operators need on arrival. Sprint/audit docs are self-organizing in their folders. Tell Clarence if you think your doc should be linked from the main index.

---

## Owner & Escalations

**Owner:** Clarence (Documentation Specialist)  
**Escalation:** If you find a document that violates this SOP or you're unsure where something goes, ping Clarence.  
**Review Schedule:** Quarterly (every Q), or immediately if the structure changes.

---

**Status:** ACTIVE  
**Last Audited:** 2026-06-15 (Clarence)
