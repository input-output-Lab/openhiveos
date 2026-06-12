require('dotenv').config();
/**
 * PM2 Ecosystem Configuration — OpenHiveOS
 * 
 * Services:
 *   1. squad-api      — Dashboard HTTP server (port 3005)
 *   2. mcp-gateway    — MCP bridge (port 3008)
 *
 * The gateway internally spawns dist/index.js as a subprocess via
 * StdioClientTransport. No separate PM2 process for that.
 *
 * Start:     pm2 start ecosystem.config.cjs
 * Restart:   pm2 restart all
 * Logs:      pm2 logs
 * Status:    pm2 status
 * Stop:      pm2 stop all
 * Delete:    pm2 delete ecosystem
 * 
 * Boot persistence:
 *   pm2 startup
 *   pm2 save
 */

module.exports = {
  apps: [
    {
      // -----------------------------------------------------------------------
      // Squad API — HTTP server for operator dashboard (ARCH-012)
      // -----------------------------------------------------------------------
      name: 'squad-api',
      script: 'dist/squad-api/index.js',
      instances: 1,
      exec_mode: 'fork',
      cwd: '/Users/richo/Sites/inputoutputco/OpenHiveOS',
      interpreter: 'node',

      // Environment variables
      env: {
        NODE_ENV: 'production',
        // Load from .env: DATABASE_URL, SQUAD_API_PORT, OPENHIVEOS_INGESTION_TOKEN
      },

      // Graceful restart
      wait_ready: true,
      listen_timeout: 3000,

      // Auto-restart on crash
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',

      // Logging
      output: '/Users/richo/Sites/inputoutputco/OpenHiveOS/logs/squad-api.log',
      error: '/Users/richo/Sites/inputoutputco/OpenHiveOS/logs/squad-api-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Health check
      max_memory_restart: '500M',
    },

    {
      // -----------------------------------------------------------------------
      // MCP Gateway — StreamableHTTP + SSE bridge (ARCH-016)
      // -----------------------------------------------------------------------
      name: 'mcp-gateway',
      script: 'packages/mcp-gateway/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      cwd: '/Users/richo/Sites/inputoutputco/OpenHiveOS',
      interpreter: 'node',

      // Environment variables
      env: {
        NODE_ENV: 'production',
        // Load from .env:
        // DATABASE_URL, GEMINI_API_KEY, MCP_GATEWAY_TOKEN,
        // OPENHIVEOS_INGESTION_TOKEN, MCP_GATEWAY_PORT, HEALTH_PORT,
        // MCP_BINARY_PATH, ETHOS_SEAL_PATH, GATEWAY_BIND
      },

      // Gateway spawns the MCP subprocess internally via StdioClientTransport.
      // MCP_BINARY_PATH defaults to 'dist/index.js' (relative to CWD).
      // This resolves correctly from /Users/richo/Sites/inputoutputco/OpenHiveOS.

      // Graceful restart
      wait_ready: true,
      listen_timeout: 5000,

      // Auto-restart on crash
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',

      // Logging
      output: '/Users/richo/Sites/inputoutputco/OpenHiveOS/logs/mcp-gateway.log',
      error: '/Users/richo/Sites/inputoutputco/OpenHiveOS/logs/mcp-gateway-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Health check
      max_memory_restart: '500M',
    },
  ],

  // Cluster mode for load balancing (not used here — we run one instance per app)
  // but can be enabled later if needed
  deploy: {
    production: {
      user: 'node',
      host: 'localhost',
      ref: 'origin/main',
      repo: 'git@github.com:inputoutput-labs/openhiveos.git',
      path: '/var/www/openhiveos',
      'post-deploy': 'npm ci && npm run build && pm2 restart ecosystem.config.cjs --env production',
    },
  },
}
