---
title: "Superseding a Prior Decision — ADR Deprecation Protocol"
version: "1.0.0"
scope: "all"
status: "active"
review_date: "2026-08-20"
tags:
  - type/sop
  - domain/decision
---

When a new architectural decision overrides a prior one, always create a bidirectional supersession trail. A decision that is silently replaced leaves future agents and developers operating on the wrong prior. Incomplete supersession trails are an institutional memory failure.

## The Steps

1. **Author the new ADR** following the ADR Filing Standard (`core/architecture/adr-filing-standard`).
2. **Add the `replaces` field** to the new ADR's frontmatter with the `source_path` of the superseded SOP:

```yaml
replaces: "seeds/sops/core/architecture/old-decision-name.md"
```

3. **Update the superseded ADR's status** to `deprecated` in its frontmatter:

```yaml
status: "deprecated"
```

4. **Add a body reference** to the superseded ADR pointing to the new one:

```markdown
> **Superseded.** This decision was replaced by [ARCH-NNN — New Decision Title](../new-decision-name.md) on YYYY-MM-DD. See that document for the current standard.
```

5. **Do not delete the superseded ADR.** Deprecated records remain in the database and remain searchable. Hard-deletion is reserved for SOPs that contain security-wrong information — it requires a Locksmith flag.

## Why Bidirectional Matters

An agent retrieving the old ADR by cosine similarity will still find it — cosine search has no awareness of supersession. The body reference in the old document is the signal that tells the agent (and future humans) that a newer standard exists. One direction — new references old — is insufficient. Both directions are required.

## SOP vs. ADR Distinction

SOPs are operational rules (how to do something). ADRs are architectural decisions (why something is built the way it is). Both follow this same supersession protocol. Use the `replaces` frontmatter field for SOPs committed to `seeds/sops/`; use the `related` and `status` fields for ADRs filed in `docs/`.
