---
title: "Primitive Boundary Enforcement — src/primitives/ vs src/utilities/"
version: "1.0.0"
scope: "all"
status: "active"
review_date: "2026-08-20"
tags:
  - type/sop
  - domain/coding
  - project/openhiveos
---

When adding a new MCP tool handler to OpenHiveOS, always place it in `src/primitives/` — never in `src/utilities/`. This boundary is structural and enforced at compile time, not a naming convention.

## The Rule

Place every MCP tool handler in `src/primitives/`. Register it in `src/index.ts` using `server.registerTool()`. The `src/utilities/` tier is for shared helpers — fingerprinting, BM25 sanitisation, embedding client wrappers — that are called by primitives but never exposed as tools themselves.

`src/utilities/` may not import from `src/primitives/`. If a utility needs logic from a primitive, the dependency direction is wrong. Restructure so the primitive calls the utility, not the reverse.

## How the Boundary Is Enforced

The ESLint `no-restricted-imports` rule in `eslint.config.js` blocks any file under `src/utilities/**` from importing anything under `src/primitives/**`. A violation produces a compile-time error before CI runs. Do not modify or disable this rule — it is a security architecture control defined in ARCH-005, not a style preference.

If the lint gate rejects your import, move the code to the correct tier. The answer is never to relax the rule.

## What Goes Where

| Tier | Directory | Contains |
|---|---|---|
| Primitives | `src/primitives/` | MCP tool handlers: `store_memory`, `search_sops`, `query_thoughts`, etc. |
| Utilities | `src/utilities/` | Shared helpers used by primitives: BM25, sanitiser, DB client wrappers |
| Auth | `src/auth/` | Identity resolution — boot-time only, not a tool |
| Embeddings | `src/embeddings/` | Embedding API client — called by primitives, never registered as a tool |

## Quick Check Before Opening a PR

Run `npm run lint` locally. If it passes and the handler is in `src/primitives/`, the boundary is correct.
