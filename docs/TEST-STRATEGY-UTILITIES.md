# Utilities Test Consolidation Strategy — Scout Coverage Plan

**Date:** June 8, 2026  
**Objective:** Define comprehensive test strategy for 12 coordination utilities to reach **85% line / 65% branch coverage** in a consolidated `tests/utilities/utilities.test.ts`  
**Target:** P1 service tier (active production application)

---

## Executive Summary

**Current State:**
- 59 test cases spread across 3 files (handlers.test.ts, update-task.test.ts, query-crons.test.ts)
- Partial coverage of handlers; strong schema validation coverage in separate files
- Gap: Error paths, edge cases, boundary conditions

**Required Deliverable:**
- **Consolidated file:** `tests/utilities/utilities.test.ts` (single source of truth)
- **Test count:** ~240 test cases (grouped by utility)
- **Coverage gates:** 85% line / 65% branch across all 12 utilities
- **Effort estimate:** 50-60 hours (consolidation + new tests + regression validation)

---

## 1. Coverage Gap Analysis by Utility

### 1.1 advance-sprint.ts

**Current coverage:** 4 tests (TC-H1 to TC-H4)

**Happy paths:**
- ✓ Success with no sprint_goal
- ✓ Success with sprint_goal provided
- ✓ Unauthorized (not project owner)
- ✓ Conflict (concurrent advance, idempotency guard)

**Missing error paths:**
- [ ] DB error (500 from query layer)
- [ ] Invalid schema (project_id ≤ 0, sprint_goal too long)
- [ ] Null project_id
- [ ] Empty sprint_goal string (allowed by schema, but semantically odd)

**Missing edge cases:**
- [ ] Sprint goal at exactly 2000 chars (boundary)
- [ ] Very long sprint_goal (>2000, schema rejection)
- [ ] Concurrent advance with different agents on same project

**Test count target:** **12 tests**
- 4 existing (keep as-is)
- 5 new error/boundary tests
- 3 new edge case tests

**Coverage priorities (must branch):**
1. `result.kind === 'unauthorized'` path
2. `result.kind === 'conflict'` path
3. `result.kind === 'success'` path (with and without sprint_goal)
4. Schema validation rejection

---

### 1.2 create-cron.ts

**Current coverage:** 4 handler tests + 6 validatePayload tests in handlers.test.ts

**Happy paths:**
- ✓ Success with all fields (name, description, schedule, tool_name, payload)
- ✓ Success with minimal fields (only required)
- ✓ Unauthorized (project not owned)
- ✓ Invalid cron schedule (schema rejection, SEC-28)
- ✓ Invalid tool_name (SEC-26)

**Missing error paths:**
- [ ] Payload validation rejection: array instead of object
- [ ] Payload validation rejection: null
- [ ] Payload validation rejection: >16KB serialized
- [ ] Payload validation rejection: >5 nesting levels
- [ ] Invalid project_id (≤0)
- [ ] Empty name
- [ ] Name too long (>200)
- [ ] Description too long (>1000)
- [ ] Schedule expression boundary (valid vs. invalid edge cases)
- [ ] Tool name not in REGISTERED_TOOL_NAMES
- [ ] Payload with 5 levels (should pass, boundary)
- [ ] Payload with 6 levels (should fail, boundary)

**Missing edge cases:**
- [ ] Cron expression with timezone specifier (if cron-parser supports)
- [ ] Special cron characters (@hourly, @daily, etc.)
- [ ] Empty description string
- [ ] Payload with 16,384 bytes exactly (boundary)
- [ ] Payload with 16,385 bytes (should fail)

**Test count target:** **22 tests**
- 4 existing handler tests (keep)
- 6 existing validatePayload tests (keep)
- 12 new tests (payload boundaries, schedule edge cases, tool allowlist)

**Coverage priorities (must branch):**
1. `result.authorized === true` path
2. `result.authorized === false` path
3. Schema validation paths (schedule, tool_name, payload)
4. validatePayload boundaries (nesting depth, size)

---

### 1.3 create-project.ts

**Current coverage:** 3 tests (TC-H9 to TC-H11)

**Happy paths:**
- ✓ Success with minimal fields
- ✓ Success with description

**Missing error paths:**
- [ ] Slug too short (<2 chars)
- [ ] Slug too long (>80 chars)
- [ ] Slug with uppercase (schema rejection)
- [ ] Slug with special chars (#, @, etc.)
- [ ] Slug starting with hyphen
- [ ] Slug ending with hyphen
- [ ] Slug with double hyphens
- [ ] Name too long (>200)
- [ ] Empty name
- [ ] Description too long (>2000)
- [ ] DB constraint violation (duplicate slug) — if desired to test DB path

**Missing edge cases:**
- [ ] Slug at exactly 2 chars (boundary)
- [ ] Slug at exactly 80 chars (boundary)
- [ ] Slug with all numbers (valid)
- [ ] Slug with all hyphens between alphanumerics (valid: "a-b-c")
- [ ] Name at exactly 200 chars (boundary)
- [ ] Description at exactly 2000 chars (boundary)

**Test count target:** **9 tests**
- 3 existing (keep)
- 6 new (boundary validation, error paths)

**Coverage priorities (must branch):**
1. Success path
2. Schema validation rejection (slug pattern, length, name, description)

---

### 1.4 create-task.ts

**Current coverage:** 3 tests (TC-H12 to TC-H14)

**Happy paths:**
- ✓ Success with minimal fields
- ✓ Success with all optional fields
- ✓ Unauthorized (project not owned)
- ✓ Invalid assignee_slug

**Missing error paths:**
- [ ] Empty title
- [ ] Title too long (>500)
- [ ] Description too long (>5000)
- [ ] Invalid URL in github_pr_url (not a valid URL)
- [ ] Non-URL string (schema rejection)
- [ ] Notes too long (>5000)
- [ ] Project_id ≤ 0
- [ ] DB error from query layer
- [ ] Assignee slug provided but invalid
- [ ] Assignee slug not in manifest

**Missing edge cases:**
- [ ] Title at exactly 500 chars (boundary)
- [ ] Description at exactly 5000 chars (boundary)
- [ ] Notes at exactly 5000 chars (boundary)
- [ ] github_pr_url with query params, fragments, ports
- [ ] Assignee as valid agent slug
- [ ] All optional fields present

**Test count target:** **14 tests**
- 3 existing (keep)
- 11 new (error paths, boundaries, valid assignee)

**Coverage priorities (must branch):**
1. `result.authorized === true` path
2. `result.authorized === false` path
3. Schema validation (assignee slug, URL, title, description, notes)

---

### 1.5 delete-cron.ts

**Current coverage:** 3 tests (TC-H15 to TC-H17)

**Happy paths:**
- ✓ Success (soft delete, status→'deleted')
- ✓ Already deleted (idempotent error)
- ✓ Not found or unauthorized (access control)

**Missing error paths:**
- [ ] ID ≤ 0 (schema rejection)
- [ ] ID as negative number
- [ ] ID as non-integer (schema rejection)
- [ ] DB error from query layer
- [ ] Cron belonging to different agent

**Missing edge cases:**
- [ ] Deleting a cron that was just created
- [ ] Double-delete attempt (already_deleted state)
- [ ] Concurrent delete (if relevant to idempotency)

**Test count target:** **7 tests**
- 3 existing (keep)
- 4 new (schema rejection, edge cases)

**Coverage priorities (must branch):**
1. `result.kind === 'success'` path
2. `result.kind === 'already_deleted'` path
3. `result.kind === 'not_found_or_unauthorized'` path
4. Schema validation (ID must be positive int)

---

### 1.6 query-crons.ts

**Current coverage:** 3 handler tests (TC-H20 to TC-H22) + 6 schema tests in query-crons.test.ts

**Happy paths:**
- ✓ Empty filter object
- ✓ All valid optional filters (project_id, status, owner_agent_slug)
- ✓ Subset of filters
- ✓ Rejects unknown keys (.strict())
- ✓ Rejects invalid status

**Missing error paths:**
- [ ] Project_id ≤ 0
- [ ] Project_id as non-integer
- [ ] Status as invalid enum
- [ ] Owner_agent_slug as empty string
- [ ] Owner_agent_slug too long (>100)
- [ ] Multiple unknown keys
- [ ] Combining valid and invalid filters
- [ ] DB error from query layer

**Missing edge cases:**
- [ ] Project_id at exactly 1 (minimum positive)
- [ ] Owner_agent_slug at exactly 1 char (minimum)
- [ ] Owner_agent_slug at exactly 100 chars (maximum)
- [ ] Filtering by multiple statuses (if multi-select desired)
- [ ] Deleted crons visibility (soft delete filtering)

**Test count target:** **15 tests**
- 3 existing handler tests (keep)
- 6 existing schema tests (keep, migrate to consolidated file)
- 6 new (boundary validation, multi-filter combinations, DB errors)

**Coverage priorities (must branch):**
1. `queryCronsSchema.parse()` success paths
2. `.strict()` rejection on unknown keys
3. Schema validation rejection (project_id, status, owner_agent_slug)
4. Handler call to db.queryCrons with correct filters

---

### 1.7 query-projects.ts

**Current coverage:** 2 tests (TC-H23 to TC-H24)

**Happy paths:**
- ✓ Empty filter object
- ✓ Status filter ('active', 'archived')
- ✓ Owner_agent_slug filter

**Missing error paths:**
- [ ] Invalid status ('deleted' not allowed)
- [ ] Owner_agent_slug provided but invalid
- [ ] Combining status + owner_agent_slug
- [ ] DB error from query layer

**Missing edge cases:**
- [ ] Empty result set
- [ ] Cross-agent project enumeration (SEC-ACCEPTED-F2)
- [ ] Large result set behavior

**Test count target:** **7 tests**
- 2 existing (keep)
- 5 new (error paths, multi-filter, edge cases)

**Coverage priorities (must branch):**
1. Schema validation (status enum)
2. Handler call with correct filters
3. Success path returning array

---

### 1.8 query-sprints.ts

**Current coverage:** 2 tests (TC-H25 to TC-H26)

**Happy paths:**
- ✓ Empty filter object
- ✓ Project_id filter
- ✓ Sprint_number filter
- ✓ Caller scoping (agentSlug passed to DB)

**Missing error paths:**
- [ ] Project_id ≤ 0
- [ ] Sprint_number ≤ 0
- [ ] Project_id and sprint_number combined
- [ ] DB error from query layer
- [ ] Access denied (caller doesn't own project) — DB path

**Missing edge cases:**
- [ ] Sprint_number at exactly 1 (first sprint)
- [ ] Large sprint_number (boundary)
- [ ] No sprints for project_id
- [ ] All sprints for a project

**Test count target:** **8 tests**
- 2 existing (keep)
- 6 new (error paths, boundaries, scoping)

**Coverage priorities (must branch):**
1. Schema validation (project_id, sprint_number)
2. Caller scoping (agentSlug always passed)
3. Handler call with correct filters

---

### 1.9 query-tasks.ts

**Current coverage:** 2 tests (TC-H27 to TC-H28)

**Happy paths:**
- ✓ Empty filter object
- ✓ Status filter
- ✓ Assignee_agent_slug filter
- ✓ Multiple filters
- ✓ Caller scoping (agentSlug passed to DB)

**Missing error paths:**
- [ ] Project_id ≤ 0
- [ ] Invalid status ('deleted' not allowed)
- [ ] Assignee_agent_slug not in manifest
- [ ] Invalid assignee slug
- [ ] DB error from query layer

**Missing edge cases:**
- [ ] All status values tested
- [ ] Empty result set
- [ ] Tasks across multiple projects
- [ ] Assignee scoping (implicit data isolation)

**Test count target:** **9 tests**
- 2 existing (keep)
- 7 new (status values, invalid assignee, error paths)

**Coverage priorities (must branch):**
1. Schema validation (status enum, project_id, assignee slug)
2. Caller scoping enforcement
3. Handler call with correct filters

---

### 1.10 update-cron.ts

**Current coverage:** 4 handler tests + 6 validatePayload tests in handlers.test.ts

**Happy paths:**
- ✓ Update name only
- ✓ Update description only
- ✓ Update schedule only
- ✓ Update tool_name only
- ✓ Update payload only
- ✓ Update status only
- ✓ Update multiple fields
- ✓ Unauthorized (not cron owner)
- ✓ Schedule validation (SEC-28)
- ✓ Tool_name validation (SEC-26)
- ✓ Payload validation (SEC-27)
- ✓ Payload=null clears field

**Missing error paths:**
- [ ] ID ≤ 0
- [ ] ID as non-integer
- [ ] Name too long (>200)
- [ ] Description too long (>1000)
- [ ] Schedule invalid
- [ ] Tool_name not in allowlist
- [ ] Payload >16KB
- [ ] Payload >5 nesting levels
- [ ] Invalid status (not 'active' or 'paused')
- [ ] Attempting to set status='deleted' (only delete_cron allowed)
- [ ] DB error from query layer
- [ ] No fields provided (empty update)

**Missing edge cases:**
- [ ] Name at exactly 200 chars (boundary)
- [ ] Description at exactly 1000 chars (boundary)
- [ ] Empty name string (>0 required)
- [ ] Payload at exactly 16,384 bytes (boundary)
- [ ] Payload at exactly 5 nesting levels (boundary)
- [ ] Schedule with special cron syntax
- [ ] Clearing optional fields (set to null)

**Test count target:** **23 tests**
- 4 existing handler tests (keep)
- 6 existing validatePayload tests (keep)
- 13 new (error paths, boundaries, field combinations)

**Coverage priorities (must branch):**
1. `result.kind === 'success'` path
2. `result.kind === 'not_found_or_unauthorized'` path
3. Schema validation (all fields: name, description, schedule, tool_name, payload, status)
4. validatePayload boundaries (nesting, size)
5. Payload=null handling

---

### 1.11 update-project.ts

**Current coverage:** 3 tests (TC-H39 to TC-H41)

**Happy paths:**
- ✓ Update name
- ✓ Update description
- ✓ Update status
- ✓ Update multiple fields
- ✓ Unauthorized (not project owner)

**Missing error paths:**
- [ ] Project_id ≤ 0
- [ ] Name too long (>200)
- [ ] Description too long (>2000)
- [ ] Invalid status (not 'active' or 'archived')
- [ ] DB error from query layer
- [ ] No fields provided (empty update)

**Missing edge cases:**
- [ ] Name at exactly 200 chars (boundary)
- [ ] Description at exactly 2000 chars (boundary)
- [ ] Empty name string (allowed by schema, update to empty)
- [ ] Clearing description (set to null or empty)
- [ ] Status transitions (active→archived, archived→active)

**Test count target:** **10 tests**
- 3 existing (keep)
- 7 new (error paths, boundaries, status transitions)

**Coverage priorities (must branch):**
1. Success path (`result` truthy)
2. Unauthorized path (`result === undefined`)
3. Schema validation (project_id, name, description, status)

---

### 1.12 update-task.ts

**Current coverage:** 12 tests in update-task.test.ts (Model C field gate)

**Happy paths:**
- ✓ Status-only update (assignee can do this)
- ✓ All fields update (owner only)
- ✓ Field gate logic (allowAssigneePath computed correctly)
- ✓ Unassign flag
- ✓ URL validation

**Missing error paths:**
- [ ] Task_id ≤ 0
- [ ] Invalid status
- [ ] Invalid assignee_slug
- [ ] Title too long (>500)
- [ ] Description too long (>5000)
- [ ] Notes too long (>5000)
- [ ] Invalid github_pr_url
- [ ] DB error from query layer (unauthorized, not found)
- [ ] Task not owned or assigned to caller

**Missing edge cases:**
- [ ] Title at exactly 500 chars (boundary)
- [ ] Description at exactly 5000 chars (boundary)
- [ ] Notes at exactly 5000 chars (boundary)
- [ ] Unassign=true AND assignee_agent_slug provided (which wins?)
- [ ] Status-only update from non-owner assignee
- [ ] Update to 'rework' status (valid task state)
- [ ] Concurrent status update (idempotency)

**Test count target:** **22 tests**
- 12 existing (keep, field gate logic)
- 10 new (boundary validation, error paths, edge cases)

**Coverage priorities (must branch):**
1. `allowAssigneePath === true` path (status-only)
2. `allowAssigneePath === false` path (owner-only fields)
3. Success path (`result` truthy)
4. Unauthorized path (`result === undefined`)
5. Schema validation (task_id, status, assignee, URLs, text fields)
6. Model C gate logic (verified by existing 12 tests)

---

## 2. Test Organization Plan

### 2.1 Consolidated File Structure

**File:** `tests/utilities/utilities.test.ts` (single source of truth)

**Organization:**
```typescript
// tests/utilities/utilities.test.ts

// 1. Imports & Mock Setup (shared across all utilities)
//    - All vi.mock() hoisted before imports
//    - All db module mocks
//    - All helper imports

// 2. Constants & Fixtures
//    - AGENT, SCHEDULE, TOOL (shared test constants)
//    - Stub objects (stubTask, stubCron, stubProject, stubSprint)

// 3. Per-Utility Test Suites (organized by handler)
describe('advance-sprint', () => { /* 12 tests */ })
describe('create-cron', () => { /* 22 tests */ })
describe('create-project', () => { /* 9 tests */ })
describe('create-task', () => { /* 14 tests */ })
describe('delete-cron', () => { /* 7 tests */ })
describe('query-crons', () => { /* 15 tests */ })
describe('query-projects', () => { /* 7 tests */ })
describe('query-sprints', () => { /* 8 tests */ })
describe('query-tasks', () => { /* 9 tests */ })
describe('update-cron', () => { /* 23 tests */ })
describe('update-project', () => { /* 10 tests */ })
describe('update-task', () => { /* 22 tests */ })

// 4. Shared Validator Tests (currently in separate section)
describe('validatePayload', () => { /* 6 tests */ })

// 5. Schema Validation Tests (from query-crons.test.ts)
describe('queryCronsSchema (.strict())', () => { /* 6 tests */ })
```

### 2.2 Mock Organization

**Mocks to hoist (before all imports):**
```typescript
vi.mock('../../src/db/queries/tasks.js', () => ({ ... }))
vi.mock('../../src/db/queries/crons.js', () => ({ ... }))
vi.mock('../../src/db/queries/projects.js', () => ({ ... }))
vi.mock('../../src/db/queries/sprints.js', () => ({ ... }))
vi.mock('../../src/squad/manifest.js', () => ({ isValidAgentSlug: vi.fn(...) }))
```

**Mocks to configure per-suite:**
```typescript
beforeEach(() => {
  vi.clearAllMocks()
  // Set default mock return values
})
```

### 2.3 Fixture Strategy

**Shared stub objects (reusable across suites):**
```typescript
const stubTask = { id: 42, project_id: 1, ... }
const stubCron = { id: 10, project_id: 1, owner_agent_slug: AGENT, ... }
const stubProject = { id: 5, slug: 'my-project', ... }
const stubSprint = { id: 1, project_id: 1, sprint_number: 1, ... }
```

**Factory functions for variants:**
```typescript
const taskWith = (overrides: Partial<Task>) => ({ ...stubTask, ...overrides })
const cronWith = (overrides: Partial<Cron>) => ({ ...stubCron, ...overrides })
```

### 2.4 Test Naming Convention

**Format:** `TC-U<utility-number>-<test-number>: <description>`

Examples:
- `TC-U1-1: advance-sprint returns not_found_or_unauthorized when db returns unauthorized`
- `TC-U2-5: create-cron rejects payload >16KB at schema level`
- `TC-U12-8: update-task rejects title >500 chars at schema level`

**Utility numbering:**
1. advance-sprint
2. create-cron
3. create-project
4. create-task
5. delete-cron
6. query-crons
7. query-projects
8. query-sprints
9. query-tasks
10. update-cron
11. update-project
12. update-task

---

## 3. Coverage Targets by Utility

| Utility | Current | Target | New Tests | Line Goal | Branch Goal | Priority |
|---------|---------|--------|-----------|-----------|-------------|----------|
| advance-sprint | 4 | 12 | +8 | 100% | 85% | 1 |
| create-cron | 10 | 22 | +12 | 100% | 85% | 1 |
| create-project | 3 | 9 | +6 | 100% | 75% | 2 |
| create-task | 3 | 14 | +11 | 100% | 80% | 1 |
| delete-cron | 3 | 7 | +4 | 100% | 90% | 2 |
| query-crons | 9 | 15 | +6 | 100% | 80% | 1 |
| query-projects | 2 | 7 | +5 | 95% | 75% | 3 |
| query-sprints | 2 | 8 | +6 | 95% | 75% | 3 |
| query-tasks | 2 | 9 | +7 | 95% | 75% | 3 |
| update-cron | 10 | 23 | +13 | 100% | 85% | 1 |
| update-project | 3 | 10 | +7 | 100% | 80% | 2 |
| update-task | 12 | 22 | +10 | 100% | 85% | 1 |
| **TOTAL** | **59** | **157** | **+98** | **~98%** | **~81%** | |

**Note:** Schema validation tests (queries) may achieve 95% line due to nature of optional filtering. Reconcile against actual instrument report.

---

## 4. Critical Paths — Must Have Branch Coverage

### By Utility:

**advance-sprint (3 branches):**
1. `result.kind === 'unauthorized'`
2. `result.kind === 'conflict'`
3. `result.kind === 'success'`

**create-cron (2 branches):**
1. `result.authorized === true`
2. `result.authorized === false`

**create-project (1 branch):**
1. Return project (no error path)

**create-task (2 branches):**
1. `result.authorized === true`
2. `result.authorized === false`

**delete-cron (3 branches):**
1. `case 'not_found_or_unauthorized'`
2. `case 'already_deleted'`
3. `case 'success'`

**query-crons (schema validation, 2 branches at handler level):**
1. Handler calls db.queryCrons with correct filters
2. Returns array from db

**query-projects (1 branch):**
1. Return array from db

**query-sprints (1 branch):**
1. Return array from db

**query-tasks (1 branch):**
1. Return array from db

**update-cron (2 branches):**
1. `result.kind === 'success'`
2. `result.kind === 'not_found_or_unauthorized'`

**update-project (2 branches):**
1. `result` truthy (success)
2. `result === undefined` (unauthorized)

**update-task (4 branches — Model C field gate, already tested):**
1. `allowAssigneePath === true` (status-only update)
2. `allowAssigneePath === false` (owner-only fields present)
3. `result` truthy (success)
4. `result === undefined` (unauthorized)

---

## 5. Consolidation Process

### Phase 1: Setup (1-2 hours)

1. **Create** `tests/utilities/utilities.test.ts` (new consolidated file)
2. **Copy** all imports, mocks, and constants from existing files
3. **Dedup** shared mock definitions (all three files mock db query modules)
4. **Dedup** shared constants (AGENT, SCHEDULE, TOOL)
5. **Dedup** shared stub objects (task, cron, project, sprint)

### Phase 2: Migration (2-3 hours)

1. **Move** all TC-H* tests from `handlers.test.ts` into utilities.test.ts
2. **Move** all tests from `update-task.test.ts` into utilities.test.ts (under update-task suite)
3. **Move** all tests from `query-crons.test.ts` into utilities.test.ts (under query-crons suite)
4. **Rename** tests to TC-U* format to establish single ID space
5. **Verify** no test names collide or duplicate

### Phase 3: New Tests (35-40 hours)

**Recommended order of implementation:**
1. **Tier 1 (Critical path, 6 hours):** advance-sprint, create-cron, update-cron, update-task, query-crons
2. **Tier 2 (Medium complexity, 8 hours):** create-task, create-project, update-project, delete-cron
3. **Tier 3 (Simple, 3 hours):** query-projects, query-sprints, query-tasks

**Per-utility effort estimate:**
- Simple (query-*, delete-cron): 20-30 min per utility
- Medium (create-*, update-*): 45-60 min per utility
- Complex (with validators, boundaries): 60-90 min per utility

### Phase 4: Regression Testing (2-3 hours)

1. **Run** `npm test tests/utilities/utilities.test.ts`
2. **Verify** all 157+ tests pass
3. **Compare** coverage reports:
   - Before: handlers.test.ts, update-task.test.ts, query-crons.test.ts (separate)
   - After: utilities.test.ts (consolidated)
   - **Must match or exceed** per-utility line/branch percentages
4. **Delete** old test files:
   - `tests/utilities/handlers.test.ts`
   - `tests/utilities/update-task.test.ts`
   - `tests/utilities/query-crons.test.ts`

### Phase 5: CI/CD Gate (1 hour)

1. **Configure** coverage thresholds in vitest.config.ts:
   ```typescript
   coverage: {
     lines: 85,
     branches: 65,
     functions: 85,
     statements: 85,
     include: ['src/utilities/**/*.ts'],
   }
   ```
2. **Add** coverage check to GitHub Actions (if not present)
3. **Verify** PR gate blocks merges below thresholds

---

## 6. Test Writing Guidelines

### 6.1 Happy Path Tests

**Pattern:**
```typescript
it('TC-U1-1: advance-sprint returns sprint on success', async () => {
  const sprint = { id: 1, project_id: 1, sprint_number: 1, ... }
  mockAdvanceSprint.mockResolvedValue({ kind: 'success', sprint })

  const result = await handleAdvanceSprint({ project_id: 1 }, AGENT)

  expect(result).toEqual(sprint)
  expect(mockAdvanceSprint).toHaveBeenCalledWith(
    expect.objectContaining({ project_id: 1, owner_agent_slug: AGENT })
  )
})
```

### 6.2 Error Path Tests

**Pattern:**
```typescript
it('TC-U2-5: create-cron returns not_found_or_unauthorized when db returns unauthorized', async () => {
  mockCreateCron.mockResolvedValue({ authorized: false })

  const result = await handleCreateCron(
    { project_id: 1, name: 'X', schedule: SCHEDULE, tool_name: TOOL },
    AGENT
  )

  expect(result).toMatchObject({ error: 'not_found_or_unauthorized' })
  expect(mockCreateCron).toHaveBeenCalled()
})
```

### 6.3 Schema Validation Tests

**Pattern:**
```typescript
it('TC-U3-2: create-project rejects slug with uppercase', () => {
  expect(() => {
    handleCreateProject({ slug: 'My-Project', name: 'Bad' }, AGENT)
  }).rejects.toThrow()
})
```

### 6.4 Boundary Tests

**Pattern:**
```typescript
it('TC-U2-11: create-cron accepts payload at exactly 16KB (boundary)', async () => {
  const payload = { data: 'x'.repeat(16_384 - 10) } // Exactly 16KB serialized
  const cron = { ...stubCron }
  mockCreateCron.mockResolvedValue({ authorized: true, cron })

  await expect(
    handleCreateCron(
      { project_id: 1, name: 'X', schedule: SCHEDULE, tool_name: TOOL, payload },
      AGENT
    )
  ).resolves.toBeDefined()
})
```

### 6.5 Field Gate / Permission Tests (update-task specific)

**Pattern:** (already well-covered in existing update-task.test.ts, migrate as-is)
```typescript
it('TC-U12-5: update-task sets allowAssigneePath=false when assignee_agent_slug provided', async () => {
  await handleUpdateTask({ task_id: 1, assignee_agent_slug: 'murphy' }, 'elizabeth')

  expect(mockUpdateTask).toHaveBeenCalledWith(
    expect.objectContaining({ allowAssigneePath: false })
  )
})
```

---

## 7. Merge Gate Criteria

### 7.1 Coverage Thresholds (P1 Service Tier)

**Utility-level requirements:**
- **Lines:** ≥85% for all utilities
- **Branches:** ≥65% for all utilities  
- **Functions:** ≥85% for all utilities
- **Statements:** ≥85% for all utilities

**Acceptable exceptions:**
- Schema validation branches (Zod enum parsing) may achieve 80% branch if happy/unhappy paths covered
- Query handlers (read-only, no error path) may achieve 95% line if filtering tested

**Non-negotiable:**
- ALL error paths must be tested (unauthorized, not_found, invalid input)
- ALL required fields must have boundary tests (min/max length, allowed values)
- ALL enum fields must test all enum values OR explicit decision document why not

### 7.2 Test Quality Criteria

**Each test must:**
1. Have a unique TC-U identifier
2. Test ONE logical behavior (assertion may have 2-3 expectations)
3. Have a descriptive name reflecting the behavior, not implementation
4. Mock only dependencies, never internals
5. Assert on return values AND mock call arguments (double-check)
6. Include a comment explaining WHY if testing a security gate or boundary

**Each test file/suite must:**
1. Have a brief comment explaining its scope
2. Deduplicate fixtures (use stub objects)
3. Have a beforeEach() that clears mocks (if mutable state)
4. Avoid test interdependencies (each test must run independently)

### 7.3 Release Readiness Checklist

Before closing Task 1719:

- [ ] All 157 tests pass locally (`npm test tests/utilities/utilities.test.ts`)
- [ ] Coverage report shows ≥85% line, ≥65% branch for all utilities
- [ ] All TC-U identifiers assigned (U1-1 through U12-22)
- [ ] `handlers.test.ts`, `update-task.test.ts`, `query-crons.test.ts` deleted
- [ ] No circular imports or mock conflicts
- [ ] TypeScript type-checking passes (`npm run typecheck`)
- [ ] ESLint passes (`npm run lint`)
- [ ] No skipped tests (no `it.skip()` or `.skip` marks)
- [ ] All pending tests converted to passing or explicitly documented
- [ ] Coverage gate configured in vitest.config.ts
- [ ] GitHub Actions CI updated (if using matrix testing)

---

## 8. Effort Breakdown

| Phase | Estimate | Owner |
|-------|----------|-------|
| **Phase 1: Setup** | 1-2 hrs | Murphy |
| **Phase 2: Migration** | 2-3 hrs | Murphy |
| **Phase 3a: Tier 1 new tests** | 6 hrs | Murphy |
| **Phase 3b: Tier 2 new tests** | 8 hrs | Murphy |
| **Phase 3c: Tier 3 new tests** | 3 hrs | Murphy |
| **Phase 4: Regression testing** | 2-3 hrs | Murphy |
| **Phase 5: CI/CD gate setup** | 1 hr | Murphy |
| **Scout review & sign-off** | 1.5 hrs | Scout |
| **TOTAL** | **25-27 hours** | |

**Expected sprint load:** 1 full sprint for one developer (Murphy), with Scout review gate at end.

---

## 9. Risk & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| Mock state pollution (test interdependencies) | Medium | High | Use `beforeEach(() => vi.clearAllMocks())` in every suite |
| Coverage drop on migration | Low | High | Compare coverage reports before/after; verify per-utility line/branch match |
| Duplicate test IDs (TC-U* collision) | Low | Medium | Use systematic numbering: TC-U<utility>-<sequence>; audit all IDs before commit |
| Payload boundary tests fail (16KB hard to construct) | Medium | Low | Use factory function to generate exact-size payloads; test in isolation first |
| Existing tests break during consolidation | Medium | High | Run full test suite after each migration phase; don't move all tests at once |
| Schema validation coverage unclear (Zod internals) | Low | Medium | Instrument with explicit test for each enum value and boundary in Zod schemas |

---

## 10. Post-Implementation Maintenance

### When to update this plan:

1. **New utility added to src/utilities/:** Add row to coverage table, define test count target
2. **Coverage threshold changes:** Update Section 7.1 with new targets
3. **Schema changes in utilities:** Update Section 1 coverage gap analysis
4. **New error path discovered in production:** Add test case immediately (regression prevention)

### Coverage regression detector:

Monitor in each L10 sprint:
- Coverage trend (if <85% line or <65% branch, add tests before sprint closes)
- Test execution time (if >30sec total, optimize with selective mocking)
- Flaky tests (if any test passes/fails randomly, fix root cause)

---

## Appendix: Test Template

```typescript
// Test template for new test case
it('TC-U<utility>-<number>: <description of behavior>', async () => {
  // ARRANGE: Set up mocks, inputs, expected values
  const mockReturnValue = { ...stubCron, name: 'Updated' }
  mockUpdateCron.mockResolvedValue({ kind: 'success', cron: mockReturnValue })

  // ACT: Call the handler
  const result = await handleUpdateCron({ id: 5, name: 'Updated' }, AGENT)

  // ASSERT: Verify return value
  expect(result).toEqual(mockReturnValue)

  // ASSERT: Verify mock was called correctly
  expect(mockUpdateCron).toHaveBeenCalledWith(
    expect.objectContaining({ id: 5, name: 'Updated', owner_agent_slug: AGENT })
  )
})
```

---

**Document prepared by:** Scout (Quality Assurance Lead)  
**Status:** Ready for implementation by Murphy  
**Next step:** Murphy implements Phase 1-5; Scout reviews coverage report and signs off
