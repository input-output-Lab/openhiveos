// Entry point — OpenHiveOS MCP server boot sequence (ARCH-008 Decisions 4 + 7)
//
// Boot order (7 steps — Decision 7 addendum + ARCH-009 SOP ingest):
//   1.   Validate env      (config.ts  — throws on missing vars incl. AGENT_TOKEN)
//   2.   Connect DB        (db/client  — throws on connection failure)
//   3.   Check fingerprint (db/fingerprint — throws on schema drift)
//   3.5  Check Ethos Seal  (db/ethos-seal — exits if seal absent or drifted, ARCH-013)
//   3.6  Check One Seal    (db/one-seal — exits if protocols absent or drifted, ARCH-025)
//   3.75 SOP ingest        (sops/ingest — upsert seeds/sops/**/*.md, ARCH-009 S8-02)
//   4.   Resolve identity  (auth/identity — throws if AGENT_TOKEN unresolvable)
//   5.   Start health      (health     — GET /health on HEALTH_PORT)
//   6.   Connect MCP       (StdioServerTransport — begins accepting tool calls)
//
// The MCP server never accepts connections unless all prior steps succeed.
// agentSlug is resolved at Step 4 and closed over in all handler registrations.
import 'dotenv/config'
import { join } from 'node:path'
import { config } from './config.js' // Step 1: validate env immediately — throws on missing vars
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { connectDb, pool } from './db/client.js'
import { checkFingerprint } from './db/fingerprint.js'
import { checkEthosSeal } from './db/ethos-seal.js'
import { checkOneSeal } from './db/one-seal.js'
import { startHealthServer } from './health.js'
import { resolveIdentity, extractGatewaySlug } from './auth/identity.js'
import { handleGetDisposition, getDispositionSchema } from './primitives/get-disposition.js'
import { handleQueryThoughts, queryThoughtsSchema } from './primitives/query-thoughts.js'
import { handleRatifyThought, ratifyThoughtSchema } from './primitives/ratify-thought.js'
import { handleSearchMemory, searchMemorySchema } from './primitives/search-memory.js'
import { handleSearchSops, searchSopsSchema } from './primitives/search-sops.js'
import { handleSetDisposition, setDispositionSchema } from './primitives/set-disposition.js'
import { handleStoreMemory, storeMemorySchema } from './primitives/store-memory.js'
import { handleStoreThought, storeThoughtSchema } from './primitives/store-thought.js'
import { handleCreateProject, createProjectSchema } from './utilities/create-project.js'
import { handleUpdateProject, updateProjectSchema } from './utilities/update-project.js'
import { handleQueryProjects, queryProjectsSchema } from './utilities/query-projects.js'
import { handleGetProjectBoard, getProjectBoardSchema } from './utilities/get-project-board.js'
import { handleCreateTask, createTaskSchema } from './utilities/create-task.js'
import { handleUpdateTask, updateTaskSchema } from './utilities/update-task.js'
import { handleQueryTasks, queryTasksSchema } from './utilities/query-tasks.js'
import { handleAdvanceSprint, advanceSprintSchema } from './utilities/advance-sprint.js'
import { handleQuerySprints, querySprintsSchema } from './utilities/query-sprints.js'
import { handleCreateCron, createCronSchema } from './utilities/create-cron.js'
import { handleUpdateCron, updateCronSchema } from './utilities/update-cron.js'
import { handleQueryCrons, queryCronsSchema } from './utilities/query-crons.js'
import { handleDeleteCron, deleteCronSchema } from './utilities/delete-cron.js'
import { handleGetCompanyEthos, getCompanyEthosSchema } from './utilities/get-company-ethos.js'
import { handleReportUsage, reportUsageSchema } from './utilities/report-usage.js'
import { CronWorker } from './workers/cron.worker.js'
import { ToolDispatcher } from './workers/tool-dispatcher.js'
import type { ToolHandler } from './workers/tool-dispatcher.js'
import type { RegisteredToolName } from './utilities/tool-registry.js'
import { triggerWorkflowHandler } from './workers/handlers/trigger-workflow.js'
import { taskAgingHandler } from './workers/handlers/task-aging.js'
import { worklogDeriveHandler } from './workers/handlers/worklog-derive.js'
import { runSopIngest } from './sops/ingest.js'

await connectDb()           // Step 2
await checkFingerprint()    // Step 3
await checkEthosSeal()      // Step 3.5 — exits on absent or drifted seal (ARCH-013 SEC-B8)
await checkOneSeal()        // Step 3.6 — exits on absent or drifted One Seal (ARCH-025)
await runSopIngest(join(process.cwd(), 'seeds', 'sops')) // Step 3.75 — ARCH-009 S8-02

// Step 4 — identity resolution
// ARCH-021: in GATEWAY_MODE the subprocess has no AGENT_TOKEN. Identity is
// resolved per-call from __agentSlug injected by the gateway into tool args.
// In standalone mode, resolve once at boot from AGENT_TOKEN (ARCH-008 D7).
const gatewayMode = config.GATEWAY_MODE
const bootSlug: string | null = gatewayMode
  ? null
  : await resolveIdentity() // halts process on failure in standalone mode

if (gatewayMode) {
  console.error('[identity] GATEWAY_MODE: per-call identity resolution active')
} else {
  console.error(`[identity] Standalone mode: agent resolved as "${String(bootSlug)}"`)
}

startHealthServer()         // Step 5

// ---------------------------------------------------------------------------
// resolveCallSlug — returns the agentSlug for a tool invocation.
//
// In GATEWAY_MODE: reads __agentSlug from extra._meta (injected by the
//   gateway into the _meta protocol sideband). Not read from args — the
//   MCP SDK strips unknown keys from args before handlers are invoked.
// In standalone mode: returns the boot-time closed-over slug.
// ---------------------------------------------------------------------------
function resolveCallSlug(extra: { _meta?: Record<string, unknown> }): string {
  if (gatewayMode) {
    return extractGatewaySlug(extra) // reads extra._meta.__agentSlug
  }
  return bootSlug as string
}

const server = new McpServer({
  name: 'openhiveos',
  version: '0.1.0',
})

// ---------------------------------------------------------------------------
// OS Primitive registrations — all gated behind agentSlug closure
//
// Write primitives receive agentSlug as their second argument (server-resolved
// identity — never accepted from the caller per ARCH-001 / ARCH-008 Decision 7).
// Read primitives do not use agentSlug in business logic but still require a
// resolved identity to have reached this point.
// ---------------------------------------------------------------------------

// store_memory — write, requires agentSlug
server.registerTool('store_memory', { description: 'Store a persistent memory entry for the calling agent. Embeds content via Gemini and saves it with optional metadata and task attribution.', inputSchema: storeMemorySchema.shape }, async (args, extra) => {
  const slug = resolveCallSlug(extra)
  return { content: [{ type: 'text' as const, text: JSON.stringify(await handleStoreMemory(args, slug)) }] }
})

// search_memory — read
server.registerTool('search_memory', { description: 'Semantic search over agent memory using vector similarity. Returns the most relevant stored memories for a given query, optionally filtered by agent.', inputSchema: searchMemorySchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleSearchMemory(args)) }],
}))

// store_thought — write, requires agentSlug
server.registerTool('store_thought', { description: 'Record an internal reasoning step before responding. Captures thought type, confidence, raw vs expressed behaviour, disposition snapshot, and an optional counter-thought from The Zero.', inputSchema: storeThoughtSchema.shape }, async (args, extra) => {
  const slug = resolveCallSlug(extra)
  return { content: [{ type: 'text' as const, text: JSON.stringify(await handleStoreThought(args, slug)) }] }
})

// ratify_thought — write, requires agentSlug
server.registerTool('ratify_thought', { description: 'Ratify an auto-persist candidate thought into long-term agent memory. Ratifying agent must differ from the originating agent. Blocked if The Zero has flagged the thought with a block-intensity counter_thought.', inputSchema: ratifyThoughtSchema.shape }, async (args, extra) => {
  const slug = resolveCallSlug(extra)
  return { content: [{ type: 'text' as const, text: JSON.stringify(await handleRatifyThought(args, slug)) }] }
})

// query_thoughts — read
server.registerTool('query_thoughts', { description: 'Browse agent thought history. Filter by agent, session, thought type, must_surface flag, auto_persist_candidate, pending_ratification status, or date range.', inputSchema: queryThoughtsSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleQueryThoughts(args)) }],
}))

// set_disposition — write, requires agentSlug
server.registerTool('set_disposition', { description: 'Update one or more disposition sliders for the calling agent (assertiveness, energy, patience, formality, candor_floor). Changes take effect at the next session.', inputSchema: setDispositionSchema.shape }, async (args, extra) => {
  const slug = resolveCallSlug(extra)
  return { content: [{ type: 'text' as const, text: JSON.stringify(await handleSetDisposition(args, slug)) }] }
})

// get_disposition — read
server.registerTool('get_disposition', { description: 'Fetch the current disposition profile for a registered agent. Returns all five sliders plus the candor_floor.', inputSchema: getDispositionSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleGetDisposition(args)) }],
}))

// search_sops — read
server.registerTool('search_sops', { description: 'Semantic search over Factory SOPs and architectural decisions. Returns the most relevant standard operating procedures for a given query, optionally filtered by category or agent.', inputSchema: searchSopsSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleSearchSops(args)) }],
}))

// ---------------------------------------------------------------------------
// Coordination Utility registrations (migration 002 — ARCH-010)
//
// All write utilities receive agentSlug as their second argument.
// All read utilities that scope results to the calling agent also receive agentSlug.
// ---------------------------------------------------------------------------

// create_project — write, requires agentSlug (SEC-21)
server.registerTool('create_project', { description: 'Create a new project on the Factory board. The calling agent becomes the owner. Slug must be unique. You can also provide initial portfolio matrix scores.', inputSchema: createProjectSchema.shape }, async (args, extra) => {
  const slug = resolveCallSlug(extra)
  return { content: [{ type: 'text' as const, text: JSON.stringify(await handleCreateProject(args, slug)) }] }
})

// update_project — write, portfolio matrix only (S11-BE-03)
// No ownership restriction — tool-assignment is the access gate (ARCH-021).
// Any agent with this tool may update any project's portfolio matrix fields.
server.registerTool('update_project', { description: 'Update portfolio matrix fields (business_value, strategic_fit, effort, risk_index) on any project. All fields use 1/3/5 categorical values. Any authenticated agent may call this tool. Returns the updated project with computed ROI score.', inputSchema: updateProjectSchema.shape }, async (args) => {
  return { content: [{ type: 'text' as const, text: JSON.stringify(await handleUpdateProject(args)) }] }
})

// query_projects — read
server.registerTool('query_projects', { description: 'List projects with optional filters for status, owner agent, or project type. Returns id, slug, name, status, owner, current sprint, health signals, and computed roi_score.', inputSchema: queryProjectsSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleQueryProjects(args)) }],
}))

// get_project_board — read, requires agentSlug for scope filter (SEC-24)
server.registerTool('get_project_board', { description: 'Get a Kanban-style board view for a project showing tasks grouped by status (todo, wip, review, done, rework) with assignee and sprint information.', inputSchema: getProjectBoardSchema.shape }, async (args, extra) => {
  const slug = resolveCallSlug(extra)
  return { content: [{ type: 'text' as const, text: JSON.stringify(await handleGetProjectBoard(args, slug)) }] }
})

// create_task — write, requires agentSlug (SEC-21 pre-flight ownership check)
server.registerTool('create_task', { description: 'Create a new task under a project. The calling agent must own the project. Optionally assign to another agent and supply validation criteria.', inputSchema: createTaskSchema.shape }, async (args, extra) => {
  const slug = resolveCallSlug(extra)
  return { content: [{ type: 'text' as const, text: JSON.stringify(await handleCreateTask(args, slug)) }] }
})

// update_task — write, requires agentSlug (SEC-21 ownership in WHERE clause)
server.registerTool('update_task', { description: 'Update a task status, assignee, notes, or GitHub PR URL. Valid statuses: todo → wip → review → done | rework. The calling agent must own the parent project. Pass project_id to reassign the task to a different project (target project must also be owned by the calling agent).', inputSchema: updateTaskSchema.shape }, async (args, extra) => {
  const slug = resolveCallSlug(extra)
  return { content: [{ type: 'text' as const, text: JSON.stringify(await handleUpdateTask(args, slug)) }] }
})

// query_tasks — read, requires agentSlug for implicit project scope guard
server.registerTool('query_tasks', { description: 'Query tasks with filters for project, assigned agent, status, or free-text search. Returns task details including status, assignee, validation criteria, and GitHub PR URL.', inputSchema: queryTasksSchema.shape }, async (args, extra) => {
  const slug = resolveCallSlug(extra)
  return { content: [{ type: 'text' as const, text: JSON.stringify(await handleQueryTasks(args, slug)) }] }
})

// advance_sprint — write, requires agentSlug (SEC-21 + SEC-23)
server.registerTool('advance_sprint', { description: 'Close the current sprint and open the next one for a project. Sets a new sprint goal. Idempotent — safe to retry. The calling agent must own the project.', inputSchema: advanceSprintSchema.shape }, async (args, extra) => {
  const slug = resolveCallSlug(extra)
  return { content: [{ type: 'text' as const, text: JSON.stringify(await handleAdvanceSprint(args, slug)) }] }
})

// query_sprints — read, caller-scoped (ARCH-011 Decision 2 — returns sprints for
// projects owned by the calling agent only; agentSlug is the authorization predicate)
server.registerTool('query_sprints', { description: 'List sprint history for a project owned by the calling agent. Returns sprint number, goal, and start date in reverse chronological order.', inputSchema: querySprintsSchema.shape }, async (args, extra) => {
  const slug = resolveCallSlug(extra)
  return { content: [{ type: 'text' as const, text: JSON.stringify(await handleQuerySprints(args, slug)) }] }
})

// ---------------------------------------------------------------------------
// Cron Utility registrations (migration 003 — ARCH-011)
//
// All write utilities receive agentSlug as their second argument.
// SEC-26: tool_name validated against REGISTERED_TOOL_NAMES as const (tool-registry.ts)
// SEC-27: payload validated at Zod layer — plain object, ≤16KB, ≤5 nesting levels
// SEC-28: schedule validated via cron-parser at Zod refine before any DB write
// SEC-29: owner_agent_slug server-injected; ownership gate in WHERE clause on writes
// SEC-30: ALLOWED_CRON_FILTERS as const in db/queries/crons.ts
// ---------------------------------------------------------------------------

// query_crons — read, open with filter whitelist (SEC-30)
// Cross-agent enumeration gap documented in ARCH-011 Tech Debt #2 (deferred post-v0.1)
server.registerTool('query_crons', { description: 'List scheduled cron definitions. Filter by project, assigned agent, or status (active, paused, deleted). Returns schedule, tool name, payload, and last_run_at (UTC timestamp or null).', inputSchema: queryCronsSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleQueryCrons(args)) }],
}))

// update_cron — write, requires agentSlug (SEC-26 + SEC-27 + SEC-28 + SEC-29)
server.registerTool('update_cron', { description: 'Update a cron definition — change schedule, tool name, payload, description, or status (active/paused). The calling agent must own the cron.', inputSchema: updateCronSchema.shape }, async (args, extra) => {
  const slug = resolveCallSlug(extra)
  return { content: [{ type: 'text' as const, text: JSON.stringify(await handleUpdateCron(args, slug)) }] }
})

// delete_cron — write, requires agentSlug (SEC-29 soft delete)
server.registerTool('delete_cron', { description: 'Soft-delete a cron definition (sets status to deleted). The record is preserved for audit. The calling agent must own the cron.', inputSchema: deleteCronSchema.shape }, async (args, extra) => {
  const slug = resolveCallSlug(extra)
  return { content: [{ type: 'text' as const, text: JSON.stringify(await handleDeleteCron(args, slug)) }] }
})

// create_cron — write, requires agentSlug (SEC-26 + SEC-27 + SEC-28 + SEC-29)
server.registerTool('create_cron', { description: 'Create a recurring or one-shot scheduled cron. Specify a 5-field cron expression for recurring or a scheduled_at ISO timestamp for one-shot. The calling agent becomes the owner.', inputSchema: createCronSchema.shape }, async (args, extra) => {
  const slug = resolveCallSlug(extra)
  return { content: [{ type: 'text' as const, text: JSON.stringify(await handleCreateCron(args, slug)) }] }
})

// get_company_ethos — read, no params, squad-wide (ARCH-018 S8-03)
// Returns company identity from the active Ethos Seal payload.
// { configured: false } when company block is absent — not an error.
server.registerTool('get_company_ethos', { description: 'Retrieve the company identity block from the active Ethos Seal — name, mission, three-year picture, values, and niche. Returns { configured: false } if company identity has not been initialised.', inputSchema: getCompanyEthosSchema.shape }, async () => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleGetCompanyEthos()) }],
}))

// report_usage — write, ARCH-015 LLM usage ingestion
// Posts LLM token consumption and cost data from Bridge to squad-api /internal/usage.
// Called after each agent loop with model name and cost from VS Code chat footer.
// Returns { success, message, statusCode? }.
server.registerTool('report_usage', { description: 'Publish LLM token consumption and cost data to the OpenHiveOS usage database. Called by Bridge after each agent loop with model and cost values extracted from the VS Code chat footer. Fails gracefully if OPENHIVEOS_INGESTION_TOKEN is not configured.', inputSchema: reportUsageSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleReportUsage(args)) }],
}))

const transport = new StdioServerTransport()
await server.connect(transport) // Step 6

// Step 7: Start cron worker (ARCH-011 G2)
// Dispatcher starts with an empty handler map — handlers are registered as
// tool implementations are added. The architecture is in place; Scout's G2
// tests will verify the poll loop and double-fire guard with a test dispatcher.
const cronHandlers: Map<RegisteredToolName, ToolHandler> = new Map([
  ['trigger_workflow', triggerWorkflowHandler],
  ['task_aging', taskAgingHandler], // S17-BE-02 #2551 — system-actor-only handler
  ['worklog_derive', worklogDeriveHandler], // S17-BE-04 #2552 — system-actor-only handler
])
const dispatcher = new ToolDispatcher(pool, cronHandlers)
const worker = new CronWorker(pool, dispatcher)
worker.start()
