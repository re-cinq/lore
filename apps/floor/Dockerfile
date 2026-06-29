FROM node:22-slim AS builder
WORKDIR /app

# Copy workspace root + all package.jsons for workspace resolution. The in-image
# layout mirrors the repo (apps/ + libs/) so the npm workspace symlinks
# (node_modules/@re-cinq/lore-shared → ../../libs/shared) resolve at runtime.
COPY package.json ./
COPY libs/shared/package.json ./libs/shared/
COPY libs/runner/package.json ./libs/runner/
COPY apps/floor/package.json ./apps/floor/
RUN npm install --workspace=@re-cinq/lore-shared --workspace=@re-cinq/lore-runner --workspace=@re-cinq/lore-floor

# Build shared
COPY libs/shared/tsconfig.json ./libs/shared/
COPY libs/shared/src ./libs/shared/src
RUN npm run build --workspace=@re-cinq/lore-shared

# Build the runner kernel (the agent imports @re-cinq/lore-runner; its build
# also copies the workflow YAMLs to dist/workflows for loadBuiltinWorkflows).
COPY libs/runner/tsconfig.json ./libs/runner/
COPY libs/runner/src ./libs/runner/src
RUN npm run build --workspace=@re-cinq/lore-runner

# Build agent
COPY apps/floor/tsconfig.json ./apps/floor/
COPY apps/floor/src/ ./apps/floor/src/
RUN npm run build --workspace=@re-cinq/lore-floor

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# The Floor-side AssemblyLine graph clones the task branch and reads/writes
# stage-commit trailers via the git CLI (floor-graph-run.ts, runner graph-executor);
# node:22-slim ships no git, so without this the graph dies on `spawn git ENOENT`.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# /app/libs mirrors the repo so node_modules/@re-cinq/{lore-shared,lore-runner}
# → ../../libs/{shared,runner} resolve at runtime.
COPY --from=builder /app/libs ./libs
COPY --from=builder /app/apps/floor/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/floor/package.json ./
EXPOSE 8080
CMD ["node", "dist/index.js"]
