// Entry point — OpenHiveOS MCP server boot sequence (ARCH-008 Decisions 4 + 7)
//
// Boot order (7 steps — Decision 7 addendum + ARCH-009 SOP ingest):
//   1.   Validate env      (config.ts  — throws on missing vars incl. AGENT_TOKEN)
//   2.   Connect DB        (db/client  — throws on connection failure)
//   3.   Check fingerprint (db/fingerprint — throws on schema drift)
//   3.5  Check Ethos Seal  (db/ethos-seal — exits if seal absent or drifted, ARCH-013)
//   3.75 SOP ingest        (sops/ingest — upsert seeds/sops/**/*.md, ARCH-009 S8-02)
//   4.   Resolve identity  (auth/identity — throws if AGENT_TOKEN unresolvable)
//   5.   Start health      (health     — GET /health on HEALTH_PORT)
//   6.   Connect MCP       (StdioServerTransport — begins accepting tool calls)
//
// The MCP server never accepts connections unless all prior steps succeed.
// agentSlug is resolved at Step 4 and closed over in all handler registrations.
import { join } from 'node:path'
import './config.js' // Step 1: validate env immediately — throws on missing vars
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { connectDb, pool } from './db/client.js'
import { checkFingerprint } from './db/fingerprint.js'
import { checkEthosSeal } from './db/ethos-seal.js'
import { startHealthServer } from './health.js'
import { resolveIdentity } from './auth/identity.js'
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
import { CronWorker } from './workers/cron.worker.js'
import { ToolDispatcher } from './workers/tool-dispatcher.js'
import { runSopIngest } from './sops/ingest.js'

await connectDb()           // Step 2
await checkFingerprint()    // Step 3
await checkEthosSeal()      // Step 3.5 — exits on absent or drifted seal (ARCH-013 SEC-B8)
await runSopIngest(join(process.cwd(), 'seeds', 'sops')) // Step 3.75 — ARCH-009 S8-02
const agentSlug = await resolveIdentity() // Step 4 — halts process on failure
startHealthServer()         // Step 5

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
server.registerTool('store_memory', { inputSchema: storeMemorySchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleStoreMemory(args, agentSlug)) }],
}))

// search_memory — read
server.registerTool('search_memory', { inputSchema: searchMemorySchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleSearchMemory(args)) }],
}))

// store_thought — write, requires agentSlug
server.registerTool('store_thought', { inputSchema: storeThoughtSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleStoreThought(args, agentSlug)) }],
}))

// ratify_thought — write, requires agentSlug
server.registerTool('ratify_thought', { inputSchema: ratifyThoughtSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleRatifyThought(args, agentSlug)) }],
}))

// query_thoughts — read
server.registerTool('query_thoughts', { inputSchema: queryThoughtsSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleQueryThoughts(args)) }],
}))

// set_disposition — write, requires agentSlug
server.registerTool('set_disposition', { inputSchema: setDispositionSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleSetDisposition(args, agentSlug)) }],
}))

// get_disposition — read
server.registerTool('get_disposition', { inputSchema: getDispositionSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleGetDisposition(args)) }],
}))

// search_sops — read
server.registerTool('search_sops', { inputSchema: searchSopsSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleSearchSops(args)) }],
}))

// ---------------------------------------------------------------------------
// Coordination Utility registrations (migration 002 — ARCH-010)
//
// All write utilities receive agentSlug as their second argument.
// All read utilities that scope results to the calling agent also receive agentSlug.
// ---------------------------------------------------------------------------

// create_project — write, requires agentSlug (SEC-21)
server.registerTool('create_project', { inputSchema: createProjectSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleCreateProject(args, agentSlug)) }],
}))

// update_project — write, requires agentSlug (SEC-21)
server.registerTool('update_project', { inputSchema: updateProjectSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleUpdateProject(args, agentSlug)) }],
}))

// query_projects — read
server.registerTool('query_projects', { inputSchema: queryProjectsSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleQueryProjects(args)) }],
}))

// get_project_board — read, requires agentSlug for scope filter (SEC-24)
server.registerTool('get_project_board', { inputSchema: getProjectBoardSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleGetProjectBoard(args, agentSlug)) }],
}))

// create_task — write, requires agentSlug (SEC-21 pre-flight ownership check)
server.registerTool('create_task', { inputSchema: createTaskSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleCreateTask(args, agentSlug)) }],
}))

// update_task — write, requires agentSlug (SEC-21 ownership in WHERE clause)
server.registerTool('update_task', { inputSchema: updateTaskSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleUpdateTask(args, agentSlug)) }],
}))

// query_tasks — read, requires agentSlug for implicit project scope guard
server.registerTool('query_tasks', { inputSchema: queryTasksSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleQueryTasks(args, agentSlug)) }],
}))

// advance_sprint — write, requires agentSlug (SEC-21 + SEC-23)
server.registerTool('advance_sprint', { inputSchema: advanceSprintSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleAdvanceSprint(args, agentSlug)) }],
}))

// query_sprints — read, caller-scoped (ARCH-011 Decision 2 — returns sprints for
// projects owned by the calling agent only; agentSlug is the authorization predicate)
server.registerTool('query_sprints', { inputSchema: querySprintsSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleQuerySprints(args, agentSlug)) }],
}))

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
server.registerTool('query_crons', { inputSchema: queryCronsSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleQueryCrons(args)) }],
}))

// update_cron — write, requires agentSlug (SEC-26 + SEC-27 + SEC-28 + SEC-29)
server.registerTool('update_cron', { inputSchema: updateCronSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleUpdateCron(args, agentSlug)) }],
}))

// delete_cron — write, requires agentSlug (SEC-29 soft delete)
server.registerTool('delete_cron', { inputSchema: deleteCronSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleDeleteCron(args, agentSlug)) }],
}))

// create_cron — write, requires agentSlug (SEC-26 + SEC-27 + SEC-28 + SEC-29)
server.registerTool('create_cron', { inputSchema: createCronSchema.shape }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleCreateCron(args, agentSlug)) }],
}))

// get_company_ethos — read, no params, squad-wide (ARCH-018 S8-03)
// Returns company identity from the active Ethos Seal payload.
// { configured: false } when company block is absent — not an error.
server.registerTool('get_company_ethos', { inputSchema: getCompanyEthosSchema.shape }, async () => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await handleGetCompanyEthos()) }],
}))

const transport = new StdioServerTransport()
await server.connect(transport) // Step 6

// Step 7: Start cron worker (ARCH-011 G2)
// Dispatcher starts with an empty handler map — handlers are registered as
// tool implementations are added. The architecture is in place; Scout's G2
// tests will verify the poll loop and double-fire guard with a test dispatcher.
const dispatcher = new ToolDispatcher(pool, new Map())
const worker = new CronWorker(pool, dispatcher)
worker.start()
