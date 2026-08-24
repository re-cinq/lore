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
| `minikube` | the local Kubernetes cluster that agent runs execute on |
| `kubectl` | talking to that cluster |
| `helm` | installing the ai-agent-subsystem chart into it |
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
- **`LORE_STATION_BACKEND=k8s`** — sends agent runs to minikube pods. Left at the default `inprocess`, no run is ever isolated.

When `infra/terraform/secrets.tfvars` is present it offers — never silently — to import the ghcr pull pair and the GitHub App triple from it, so a deployer mints no new PATs. `anthropic_api_key` is deliberately never imported: it would move a laptop run onto org billing, the exact thing the subscription token avoids.

Already-set values are never overwritten, so re-running after adding one tool or one token costs nothing.

### 3. `npm start`

Runs `scripts/dev-local.sh`, which is unattended and re-runnable:

1. Brings up Postgres (pgvector) and Dgraph from `infra/compose.yaml`, waiting on their healthchecks. Data persists in the git-ignored `.lore-pgdata/` and `.lore-dgraphdata/` bind mounts.
2. Applies the schemas — `scripts/infra/setup-local-schema.sh` for Postgres, then the two Dgraph schema scripts.
3. **When `LORE_STATION_BACKEND=k8s`**, runs `scripts/infra/setup-minikube-agents.sh`: starts minikube, installs the ai-agent-subsystem into the `ai-agents` namespace, and writes `.lore-kubeconfig-minikube` — a kubeconfig holding **only** the minikube context. The Floor is pinned to that file so its Agent CR dispatch can never follow a stray `current-context` into a real cluster.
4. Installs `apps/web-ui` dependencies on first run, builds `libs/shared` → `libs/assembly-lines` → `libs/server-core` → `apps/lore-api` → `apps/mcp-server` → `apps/floor`, then runs everything under `concurrently` with live reload.

Ports:

| Component | Port |
|-----------|------|
| web-ui | `:3000` |
| Lore API | `:3001` |
| skills registry (mcp-server in HTTP-gateway mode) | `:3002` |
| Floor | `:8080` |
| Postgres | `:5432` |
| Dgraph — HTTP / gRPC | `:8081` / `:9080` |

Dgraph's HTTP port is published as `:8081` so it never collides with the Floor's `:8080`. The stdio MCP server (`apps/mcp-server`) is built here but launched on demand by Claude Code, not run as a daemon; the `:3002` entry is that same adapter in gateway mode, serving the skills bundle a run pod fetches at startup.

Watch agent runs with:

```bash
KUBECONFIG=.lore-kubeconfig-minikube kubectl -n ai-agents get agents -w
```

On first run, `scripts/infra/setup-local-schema.sh` bootstraps the `lore`/`lore_ui` roles, the pgvector extension, and all schemas by shimming `kubectl` → `docker exec` so the existing `setup-*.sh` scripts run unmodified against the container (no SQL duplication). It then applies the `ui-helm/migrations/*.sql` incremental migrations the same way the GKE Helm hook does — tracked in `lore.schema_migrations`, in filename order, one transaction per file, skipping already-applied ones — so migration-added tables exist locally even though local dev has no Helm hook.

Useful sub-commands:

- `npm run db:up` / `npm run db:down` — manage the Postgres container on its own
- `npm run db:schema` — apply the schema DDL
- `npm run services:up` / `npm run services:down` — both containers via compose

If a service dies with `EADDRINUSE`, a previous stack is still holding the port: `concurrently -k` does not reliably reap its children, so services can outlive the run that started them and stay bound to `:3000`/`:3001`/`:3002`/`:8080`. `dev-local.sh` sweeps those four ports before starting, but that sweep happens once — anything that comes back after it still wins the port, and because one failing child tears down the whole stack, a single collision costs you the entire run. Check with `ss -lptn 'sport = :3002'` and kill what you find before re-running.

`db:up` and `dgraph:up` run a bare `docker run` rather than compose. They reuse the same container names and bind mounts, but a container compose did not create is one compose will not adopt — so a stack brought up that way makes the next `npm start` die with `Conflict. The container name "/lore-postgres" is already in use`, behind the misleading `backing services did not become healthy — check 'docker compose logs'`. Prefer `services:up`; if you hit the conflict, `docker rm -f lore-postgres lore-dgraph` and re-run. The data survives — it lives in the bind mount, not the container.

### Working in a git worktree

Run `scripts/worktree-bootstrap.sh` once per worktree. A fresh `git worktree` has no `node_modules` and no built workspace libs, so module resolution escapes into the main checkout's (possibly stale) install and `eslint`/`tsc` fail or go falsely green. The `.claude/settings.json` SessionStart hook runs it automatically, but only when the checkout has no `node_modules` yet — after editing `libs/*/src`, re-run it yourself so package-level `tsc --noEmit` sees the fresh types (vitest reads source, `tsc` reads `dist`).

### Starting over from scratch

To re-test this path end to end, tear the local stack down:

```bash
minikube delete                                  # removes its own kubectl context, leaves others alone
docker rm -f lore-postgres lore-dgraph
rm -f .env.local .lore-kubeconfig-minikube .lore-nextauth-secret
docker run --rm -v "$PWD:/work" alpine:3.20 \
  sh -c 'rm -rf /work/.lore-pgdata /work/.lore-dgraphdata /work/.lore-archive'
```

The data dirs are written by the containers as root, so a plain `rm -rf` hits `Permission denied` — the throwaway container removes them without sudo. Back up `.env.local` first if the credentials in it are not easily re-minted. `.lore-nextauth-secret` is regenerated automatically on the next `npm start`.

### Logging into the web UI

The web UI (`:3000`) is gated by NextAuth with GitHub OAuth, so a one-time OAuth app is required before you can sign in:

1. Create a GitHub OAuth app at https://github.com/settings/developers → **New OAuth App**:
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:** `http://localhost:3000/api/auth/callback/github`
2. Register it, copy the **Client ID**, and **Generate a new client secret**.
3. Put both in `apps/web-ui/.env.local` (gitignored, auto-loaded by `next dev`):

   ```
   GITHUB_OAUTH_CLIENT_ID=...
   GITHUB_OAUTH_CLIENT_SECRET=...
   ```

4. Restart `npm start` so the web-ui reloads `.env.local`, then **Sign in with GitHub**.

Optionally set `GITHUB_ALLOWED_ORG` in the same file to restrict login to one org's members (unset = any GitHub account). The callback URL must match exactly, or GitHub returns a `redirect_uri` error.

## Project structure

```
lore/
├── apps/                       # deployable services
│   ├── floor/                  # Floor — coordinator runtime (drain loop, AssemblyRun walk, dispatch, SSE)
│   ├── event-router/           # Sole writer of pipeline.events — one front door + the claim API (ADR-044)
│   ├── cluster-agent/          # The only process that talks to this cluster's Kubernetes API
│   ├── lore-api/               # Remote REST backend (/api/*) on GKE — DB / GitHub / GCS / tree-sitter
│   ├── stations/               # Service stations — POST /api/stations/{name} (merge-check, approval-check)
│   ├── mcp-server/             # Local stdio MCP adapter (+ the in-cluster lore-mcp HTTP gateway)
│   ├── lore-station/           # Station pod image (runs one non-agent assembly-line node per pod)
│   ├── lore-code-trace/        # Go binary — runs a repo's test suite in CI and posts the trace
│   ├── web-ui/                 # Next.js dashboard (repo-centric UI, GitHub OAuth)
│   └── vscode-extension/       # VS Code extension (spec ↔ code highlighting)
├── libs/                       # shared libraries (consumed by apps)
│   ├── shared/                 # @re-cinq/lore-shared — chunker, redact, Project facade, types
│   ├── server-core/            # @re-cinq/lore-server-core — light business logic shared by both deployables
│   └── assembly-lines/         # @re-cinq/lore-assembly-lines — assembly-line loader, graph, node outcomes
├── infra/                      # deploy & runtime
│   ├── terraform/modules/      # Terraform + the `lore-platform` umbrella Helm chart (9 subcharts:
│   │                           #   floor / event-router / cluster-agent / lore-api / lore-mcp /
│   │                           #   stations / ui / lore-db / ai-agents)
│   └── compose.yaml            # Local Postgres + Dgraph for the dev stack
├── scripts/                    # install.sh, lore-doctor, infra setup scripts
├── adrs/                       # Architecture decision records (MADR format)
├── specs/                      # Feature specifications (speckit workflow)
├── runbooks/                   # Incident & operational runbooks
├── teams/                      # Per-team CLAUDE.md overrides
├── docs/                       # Guides (using-lore, building-lore)
└── .github/workflows/          # CI: build + push containers for Floor, Lore API, MCP, station, UI
```

npm workspaces cover `libs/*` and the TypeScript apps (`cluster-agent`, `event-router`, `floor`, `lore-api`, `stations`, `lore-station`, `mcp-server`, `vscode-extension`) — the root `package.json` names each one explicitly rather than globbing `apps/*`. `web-ui` is a standalone Next.js app (its own lockfile, not a workspace), and `lore-code-trace` is a Go module.

> **Gap worth knowing.** `event-router`, `cluster-agent`, and `stations` each have a
> `Dockerfile` and a Helm subchart, but no `build-*.yml` workflow — their chart values
> still read `tag: latest` while every CI-built service is pinned to a short SHA. Their
> images are built by hand today; a change to one of them does not ship by merging.

## Tech stack

| Layer | Technology |
|-------|-----------|
| MCP Server | TypeScript, `@modelcontextprotocol/sdk`, Zod |
| Lore API | TypeScript, `@hapi/hapi` (REST), Zod, `pg`, Octokit, tree-sitter |
| Floor | TypeScript, `@anthropic-ai/sdk`, Claude Code (headless) |
| event-router / stations | TypeScript, `@hapi/hapi`, Zod, `pg` |
| cluster-agent | TypeScript, `@hapi/hapi`, `@kubernetes/client-node` (the only app that holds it, besides the event-router's watch) |
| Web UI | Next.js 15, NextAuth v4 (GitHub OAuth) |
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
