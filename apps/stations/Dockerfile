FROM node:22-slim AS builder
WORKDIR /app

# Workspace layout mirrors the repo so npm workspace symlinks resolve at runtime.
COPY package.json package-lock.json ./
COPY libs/shared/package.json ./libs/shared/
COPY libs/assembly-lines/package.json ./libs/assembly-lines/
COPY apps/stations/package.json ./apps/stations/
RUN npm ci --ignore-scripts --workspace=@re-cinq/lore-shared --workspace=@re-cinq/lore-assembly-lines --workspace=@re-cinq/lore-stations

COPY libs/shared/tsconfig.json ./libs/shared/
COPY libs/shared/src ./libs/shared/src
RUN npm run build --workspace=@re-cinq/lore-shared

COPY libs/assembly-lines/tsconfig.json ./libs/assembly-lines/
COPY libs/assembly-lines/src ./libs/assembly-lines/src
RUN npm run build --workspace=@re-cinq/lore-assembly-lines

# The stations themselves live in this package, one folder each; the service
# hosts the ones declaring an http trigger and the pod image (Dockerfile.pod)
# runs the assembly-line node ones from the same source.
COPY apps/stations/tsconfig.json ./apps/stations/
COPY apps/stations/src/ ./apps/stations/src/
RUN npm run build --workspace=@re-cinq/lore-stations

FROM node:22-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/libs/assembly-lines/dist ./libs/assembly-lines/dist
COPY --from=builder /app/libs/assembly-lines/package.json ./libs/assembly-lines/
# The whole lib, not just dist + package.json: npm nests some of shared's runtime
# deps under libs/shared/node_modules instead of hoisting them (web-tree-sitter
# since #1862), and a copy of the root node_modules alone boots into
# ERR_MODULE_NOT_FOUND. The floor/lore-api images copy /app/libs for the same reason.
COPY --from=builder /app/libs/shared ./libs/shared
COPY --from=builder /app/apps/stations/dist ./apps/stations/dist
COPY --from=builder /app/apps/stations/package.json ./apps/stations/

# node:22-slim ships the `node` user at uid 1000 (matches the pod securityContext).
USER 1000

EXPOSE 8080
CMD ["node", "/app/apps/stations/dist/index.js"]
