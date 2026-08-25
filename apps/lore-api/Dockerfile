FROM node:22-slim AS builder
WORKDIR /app

# Copy workspace root + package.jsons. The in-image layout mirrors the repo
# (apps/ + libs/) so the npm workspace symlinks
# node_modules/@re-cinq/lore-{shared,server-core} → ../../libs/* resolve at runtime.
COPY package.json package-lock.json ./
COPY libs/shared/package.json ./libs/shared/
COPY libs/server-core/package.json ./libs/server-core/
COPY libs/assembly-lines/package.json ./libs/assembly-lines/
COPY apps/stations/package.json ./apps/stations/
COPY apps/lore-api/package.json ./apps/lore-api/
RUN npm ci --ignore-scripts --workspace=@re-cinq/lore-shared --workspace=@re-cinq/lore-server-core --workspace=@re-cinq/lore-assembly-lines --workspace=@re-cinq/lore-stations --workspace=@re-cinq/lore-api

# Build shared
COPY libs/shared/tsconfig.json ./libs/shared/
COPY libs/shared/src ./libs/shared/src
RUN npm run build --workspace=@re-cinq/lore-shared

# Build server-core (the YAML context templates live here and are loaded at
# boot via loadDefaultTemplates(), resolved relative to the package).
COPY libs/server-core/tsconfig.json ./libs/server-core/
COPY libs/server-core/src ./libs/server-core/src
COPY libs/server-core/templates ./libs/server-core/templates
RUN npm run build --workspace=@re-cinq/lore-server-core

# Build the API
# The assembly-line definitions the enriched run-read resolves stations from.
# A previous attempt at this route left this out: the dependency resolved
# through workspace hoisting locally and did not exist in Docker, so the image
# failed to build. Its build also copies the YAMLs to dist for the loader.
COPY libs/assembly-lines/tsconfig.json ./libs/assembly-lines/
COPY libs/assembly-lines/src ./libs/assembly-lines/src
RUN npm run build --workspace=@re-cinq/lore-assembly-lines

# The station registry: lore-api derives its maintenance jobs from it.
COPY apps/stations/tsconfig.json ./apps/stations/
COPY apps/stations/src ./apps/stations/src
RUN npm run build --workspace=@re-cinq/lore-stations

COPY apps/lore-api/tsconfig.json ./apps/lore-api/
COPY apps/lore-api/src ./apps/lore-api/src
RUN npm run build --workspace=@re-cinq/lore-api

# Go builder: cross-compile the portable test-ingestion binary for the targets
# the /dist/lore-code-trace route serves. Baked into this image so onboarded CI
# downloads a binary that always matches this server's ingestion contract.
FROM golang:1.26-alpine AS gobuilder
WORKDIR /src
COPY apps/lore-code-trace/go.mod apps/lore-code-trace/go.sum ./
RUN go mod download
COPY apps/lore-code-trace/ ./
RUN set -eu; mkdir -p /out; \
    for t in linux-amd64 linux-arm64 darwin-amd64 darwin-arm64; do \
      CGO_ENABLED=0 GOOS="${t%-*}" GOARCH="${t#*-}" go build -ldflags="-s -w" -o "/out/$t" .; \
    done; \
    cd /out && sha256sum * > checksums.txt

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# /app/libs mirrors the repo so the workspace symlinks in node_modules resolve,
# and libs/server-core/templates is reachable from the compiled package.
COPY --from=builder /app/libs ./libs
# apps/stations is an APP, not under /app/libs, so it needs its own copy for
# node_modules/@re-cinq/lore-stations to resolve at runtime.
COPY --from=builder /app/apps/stations/dist ./apps/stations/dist
COPY --from=builder /app/apps/stations/package.json ./apps/stations/
COPY --from=builder /app/apps/lore-api/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/lore-api/dist ./dist
# Served at GET /dist/lore-code-trace/<os>-<arch> (+ /checksums.txt).
COPY --from=gobuilder /out ./dist-bin
ENTRYPOINT ["node", "dist/index.js"]
