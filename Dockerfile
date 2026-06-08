# -----------------------------------------------------------------------
# Stage 0 — dashboard build (Path B: Docker Hub / CI distribution)
# -----------------------------------------------------------------------
# SEC-D3 OPERATOR NOTE: VITE_DASHBOARD_AGENT_TOKEN is baked into this image
# layer and is visible via 'docker history'. Never push a token-baked image
# to a public registry. For self-hosted installs use install.sh (Path A —
# host npm build + bind mount). For CI / Docker Hub distribution, gate the
# build behind a private registry and rotate the token when offboarding.
#
# If VITE_DASHBOARD_AGENT_TOKEN is not provided (Path A local builds),
# the dashboard is built with an empty token — the bind mount from
# docker-compose.yml or install.sh overrides it at runtime.
# -----------------------------------------------------------------------
FROM node:22-alpine AS dashboard-build

ARG VITE_DASHBOARD_AGENT_TOKEN

WORKDIR /app/packages/dashboard

COPY packages/dashboard/package*.json ./
RUN npm ci

COPY packages/dashboard/ ./

# Bake the bearer token into the Vite bundle at compile time.
# The VITE_ prefix makes it available to import.meta.env in the browser.
# Token rotation requires a dashboard rebuild and image redeploy.
ENV VITE_DASHBOARD_AGENT_TOKEN=${VITE_DASHBOARD_AGENT_TOKEN}

RUN npm run build
# Output lands at ../../dist/dashboard relative to packages/dashboard/,
# which resolves to /app/dist/dashboard inside this stage.

# -----------------------------------------------------------------------
# Stage 1 — build
# -----------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# -----------------------------------------------------------------------
# Stage 2 — production
# -----------------------------------------------------------------------
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled MCP server + squad-api output
COPY --from=build /app/dist ./dist

# Copy dashboard SPA (Path B: baked in from dashboard-build stage).
# Path A (install.sh): this layer is overridden by the bind mount at runtime.
COPY --from=dashboard-build /app/dist/dashboard ./dist/dashboard

# Copy squad manifest — operators override this with a volume mount
# to configure their agent roster without rebuilding the image.
COPY squad.manifest.json ./

# Copy migrations so operators can run them via docker exec
COPY migrations/ ./migrations/

# Run as non-root
USER node

# Health endpoint (HEALTH_PORT — default 3000)
EXPOSE 3000

# -----------------------------------------------------------------------
# Stage 3 — prebuilt-runtime
#
# Skips the TypeScript build — designed for local Docker deployments where
# dist/ is already compiled on the host and bind-mounted into the container.
# Used by docker-compose.yml squad-api and mcp-gateway services.
#
# Usage:
#   Build: docker compose build (no TypeScript compile — fast)
#   dist/ is bind-mounted from host at runtime: ./dist:/app/dist:ro
# -----------------------------------------------------------------------
FROM node:22-alpine AS prebuilt-runtime

WORKDIR /app

ENV NODE_ENV=production

# Install production dependencies only — no source copy, no compile.
# --ignore-scripts: skip prepare/husky hooks (devDependency, not available here).
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# squad.manifest.json — operators override with a volume mount
COPY squad.manifest.json ./

# Run as non-root
USER node

EXPOSE 3000

# MCP server reads from stdin / writes to stdout (StdioServerTransport).
# Clients connect via docker exec -i or a stdio bridge.
# Keep stdin open by starting docker-compose with stdin_open: true.
CMD ["node", "dist/index.js"]
