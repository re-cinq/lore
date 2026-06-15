FROM node:22-slim AS builder
WORKDIR /app

# Copy workspace root + package.jsons. The in-image layout mirrors the repo
# (apps/ + libs/) so the npm workspace symlink
# node_modules/@re-cinq/lore-shared → ../../libs/shared resolves at runtime.
COPY package.json ./
COPY libs/shared/package.json ./libs/shared/
COPY apps/mcp-server/package.json ./apps/mcp-server/
RUN npm install --workspace=@re-cinq/lore-shared --workspace=@re-cinq/lore-mcp

# Build shared
COPY libs/shared/tsconfig.json ./libs/shared/
COPY libs/shared/src ./libs/shared/src
RUN npm run build --workspace=@re-cinq/lore-shared

# Build MCP server
COPY apps/mcp-server/tsconfig.json ./apps/mcp-server/
COPY apps/mcp-server/src ./apps/mcp-server/src
RUN npm run build --workspace=@re-cinq/lore-mcp

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# /app/libs mirrors the repo so node_modules/@re-cinq/lore-shared resolves.
COPY --from=builder /app/libs ./libs
COPY --from=builder /app/apps/mcp-server/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/mcp-server/dist ./dist
COPY apps/mcp-server/templates ./templates
ENTRYPOINT ["node", "dist/index.js"]
