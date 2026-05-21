import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// ---------------------------------------------------------------------------
// OpenHiveOS Dashboard — Vite configuration (ARCH-012 A5)
//
// Dev:        npm run dev (port 5174, proxies /api/* → localhost:3005)
// Production: npm run build → ../../dist/dashboard/
//             Served by squad-api via express.static (Murphy A6)
//
// Auth: VITE_DASHBOARD_AGENT_TOKEN is baked at build time.
//       Bearer token sent on every /api/* request by squadApi.ts.
//       Required at build time — build will warn if missing (see src/services/squadApi.ts).
// ---------------------------------------------------------------------------

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
  ],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // Dev server — proxies /api/* and /health to squad-api on port 3005.
  // Production: same-origin (no proxy needed — squad-api serves the SPA).
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3005',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3005',
        changeOrigin: true,
      },
    },
  },

  build: {
    // Output to project-root dist/dashboard/ so squad-api can serve it via
    // express.static('dist/dashboard') without needing additional file moves.
    // Murphy A6 mounts this path in server.ts.
    outDir: '../../dist/dashboard',
    emptyOutDir: true,
  },
})
