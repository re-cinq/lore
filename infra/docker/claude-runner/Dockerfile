# Multi-stage build for the claude-runner image.
#
# Stage 1: build shared → runner → agent (TS → JS) inside the workspace so the
# final image has /app/dist (the agent's supervisor/runner-cli.js entry) plus
# /app/libs (the @re-cinq/lore-shared + lore-runner packages + workflow YAMLs)
# ready to execute. The in-image layout mirrors the repo (apps/ + libs/) so the
# npm workspace symlinks resolve.
#
# Stage 2: build the validation CLI (vendored from apps/mcp-server) — kept
# in-image because it has near-zero runtime deps and the source TS files
# live in apps/mcp-server/, not infra/docker/.
#
# Stage 3 (final): node:24-slim with claude CLI + git/gh/jq + the agent
# dist + node_modules + workflow YAMLs + task-types.yaml. Runs as
# uid 1000 (matches K8s SecurityContext).
#
# Build context = repo root.
#   docker build -f infra/docker/claude-runner/Dockerfile -t lore-claude-runner .

# ── Stage 1: agent build ──────────────────────────────────────────────
FROM node:24-slim AS agent-builder
WORKDIR /build

# Workspace package.jsons first so npm can resolve the workspace graph
# without a full source copy (cacheable layer).
COPY package.json ./
COPY libs/shared/package.json libs/shared/
COPY libs/runner/package.json libs/runner/
COPY apps/floor/package.json apps/floor/
RUN npm install --workspace=@re-cinq/lore-shared --workspace=@re-cinq/lore-runner --workspace=@re-cinq/lore-floor

# Build shared (runner + agent depend on @re-cinq/lore-shared dist).
COPY libs/shared/tsconfig.json libs/shared/
COPY libs/shared/src libs/shared/src
RUN npm run build --workspace=@re-cinq/lore-shared

# Build the runner kernel (agent depends on @re-cinq/lore-runner dist). Its
# build script also copies the workflow YAMLs to dist/workflows, where
# loadBuiltinWorkflows() resolves them via import.meta.url.
COPY libs/runner/tsconfig.json libs/runner/
COPY libs/runner/src libs/runner/src
RUN npm run build --workspace=@re-cinq/lore-runner

# Build agent (produces /build/apps/floor/dist, incl. supervisor/runner-cli.js).
COPY apps/floor/tsconfig.json apps/floor/
COPY apps/floor/src apps/floor/src
RUN npm run build --workspace=@re-cinq/lore-floor

# Drop dev deps before the runtime stage copies node_modules. The
# initial install above pulls in vitest, typescript, @types/* — pure
# overhead in the runtime image. Prune is faster than a fresh
# `npm install --omit=dev`.
RUN npm prune --omit=dev --workspace=@re-cinq/lore-shared --workspace=@re-cinq/lore-runner --workspace=@re-cinq/lore-floor

# ── Stage 2: validation CLI build ─────────────────────────────────────
FROM node:24-slim AS validation-builder
WORKDIR /build
COPY apps/mcp-server/src/features/repo/repo-validation.ts apps/mcp-server/src/features/repo/repo-validation-cli.ts ./src/
COPY infra/docker/claude-runner/validation/package.json infra/docker/claude-runner/validation/tsconfig.json ./
RUN npm install --ignore-scripts && npx tsc

# ── Stage 3: runtime image ────────────────────────────────────────────
FROM node:24-slim
RUN apt-get update && apt-get install -y git curl jq && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code

# Validation CLI (deterministic lint/typecheck stage).
COPY --from=validation-builder /build/dist/repo-validation-cli.js /validation.js
COPY --from=validation-builder /build/dist/repo-validation.js /repo-validation.js

# Agent supervisor + workflows + workspace deps. Layout chosen to match
# the loretask-controller's entrypoint expectation
# (`node /app/dist/delivery/runner-cli.js`).
COPY --from=agent-builder /build/apps/floor/dist /app/dist
# `/app/libs` is REQUIRED at this exact path — not arbitrary. The npm workspace
# install creates relative symlinks `node_modules/@re-cinq/lore-shared →
# ../../libs/shared` (and likewise lore-runner) under /app/node_modules/@re-cinq/,
# so their targets must resolve to /app/libs/{shared,runner}. The agent's
# runner-cli imports @re-cinq/lore-runner; loadBuiltinWorkflows reads the
# workflow YAMLs from /app/libs/runner/dist/workflows. Move libs/ elsewhere and
# imports from `@re-cinq/lore-*` in compiled supervisor code silently break.
COPY --from=agent-builder /build/libs /app/libs
COPY --from=agent-builder /build/node_modules /app/node_modules
COPY --from=agent-builder /build/apps/floor/package.json /app/package.json

# task-types.yaml is read by runner-cli at startup (TASK_TYPES_PATH
# defaults to /config/task-types.yaml) — bake it in so cluster pods
# don't need a ConfigMap mount.
COPY scripts/task-types.yaml /config/task-types.yaml

RUN useradd -m -s /bin/bash -u 1000 -o runner
RUN mkdir -p /workspace && chown 1000:1000 /workspace
WORKDIR /workspace
COPY infra/docker/claude-runner/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER runner
ENTRYPOINT ["/entrypoint.sh"]
