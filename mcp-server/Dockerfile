FROM node:22-slim AS builder
WORKDIR /app

# Copy workspace root + all package.jsons for workspace resolution
COPY package.json ./
COPY shared/package.json ./shared/
COPY mcp-server/package.json ./mcp-server/
RUN npm install --workspace=shared --workspace=mcp-server

# Build shared
COPY shared/tsconfig.json ./shared/
COPY shared/src ./shared/src
RUN npm run build --workspace=shared

# Build MCP server
COPY mcp-server/tsconfig.json ./mcp-server/
COPY mcp-server/src ./mcp-server/src
RUN npm run build --workspace=mcp-server

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/mcp-server/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/mcp-server/dist ./dist
COPY mcp-server/templates ./templates
ENTRYPOINT ["node", "dist/index.js"]
