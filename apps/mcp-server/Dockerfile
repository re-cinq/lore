FROM node:22-slim AS builder
WORKDIR /app

# Copy workspace root + package.jsons. The in-image layout mirrors the repo
# (apps/ + libs/) so the npm workspace symlinks
# node_modules/@re-cinq/lore-{shared,server-core} → ../../libs/* resolve at runtime.
COPY package.json package-lock.json ./
COPY libs/shared/package.json ./libs/shared/
COPY libs/server-core/package.json ./libs/server-core/
COPY apps/mcp-server/package.json ./apps/mcp-server/
# --ignore-scripts: dependency lifecycle scripts are the #1062 supply-chain vector.
RUN npm ci --ignore-scripts --workspace=@re-cinq/lore-shared --workspace=@re-cinq/lore-server-core --workspace=@re-cinq/lore-mcp

# Build shared
COPY libs/shared/tsconfig.json ./libs/shared/
COPY libs/shared/src ./libs/shared/src
RUN npm run build --workspace=@re-cinq/lore-shared

# Build server-core (its YAML context templates load at boot via
# loadDefaultTemplates(), resolved relative to the package).
COPY libs/server-core/tsconfig.json ./libs/server-core/
COPY libs/server-core/src ./libs/server-core/src
COPY libs/server-core/templates ./libs/server-core/templates
RUN npm run build --workspace=@re-cinq/lore-server-core

# Build the MCP adapter
COPY apps/mcp-server/tsconfig.json ./apps/mcp-server/
COPY apps/mcp-server/src ./apps/mcp-server/src
RUN npm run build --workspace=@re-cinq/lore-mcp

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# Run as the shared MCP-over-HTTP gateway for agent pods (server/http-transport.ts).
# server-mode=agent omits the pipeline/local-runner tools. The auth token, Lore API
# URL and port come from the Deployment env (LORE_MCP_AUTH_TOKEN, LORE_API_URL,
# LORE_MCP_PORT). Override LORE_MCP_HTTP=0 to fall back to stdio.
ENV LORE_MCP_HTTP=1
ENV LORE_MCP_SERVER_MODE=agent
ENV LORE_MCP_PORT=8080
# /app/libs mirrors the repo so the workspace symlinks in node_modules resolve,
# and libs/server-core/templates is reachable from the compiled package.
COPY --from=builder /app/libs ./libs
COPY --from=builder /app/apps/mcp-server/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/mcp-server/dist ./dist
# loadTaskTypes() reads scripts/task-types.yaml from cwd (falls back to empty).
COPY scripts/task-types.yaml ./scripts/task-types.yaml
# The agent-skills registry the gateway serves at /skills (server/skills-registry.ts).
# Lore content in a Lore service — the ai-agent-subsystem bakes none of it. `tar` is a
# required-priority package present in the debian base; the tarball serve spawns it.
COPY apps/mcp-server/agent-skills ./agent-skills
EXPOSE 8080
ENTRYPOINT ["node", "dist/index.js"]
