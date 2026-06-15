# Multi-stage build for the claude-runner image.
#
# Stage 1: build shared → runner → agent (TS → JS) inside the workspace so the
# final image has /app/dist (the agent's supervisor/runner-cli.js entry) plus
# /app/runner (the @re-cinq/lore-runner kernel + its workflow YAMLs) ready to
# execute. Mirrors agent/Dockerfile so workspace symlink resolution works.
#
# Stage 2: build the validation CLI (vendored from mcp-server) — kept
# in-image because it has near-zero runtime deps and the source TS files
# live in mcp-server/, not docker/.
#
# Stage 3 (final): node:24-slim with claude CLI + git/gh/jq + the agent
# dist + node_modules + workflow YAMLs + task-types.yaml. Runs as
# uid 1000 (matches K8s SecurityContext).
#
# Build context = repo root.
#   docker build -f docker/claude-runner/Dockerfile -t lore-claude-runner .

# ── Stage 1: agent build ──────────────────────────────────────────────
FROM node:24-slim AS agent-builder
WORKDIR /build

# Workspace package.jsons first so npm can resolve the workspace graph
# without a full source copy (cacheable layer).
COPY package.json ./
COPY shared/package.json shared/
COPY runner/package.json runner/
COPY agent/package.json agent/
RUN npm install --workspace=shared --workspace=runner --workspace=agent

# Build shared (runner + agent depend on @re-cinq/lore-shared dist).
COPY shared/tsconfig.json shared/
COPY shared/src shared/src
RUN npm run build --workspace=shared

# Build the runner kernel (agent depends on @re-cinq/lore-runner dist). Its
# build script also copies the workflow YAMLs to runner/dist/workflows, where
# loadBuiltinWorkflows() resolves them via import.meta.url.
COPY runner/tsconfig.json runner/
COPY runner/src runner/src
RUN npm run build --workspace=runner

# Build agent (produces /build/agent/dist, incl. supervisor/runner-cli.js).
COPY agent/tsconfig.json agent/
COPY agent/src agent/src
RUN npm run build --workspace=agent

# Drop dev deps before the runtime stage copies node_modules. The
# initial install above pulls in vitest, typescript, @types/* — pure
# overhead in the runtime image. Prune is faster than a fresh
# `npm install --omit=dev`.
RUN npm prune --omit=dev --workspace=shared --workspace=runner --workspace=agent

# ── Stage 2: validation CLI build ─────────────────────────────────────
FROM node:24-slim AS validation-builder
WORKDIR /build
COPY mcp-server/src/features/repo/repo-validation.ts mcp-server/src/features/repo/repo-validation-cli.ts ./src/
COPY docker/claude-runner/validation/package.json docker/claude-runner/validation/tsconfig.json ./
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
# runner-cli.ts WORKFLOWS_DIR resolution and the loretask-controller's
# entrypoint expectation (`node /app/dist/supervisor/runner-cli.js`).
COPY --from=agent-builder /build/agent/dist /app/dist
# `/app/shared` is REQUIRED at this exact path — not arbitrary. The
# npm workspace install creates a relative symlink
# `node_modules/@re-cinq/lore-shared → ../../shared` (relative to the
# symlink's parent dir `node_modules/@re-cinq/`). Once that symlink is
# under `/app/node_modules/@re-cinq/lore-shared`, its target resolves
# to `/app/shared`. Move `shared/` elsewhere and `import` from
# `@re-cinq/lore-shared` in compiled supervisor code silently breaks.
COPY --from=agent-builder /build/shared /app/shared
# `/app/runner` mirrors `/app/shared`: the workspace symlink
# node_modules/@re-cinq/lore-runner → ../../runner resolves to /app/runner.
# The agent's runner-cli imports @re-cinq/lore-runner; loadBuiltinWorkflows
# reads the workflow YAMLs from /app/runner/dist/workflows.
COPY --from=agent-builder /build/runner /app/runner
COPY --from=agent-builder /build/node_modules /app/node_modules
COPY --from=agent-builder /build/agent/package.json /app/package.json

# task-types.yaml is read by runner-cli at startup (TASK_TYPES_PATH
# defaults to /config/task-types.yaml) — bake it in so cluster pods
# don't need a ConfigMap mount.
COPY scripts/task-types.yaml /config/task-types.yaml

RUN useradd -m -s /bin/bash -u 1000 -o runner
RUN mkdir -p /workspace && chown 1000:1000 /workspace
WORKDIR /workspace
COPY docker/claude-runner/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER runner
ENTRYPOINT ["/entrypoint.sh"]
