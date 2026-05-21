---
title: "OS Primitive Extraction — Factory Standard"
version: "1.0.0"
scope: "all"
status: "active"
review_date: "2026-08-20"
tags:
  - type/sop
  - project/openhiveos
  - domain/architecture
  - domain/backend
  - audience/technical
doc_id: "SOP-001"
---

When extracting an OS Primitive from `opensquad-mcp-server` into OpenHiveOS, always follow this process exactly. This is the Factory Standard for Selective Extraction (ARCH-007 Option C). Every primitive enters the codebase through one PR, reviewed against SEC-14 through SEC-20, and merged only after Locksmith signs off. No exceptions.

## Before You Open the PR

Always place the primitive handler in `src/primitives/` — never in `src/utilities/`. The two-tier boundary (ARCH-005) is structural. If you put a primitive in `src/utilities/`, the ESLint `no-restricted-imports` rule will flag it at compile time and the CI gate will fail.

Never import git history from `opensquad-mcp-server`. Port the code manually. The public repository's commit history is the product's origin story — it begins with the scaffold commit and a series of named extractions.

Never accept `agentSlug` from the tool call payload. Identity is resolved at boot from the bearer token and closed over in the handler (ARCH-001). The handler reads `agentSlug` from the boot-time closure — not any field the caller supplied. If you find an `agent_name` parameter anywhere in the extracted code, remove it before the PR opens.

## Extraction Steps

1. Create a feature branch: `feat/extract-[primitive-name]`.
2. Port the primitive handler file to `src/primitives/[name]/index.ts` or `src/primitives/[name].ts`.
3. Register the tool in `src/index.ts` using `server.registerTool()`.
4. Validate all inputs with Zod. No raw request fields reach the database unvalidated.
5. Confirm zero MemPalace references: `grep -r "mempalace" src/` — output must be empty.
6. Confirm zero IO Labs internal references with the SEC-19 `grep` scan.
7. Run the per-primitive CVE scan (Trivy or equivalent) — SEC-17.
8. Open the PR. Tag Locksmith as a required reviewer.

## The Seven Gate Conditions (SEC-14 through SEC-20)

Every primitive PR must pass all of the following before it merges to `main`:

- **SEC-14** — Branch protection is active on `main`.
- **SEC-15** — Secrets scanning pre-commit hook and CI gate are wired.
- **SEC-16** — `timingSafeEqual` is used for all token hash comparisons. Locksmith must sign off — Murphy cannot self-certify.
- **SEC-17** — Dependency CVE scan passes with no high or critical findings.
- **SEC-18** — STRIDE threat model is committed (required once, before the v0.1 tag).
- **SEC-19** — `grep` scan confirms zero internal IO Labs references. This is a hard CI gate.
- **SEC-20** — Rate limiting is documented as a security requirement.

Locksmith's review is a hard merge gate — not advisory. A PR that Locksmith has not approved does not merge.

## Minimal Registration Example

```typescript
// src/index.ts
server.registerTool('store_memory', storeMemoryHandler(agentSlug));
```

The `agentSlug` is resolved once at boot and closed over in the handler. It is never re-read from the request payload.
