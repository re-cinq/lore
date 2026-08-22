FROM node:22-slim AS builder
WORKDIR /app

# Workspace layout mirrors the repo so npm workspace symlinks resolve at runtime.
COPY package.json package-lock.json ./
COPY libs/shared/package.json ./libs/shared/
COPY apps/event-router/package.json ./apps/event-router/
RUN npm ci --ignore-scripts --workspace=@re-cinq/lore-shared --workspace=@re-cinq/lore-event-router

COPY libs/shared/tsconfig.json ./libs/shared/
COPY libs/shared/src ./libs/shared/src
RUN npm run build --workspace=@re-cinq/lore-shared

COPY apps/event-router/tsconfig.json ./apps/event-router/
COPY apps/event-router/src/ ./apps/event-router/src/
RUN npm run build --workspace=@re-cinq/lore-event-router

FROM node:22-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/libs/shared/dist ./libs/shared/dist
COPY --from=builder /app/libs/shared/package.json ./libs/shared/
COPY --from=builder /app/apps/event-router/dist ./apps/event-router/dist
COPY --from=builder /app/apps/event-router/package.json ./apps/event-router/

# node:22-slim ships the `node` user at uid 1000 (matches the pod securityContext).
USER 1000

EXPOSE 8080
CMD ["node", "/app/apps/event-router/dist/index.js"]
