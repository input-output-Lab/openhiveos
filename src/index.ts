// Entry point — OpenHiveOS MCP server boot sequence (ARCH-008 Decisions 4 + 7)
//
// Boot order (6 steps — Decision 7 addendum extends Decision 4's original 5):
//   1. Validate env      (config.ts  — throws on missing vars incl. AGENT_TOKEN)
//   2. Connect DB        (db/client  — throws on connection failure)
//   3. Check fingerprint (db/fingerprint — throws on schema drift)
//   4. Resolve identity  (auth/identity — throws if AGENT_TOKEN unresolvable)
//   5. Start health      (health     — GET /health on HEALTH_PORT)
//   6. Connect MCP       (StdioServerTransport — begins accepting tool calls)
//
// The MCP server never accepts connections unless all prior steps succeed.
// agentSlug is resolved at Step 4 and closed over in all handler registrations.
import './config.js' // Step 1: validate env immediately — throws on missing vars
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { connectDb } from './db/client.js'
import { checkFingerprint } from './db/fingerprint.js'
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

await connectDb()           // Step 2
await checkFingerprint()    // Step 3
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

const transport = new StdioServerTransport()
await server.connect(transport) // Step 6
