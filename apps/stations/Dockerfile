FROM node:22-slim AS builder
WORKDIR /app

# Workspace layout mirrors the repo so npm workspace symlinks resolve at runtime.
COPY package.json package-lock.json ./
COPY libs/shared/package.json ./libs/shared/
COPY libs/assembly-lines/package.json ./libs/assembly-lines/
COPY libs/stations/package.json ./libs/stations/
COPY apps/stations/package.json ./apps/stations/
RUN npm ci --ignore-scripts --workspace=@re-cinq/lore-shared --workspace=@re-cinq/lore-assembly-lines --workspace=@re-cinq/lore-station-registry --workspace=@re-cinq/lore-stations

COPY libs/shared/tsconfig.json ./libs/shared/
COPY libs/shared/src ./libs/shared/src
RUN npm run build --workspace=@re-cinq/lore-shared

COPY libs/assembly-lines/tsconfig.json ./libs/assembly-lines/
COPY libs/assembly-lines/src ./libs/assembly-lines/src
RUN npm run build --workspace=@re-cinq/lore-assembly-lines

# The stations themselves; this service hosts the ones with an http trigger.
COPY libs/stations/tsconfig.json ./libs/stations/
COPY libs/stations/src ./libs/stations/src
RUN npm run build --workspace=@re-cinq/lore-station-registry

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
COPY --from=builder /app/libs/stations/dist ./libs/stations/dist
COPY --from=builder /app/libs/stations/package.json ./libs/stations/
COPY --from=builder /app/libs/shared/dist ./libs/shared/dist
COPY --from=builder /app/libs/shared/package.json ./libs/shared/
COPY --from=builder /app/apps/stations/dist ./apps/stations/dist
COPY --from=builder /app/apps/stations/package.json ./apps/stations/

# node:22-slim ships the `node` user at uid 1000 (matches the pod securityContext).
USER 1000

EXPOSE 8080
CMD ["node", "/app/apps/stations/dist/index.js"]
