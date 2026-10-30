# Contributing to Lore

**For people developing the Lore platform.** This guide gets you from a clone to a running local stack, then orients you in the codebase — the repo layout, the technologies in play, and the design principles that decisions are measured against. For the PR checklist and code conventions, see the root [CONTRIBUTING.md](../../CONTRIBUTING.md) and [CLAUDE.md](../../CLAUDE.md).

---

## Run the full stack locally

`scripts/install.sh` runs once per machine and configures the MCP server, skills, hooks, statusline, and agent ID — that's enough to *use* Lore against a deployed backend. To run the **entire** stack on your own machine instead, work through the three steps below. From a fresh clone they are the whole path.

### Prerequisites

`npm run dev-setup` checks for these and fails listing **every** one that is missing, so install them before you start:

| Tool | Needed for |
|------|-----------|
| Node.js >= 20 | the npm workspaces (`libs/*` and the TypeScript apps) |
| `docker` + `docker compose` v2 | the Postgres and Dgraph containers |
| `claude` | `claude setup-token` mints the agent LLM credential |

Go is needed only if you are working on `apps/lore-code-trace`; nothing in the stack below builds it.

### 1. Install dependencies

```bash
npm install
```

`npm start` does **not** do this for you. It does install `apps/web-ui`'s separate dependency tree on first run — that app has its own lockfile and is not a workspace.

### 2. `npm run dev-setup` — one-time credential bootstrap

Interactive by design: it prompts for credentials a machine cannot invent, and touches nothing outside your machine. It creates `.env.local` from `.env.local.example` and fills the gaps:

- **The agent LLM credential** — runs `claude setup-token` and stores the result as `CLAUDE_CODE_OAUTH_TOKEN`, so laptop runs bill a subscription rather than org API credit. `ANTHROPIC_API_KEY` wins if both are set.
- **`GITHUB_TOKEN`** — a PAT with `repo` scope; the agent pods clone and push with it. Skipped when the GitHub App triple is configured, since the App outranks the PAT.
- **`GHCR_USER` + `GHCR_TOKEN`** — a PAT with `read:packages`; `ghcr.io/re-cinq/ai-agent` is a private package.

When your `gcloud` login can read GCP Secret Manager it offers — never silently — to import the ghcr pull pair and the GitHub App triple from there, so a deployer mints no new PATs. `lore-anthropic-api-key` is deliberately never imported: it would move a laptop run onto org billing, the exact thing the subscription token avoids.

Already-set values are never overwritten, so re-running after adding one tool or one token costs nothing.

### 3. `npm start`

Runs `scripts/dev/start.tsx` (TypeScript, run by `tsx`). It reads one file, the repo-root `.env.local`; `apps/web-ui/.env.local` is ignored, and the launcher warns when it exists. The backend you point `LORE_API_URL` at picks the mode:

- **Local** (`LORE_API_URL` unset or a localhost host): the whole stack.
- **Remote** (any other host): only the web UI. See [Remote mode](#remote-mode).

Local mode runs these steps, and prints a fix beside any that fails:

1. Checks `docker` and `docker compose` v2.
2. Brings up Postgres (pgvector) and Dgraph from `infra/compose.yaml`, waiting on their healthchecks. Data persists in the git-ignored `.lore-pgdata/` and `.lore-dgraphdata/` bind mounts.
3. Applies the Postgres schema with `scripts/infra/setup-local-schema.sh`. The two Dgraph schema scripts run only when `LORE_DGRAPH_HTTP` is set in `.env.local`; no service needs Dgraph to boot.
4. Installs `apps/web-ui` dependencies on first run, then builds `libs/shared` → `libs/assembly-lines` → `apps/stations` → `libs/server-core` → `apps/lore-api` → `apps/mcp-server`.
5. Frees ports `3000`, `3001`, `3002` and `3004` from a stale instance and reports each PID it stopped.
6. Starts every service with live reload and shows a table of them: which layer each runs in, its status and its role. On a terminal it is a dashboard (`↑`/`↓` select a service, `enter` shows its log, `a` shows all logs, `r` restarts the selected service, `q` quits). Without a terminal (`CI`, a pipe, or `LORE_DEV_PLAIN=1`) it prints plain `[lore]` lines and prefixes each service's output with `[name]`. Ctrl-C stops everything in both.

Ports:

| Component | Port |
|-----------|------|
| web-ui | `:3000` |
| Lore API | `:3001` |
| skills registry (mcp-server in HTTP-gateway mode) | `:3002` |
| stations | `:3004` |
| Postgres | `:5432` |
| Dgraph — HTTP / gRPC | `:8081` / `:9080` |
| floor API (when a floor is present) | `:8180` |

The stdio MCP server (`apps/mcp-server`) is built here but launched on demand by Claude Code, not run as a daemon; the `:3002` entry is that same adapter in gateway mode, serving the skills bundle a run pod fetches at startup.

#### Agent layer

Agent runs need a floor. Clone [re-cinq/floor](https://github.com/re-cinq/floor) beside lore (or set `FLOOR_DIR` in `.env.local`), run `npm install` and its `npm run minikube-setup` once (it needs `GHCR_USER` and `GHCR_TOKEN`, and a Claude credential, in the floor's own `.env.local`). From then on lore's `npm start` starts the floor and shows its rows next to the others: the `floor` process, `floor-postgres`, `minikube` and the `ai-subsystem` controller. It also gives lore-api and stations the variables the floor pipelines name (`FLOOR_API_URL`, `FLOOR_SERVICE_TOKEN`, `LORE_AGENT_IMAGE`, `LORE_SKILLS_URL`, `LORE_MCP_URL`); anything you set in `.env.local` wins. `LORE_DEV_FLOOR=0` runs Lore without the agent layer even when the checkout exists. Ctrl-C stops the floor's host processes; its Postgres and minikube stay up.

#### Remote mode

Set `LORE_API_URL=https://lore-api.gcp.re-cinq.com` (or another deployed lore-api) in `.env.local` and run `npm start`. Only the web UI starts on `:3000`; there is no docker, build or token. You sign in through the remote lore-api (ADR-053). The launcher probes `GET /healthz` of that URL and warns, without stopping, when it does not answer.

On first run, `scripts/infra/setup-local-schema.sh` bootstraps the `lore`/`lore_ui` roles, the pgvector extension, and all schemas by shimming `kubectl` → `docker exec` so the existing `setup-*.sh` scripts run unmodified against the container (no SQL duplication). It then applies the `ui-helm/migrations/*.sql` incremental migrations the same way the GKE Helm hook does — tracked in `lore.schema_migrations`, in filename order, one transaction per file, skipping already-applied ones — so migration-added tables exist locally even though local dev has no Helm hook.

Useful sub-commands:

- `npm run db:up` / `npm run db:down` — manage the Postgres container on its own
- `npm run db:schema` — apply the schema DDL
- `npm run services:up` / `npm run services:down` — both containers via compose

If a port stays held after a run, `npm start` frees it on the next start, and every service it launches is stopped as a whole process group so `node --watch` children no longer outlive the run. To see what holds a port yourself: `ss -lptn 'sport = :3002'`.

`db:up` and `dgraph:up` run a bare `docker run` rather than compose. They reuse the same container names and bind mounts, but a container compose did not create is one compose will not adopt — so a stack brought up that way makes the compose step of the next `npm start` fail with `Conflict. The container name "/lore-postgres" is already in use`. Prefer `services:up`; if you hit the conflict, `docker rm -f lore-postgres lore-dgraph` and re-run. The data survives — it lives in the bind mount, not the container.

### Working in a git worktree

Run `scripts/worktree-bootstrap.sh` once per worktree. A fresh `git worktree` has no `node_modules` and no built workspace libs, so module resolution escapes into the main checkout's (possibly stale) install and `eslint`/`tsc` fail or go falsely green. The `.claude/settings.json` SessionStart hook runs it automatically, but only when the checkout has no `node_modules` yet — after editing `libs/*/src`, re-run it yourself so package-level `tsc --noEmit` sees the fresh types (vitest reads source, `tsc` reads `dist`).

### Starting over from scratch

To re-test this path end to end, tear the local stack down:

```bash
docker rm -f lore-postgres lore-dgraph
rm -f .env.local
docker run --rm -v "$PWD:/work" alpine:3.20 \
  sh -c 'rm -rf /work/.lore-pgdata /work/.lore-dgraphdata /work/.lore-archive'
```

The data dirs are written by the containers as root, so a plain `rm -rf` hits `Permission denied` — the throwaway container removes them without sudo. Back up `.env.local` first if the credentials in it are not easily re-minted.

### Logging into the web UI

The web UI (`:3000`) signs people in through lore-api (`:3001`), which runs the GitHub OAuth dance, so a one-time OAuth app is required before you can sign in:

1. Create a GitHub OAuth app at https://github.com/settings/developers → **New OAuth App**:
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:** `http://localhost:3001/api/auth/callback`
2. Register it, copy the **Client ID**, and **Generate a new client secret**.
3. Put both in the root `.env.local` (gitignored, sourced by `npm start`; lore-api reads them, the web UI needs none):

   ```
   GITHUB_OAUTH_CLIENT_ID=...
   GITHUB_OAUTH_CLIENT_SECRET=...
   ```

4. Restart `npm start`, then **Sign in with GitHub**.

Optionally set `GITHUB_ORG` in the same file to restrict login to one org's members (unset = any GitHub account). The callback URL must match exactly, or GitHub returns a `redirect_uri` error.

## Project structure

```
lore/
├── apps/                       # deployable services
│   ├── agent-image/            # The lore-agent image agent pods run (build-agent-image.yml)
│   ├── lore-api/               # Remote REST backend (/api/*) on GKE — DB / GitHub / GCS / tree-sitter
│   ├── stations/               # Service stations, the cron ticks + event drain, Lore's floor stations
│   ├── mcp-server/             # Local stdio MCP adapter (+ the in-cluster lore-mcp HTTP gateway)
│   ├── lore-code-trace/        # Go binary — runs a repo's test suite in CI and posts the trace
│   ├── web-ui/                 # Next.js dashboard (repo-centric UI; signs in through lore-api)
│   └── vscode-extension/       # VS Code extension (spec ↔ code highlighting)
├── libs/                       # shared libraries (consumed by apps)
│   ├── shared/                 # @re-cinq/lore-shared — chunker, redact, Project facade, types
│   ├── server-core/            # @re-cinq/lore-server-core — light business logic shared by both deployables
│   └── assembly-lines/         # @re-cinq/lore-assembly-lines — floor pipeline files + shared station parsers
├── infra/                      # deploy & runtime
│   ├── terraform/modules/      # Terraform + the `lore-platform` umbrella Helm chart (5 subcharts:
│   │                           #   lore-api / lore-mcp / stations / ui / lore-db)
│   └── compose.yaml            # Local Postgres + Dgraph for the dev stack
├── scripts/                    # install.sh, lore-doctor, infra setup scripts
├── adrs/                       # Architecture decision records (MADR format)
├── specs/                      # Feature specifications (speckit workflow)
├── runbooks/                   # Incident & operational runbooks
├── teams/                      # Per-team CLAUDE.md overrides
├── docs/                       # Guides (using-lore, building-lore)
└── .github/workflows/          # CI: build + push containers for Lore API, MCP, stations, UI, agent image
```

npm workspaces cover `libs/*` and the TypeScript apps (`lore-api`, `stations`, `mcp-server`, `vscode-extension`) — the root `package.json` names each one explicitly rather than globbing `apps/*`. `web-ui` is a standalone Next.js app (its own lockfile, not a workspace), and `lore-code-trace` is a Go module.

Each app and library carries its own README with its responsibilities, boundaries, and deploy facts: [`lore-api`](../../apps/lore-api/README.md), [`stations`](../../apps/stations/README.md), [`mcp-server`](../../apps/mcp-server/README.md), [`lore-code-trace`](../../apps/lore-code-trace/README.md), [`web-ui`](../../apps/web-ui/README.md), [`vscode-extension`](../../apps/vscode-extension/README.md), [`libs/shared`](../../libs/shared/README.md), [`libs/assembly-lines`](../../libs/assembly-lines/README.md), [`libs/server-core`](../../libs/server-core/README.md).

## Tech stack

| Layer | Technology |
|-------|-----------|
| MCP Server | TypeScript, `@modelcontextprotocol/sdk`, Zod |
| Lore API | TypeScript, `@hapi/hapi` (REST), Zod, `pg`, Octokit, tree-sitter |
| Floor | TypeScript, `@anthropic-ai/sdk`, Claude Code (headless) |
| stations | TypeScript, `@hapi/hapi`, Zod, `pg` |
| Web UI | Next.js 15, a session cookie minted by lore-api (GitHub OAuth) |
| Database | PostgreSQL 16 + pgvector (CloudNativePG) |
| Embeddings | Vertex AI `text-embedding-005` (768 dim) |
| Search | Hybrid: HNSW vector + BM25 keyword, RRF fusion. AST-based code chunking via tree-sitter |
| Code parsing | web-tree-sitter (TypeScript, Python, Go) |
| GitHub | Octokit + `@octokit/auth-app` (GitHub App) |
| Observability | OpenTelemetry traces + metrics |
| Slack | Slack Web API (`chat.postMessage`), HMAC-SHA256 verification |
| Infrastructure | GKE, Helm, cert-manager, external-dns, ESO |

## Design principles

1. **DX-first** — developer experience is validated before infrastructure investment.
2. **Zero stored credentials** — Workload Identity everywhere, no secrets in code.
3. **Single interface** — developers talk to the Lore MCP server, never directly to agents or databases.
4. **Intelligent agents over scripts** — agents that understand code, not scripts that chunk text.
5. **Schema-per-team isolation** — SQL-level access control without a separate auth layer.

Architecture decisions are documented as ADRs in `adrs/` (MADR format).

## Development workflow

Use the `/lore-feature` skill to start or continue a feature — it guides you through spec → plan → tasks → implementation interactively. When you're ready to open a PR, `/lore-pr` drafts a description from your spec and changed files against the template in `.github/PULL_REQUEST_TEMPLATE.md`. Full conventions live in [CLAUDE.md](../../CLAUDE.md); the PR checklist is in the root [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## See also

- [Architecture](architecture.md) — how the components you're editing fit together.
- [Scheduled Jobs](scheduled-jobs.md) — the recurring jobs the Floor runs.
- [CONTRIBUTING.md](../../CONTRIBUTING.md) and [CLAUDE.md](../../CLAUDE.md) — PR checklist and full code conventions.
- [Working in a git worktree](../../CONTRIBUTING.md#working-in-a-git-worktree) — the `tsc`-against-stale-`dist` and symlinked-`node_modules` traps, and how to avoid them.
- [Back to README](../../README.md)
