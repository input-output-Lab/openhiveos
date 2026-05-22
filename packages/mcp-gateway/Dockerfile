# packages/mcp-gateway/Dockerfile
#
# OpenHiveOS mcp-gateway — SSE bridge container.
#
# ARG MCP_VERSION: pins the MCP server binary version. Must match the
# version of the standalone mcp container — drift between the two produces
# tool list divergence between operator AI clients and Bridge-mediated calls.
# CI/CD must enforce this via ARG injection on every mcp-server binary change.
#
# Architecture: ARCH-016 (Option C)
# Security: SEC-D4 (127.0.0.1 binding), SEC-D7 (HEALTH_PORT distinct from mcp container)

FROM node:20-alpine AS base
WORKDIR /app

# Build-time version pin — enforced by CI to prevent drift from standalone mcp container.
ARG MCP_VERSION=latest
LABEL io.openhiveos.mcp-version="${MCP_VERSION}"

# ---------------------------------------------------------------------------
# deps — install production dependencies only
# ---------------------------------------------------------------------------
FROM base AS deps
COPY packages/mcp-gateway/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts

# ---------------------------------------------------------------------------
# build — compile TypeScript
# ---------------------------------------------------------------------------
FROM base AS build
COPY packages/mcp-gateway/package.json ./package.json
COPY packages/mcp-gateway/tsconfig.json ./tsconfig.json
RUN npm install --ignore-scripts
COPY packages/mcp-gateway/src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# The MCP server binary (dist/index.js from the main OpenHiveOS build) is
# mounted at runtime via Compose volume or COPY from the host build artefact.
# The gateway spawns it via: node dist/index.js (see gateway.ts spawnAndConnect).

EXPOSE 3006

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${MCP_GATEWAY_PORT:-3006}/health 2>/dev/null || exit 1

CMD ["node", "dist/index.js"]
