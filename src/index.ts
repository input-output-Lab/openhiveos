// Entry point — wired in chore/initial-scaffold.
// OS Primitive tools and Coordination Utility tools are registered here
// once each primitive extraction PR lands (ARCH-007, one PR per primitive).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new McpServer({
  name: 'openhiveos',
  version: '0.1.0',
})

// Primitives registered here — see src/primitives/
// Utilities registered here — see src/utilities/

const transport = new StdioServerTransport()
await server.connect(transport)
