FROM node:22-slim AS builder
WORKDIR /app

# Build shared package first
COPY shared/package.json shared/tsconfig.json ./shared/
COPY shared/src ./shared/src
RUN cd shared && npm install && npm run build

# Build MCP server
COPY mcp-server/package.json ./mcp-server/
RUN cd mcp-server && npm install
COPY mcp-server/tsconfig.json ./mcp-server/
COPY mcp-server/src ./mcp-server/src
RUN cd mcp-server && npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/mcp-server/package.json ./
COPY --from=builder /app/mcp-server/node_modules ./node_modules
COPY --from=builder /app/mcp-server/dist ./dist
COPY mcp-server/templates ./templates
ENTRYPOINT ["node", "dist/index.js"]
