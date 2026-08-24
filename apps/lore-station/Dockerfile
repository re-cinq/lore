FROM node:22-slim AS builder
WORKDIR /app

# Workspace layout mirrors the repo so npm workspace symlinks resolve at runtime.
COPY package.json package-lock.json ./
COPY libs/shared/package.json ./libs/shared/
COPY libs/assembly-lines/package.json ./libs/assembly-lines/
COPY libs/stations/package.json ./libs/stations/
COPY apps/lore-station/package.json ./apps/lore-station/
# The stations themselves live in the registry lib, shared with the pooled
# service, because an app cannot import another app.
#
# Note the scoping below does NOT prune the image: `npm ci --workspace=...`
# still installs the hoisted root tree, so this pod already ships pg, octokit
# and hapi it never uses (measured: 514MB before and after this change). That is
# a pre-existing bloat and capability surface worth closing separately; nothing
# here made it worse, and the registry lib deliberately depends on none of them
# so that closing it later is possible at all.
RUN npm ci --ignore-scripts --workspace=@re-cinq/lore-shared --workspace=@re-cinq/lore-assembly-lines --workspace=@re-cinq/lore-station-registry --workspace=@re-cinq/lore-station

COPY libs/shared/tsconfig.json ./libs/shared/
COPY libs/shared/src ./libs/shared/src
RUN npm run build --workspace=@re-cinq/lore-shared

COPY libs/assembly-lines/tsconfig.json ./libs/assembly-lines/
COPY libs/assembly-lines/src ./libs/assembly-lines/src
RUN npm run build --workspace=@re-cinq/lore-assembly-lines

COPY libs/stations/tsconfig.json ./libs/stations/
COPY libs/stations/src ./libs/stations/src
RUN npm run build --workspace=@re-cinq/lore-station-registry

COPY apps/lore-station/tsconfig.json ./apps/lore-station/
COPY apps/lore-station/src/ ./apps/lore-station/src/
RUN npm run build --workspace=@re-cinq/lore-station

FROM node:22-slim
WORKDIR /app

# git: the validate station diffs/inspects the cloned working tree.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/libs/shared/dist ./libs/shared/dist
COPY --from=builder /app/libs/shared/package.json ./libs/shared/
COPY --from=builder /app/libs/assembly-lines/dist ./libs/assembly-lines/dist
COPY --from=builder /app/libs/assembly-lines/package.json ./libs/assembly-lines/
COPY --from=builder /app/libs/stations/dist ./libs/stations/dist
COPY --from=builder /app/libs/stations/package.json ./libs/stations/
COPY --from=builder /app/apps/lore-station/dist ./apps/lore-station/dist
COPY --from=builder /app/apps/lore-station/package.json ./apps/lore-station/

# The exec vendor invokes `lore-station <type> '<station_input>'`.
RUN printf '#!/bin/sh\nexec node /app/apps/lore-station/dist/main.js "$@"\n' > /usr/local/bin/lore-station \
  && chmod +x /usr/local/bin/lore-station

# node:22-slim ships the `node` user at uid 1000 (matches the run-pod securityContext).
USER 1000

ENTRYPOINT ["lore-station"]
