FROM node:22-slim AS builder
WORKDIR /app

# Copy workspace root + all package.jsons for workspace resolution
COPY package.json ./
COPY shared/package.json ./shared/
COPY agent/package.json ./agent/
RUN npm install --workspace=shared --workspace=agent

# Build shared
COPY shared/tsconfig.json ./shared/
COPY shared/src ./shared/src
RUN npm run build --workspace=shared

# Build agent
COPY agent/tsconfig.json ./agent/
COPY agent/src/ ./agent/src/
RUN npm run build --workspace=agent

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/agent/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/agent/package.json ./
EXPOSE 8080
CMD ["node", "dist/index.js"]
