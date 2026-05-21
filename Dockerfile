# -----------------------------------------------------------------------
# Stage 1 — build
# -----------------------------------------------------------------------
FROM node:20-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# -----------------------------------------------------------------------
# Stage 2 — production
# -----------------------------------------------------------------------
FROM node:20-slim AS production

WORKDIR /app

ENV NODE_ENV=production

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output
COPY --from=build /app/dist ./dist

# Copy squad manifest — operators override this with a volume mount
# to configure their agent roster without rebuilding the image.
COPY squad.manifest.json ./

# Copy migrations so operators can run them via docker exec
COPY migrations/ ./migrations/

# Run as non-root
USER node

# Health endpoint (HEALTH_PORT — default 3000)
EXPOSE 3000

# MCP server reads from stdin / writes to stdout (StdioServerTransport).
# Clients connect via docker exec -i or a stdio bridge.
# Keep stdin open by starting docker-compose with stdin_open: true.
CMD ["node", "dist/index.js"]
