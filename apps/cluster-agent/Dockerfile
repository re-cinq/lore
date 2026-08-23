FROM node:22-slim AS builder
WORKDIR /app

# Workspace layout mirrors the repo so npm workspace symlinks resolve at runtime.
COPY package.json package-lock.json ./
COPY libs/shared/package.json ./libs/shared/
COPY apps/cluster-agent/package.json ./apps/cluster-agent/
RUN npm ci --ignore-scripts --workspace=@re-cinq/lore-shared --workspace=@re-cinq/lore-cluster-agent

COPY libs/shared/tsconfig.json ./libs/shared/
COPY libs/shared/src ./libs/shared/src
RUN npm run build --workspace=@re-cinq/lore-shared

COPY apps/cluster-agent/tsconfig.json ./apps/cluster-agent/
COPY apps/cluster-agent/src/ ./apps/cluster-agent/src/
RUN npm run build --workspace=@re-cinq/lore-cluster-agent

FROM node:22-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/libs/shared/dist ./libs/shared/dist
COPY --from=builder /app/libs/shared/package.json ./libs/shared/
COPY --from=builder /app/apps/cluster-agent/dist ./apps/cluster-agent/dist
COPY --from=builder /app/apps/cluster-agent/package.json ./apps/cluster-agent/

# node:22-slim ships the `node` user at uid 1000 (matches the pod securityContext).
USER 1000

EXPOSE 8080
CMD ["node", "/app/apps/cluster-agent/dist/index.js"]
