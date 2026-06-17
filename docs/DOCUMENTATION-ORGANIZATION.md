# Documentation Organization — OpenHiveOS

**Date Updated:** 2026-06-15  
**Status:** Reorganization planned — root docs moved to docs/ subfolders

---

## New Structure

### 📋 `docs/minutes/`
Sprint reports, retrospectives, meeting notes, and release readiness checks. Organized by sprint or date.

**Contents:**
- `S10-FE-10-COMPLETION-SUMMARY.md` — Sprint 10 frontend delivery summary
- `S10-FE-10-RELEASE-SIGN-OFF.md` — Sprint 10 release approval
- `S11-ARCH024-TASKS-1760-1761.md` — Sprint 11 architecture tasks
- `S11-BE-00-FIXES-APPLIED.md` — Sprint 11 backend fixes
- `S12-CLOSURE-REPORT.md` — Sprint 12 closure report
- `S12-RELEASE-READINESS.md` — Sprint 12 release readiness
- `S12-RETROSPECTIVE.md` — Sprint 12 retrospective
- `SPRINT-12-INDEX.md` — Sprint 12 index
- `S14-SCORECARD-METRICS.md` — Sprint 14 scorecard

### 🔍 `docs/audits/`
Security audits, compliance audits, accessibility audits, and task implementation summaries.

**Contents:**
- `TASK-1735-ACCESSIBILITY-AUDIT.md` — Accessibility compliance audit
- `TASK-1763-SYNCWORKER-IMPLEMENTATION.md` — SyncWorker task summary
- `TASK-1797-DS-COMPLIANCE-AUDIT.md` — Design system compliance audit

### 📚 `docs/`
Project-level documentation, brand materials, and foundational guides.

**Contents:**
- `CHANGELOG.md` — Project changelog (moved from root)
- `IOLabs_Visual_Identity_Brief_v1.md` — Brand reference (moved from root)
- `00-inception.md` — Project inception document
- `01-getting-started-install.md` — Installation guide
- `08-agent-onboarding.md` — Agent onboarding guide
- ARCH-*.md — Architectural decision records
- `README.md` — Project overview
- `openapi.yaml` — API specification

---

## Organization Rules

1. **Sprint/Release Reports** → `docs/minutes/`
   - Pattern: `S[N]-*.md` or `SPRINT-*.md`
   
2. **Audit & Compliance Reports** → `docs/audits/`
   - Pattern: `TASK-*-AUDIT.md`, `SECURITY-*.md`, `COMPLIANCE-*.md`
   
3. **Architectural Decisions** → `docs/`
   - Pattern: `ARCH-*.md`
   
4. **General Project Docs** → `docs/`
   - Inception, guides, handbooks, API specs

---

## Execution

To reorganize all root documentation, run:

```bash
cd /Users/richo/Sites/inputoutputco/OpenHiveOS
bash organize-docs.sh
```

The script will:
1. Create `docs/audits/` folder if it doesn't exist
2. Move all sprint reports to `docs/minutes/`
3. Move all audit reports to `docs/audits/`
4. Move general documentation to `docs/`
5. Display confirmation of all moved files

---

## Obsidian Compliance

All moved files follow Obsidian vault standards:
- Frontmatter with metadata tags (date, type, agent)
- Wikilinks for cross-references
- Consistent heading hierarchy (H1 title → H2 sections → H3 subsections)
- Markdown formatting consistent with IO Labs standards

No file reformatting required — only location changes.

---

**Curator:** Clarence  
**Status:** Ready for execution
