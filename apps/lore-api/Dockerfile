FROM node:22-slim AS builder
WORKDIR /app

# Copy workspace root + package.jsons. The in-image layout mirrors the repo
# (apps/ + libs/) so the npm workspace symlinks
# node_modules/@re-cinq/lore-{shared,server-core} → ../../libs/* resolve at runtime.
COPY package.json ./
COPY libs/shared/package.json ./libs/shared/
COPY libs/server-core/package.json ./libs/server-core/
COPY apps/lore-api/package.json ./apps/lore-api/
RUN npm install --workspace=@re-cinq/lore-shared --workspace=@re-cinq/lore-server-core --workspace=@re-cinq/lore-api

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
COPY apps/lore-api/tsconfig.json ./apps/lore-api/
COPY apps/lore-api/src ./apps/lore-api/src
RUN npm run build --workspace=@re-cinq/lore-api

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# /app/libs mirrors the repo so the workspace symlinks in node_modules resolve,
# and libs/server-core/templates is reachable from the compiled package.
COPY --from=builder /app/libs ./libs
COPY --from=builder /app/apps/lore-api/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/lore-api/dist ./dist
ENTRYPOINT ["node", "dist/index.js"]
