# Contributing to Lore

**For people developing the Lore platform.** This guide gets you from a clone to a running local stack, then orients you in the codebase — the repo layout, the technologies in play, and the design principles that decisions are measured against. For the PR checklist and code conventions, see the root [CONTRIBUTING.md](../../CONTRIBUTING.md) and [CLAUDE.md](../../CLAUDE.md).

---

## Run the full stack locally

`scripts/install.sh` runs once per machine and configures the MCP server, skills, hooks, statusline, and agent ID — that's enough to *use* Lore against a deployed backend. To run the **entire** stack on your own machine instead:

```bash
npm start
```

This runs `scripts/dev-local.sh`, which brings up a Docker Postgres (pgvector, data persisted to the git-ignored `.lore-pgdata/`), builds `libs/shared` → `libs/runner` → `apps/mcp-server` → `apps/floor`, then runs all four components under `concurrently` with live reload.

Ports:

| Component | Port |
|-----------|------|
| web-ui | `:3000` |
| mcp-server | `:3001` |
| floor | `:8080` |
| Postgres | `:5432` |

Useful sub-commands:

- `npm run db:up` / `npm run db:down` — manage the Postgres container on its own
- `npm run db:schema` — apply the schema DDL

On first run, `scripts/infra/setup-local-schema.sh` bootstraps the `lore`/`lore_ui` roles, the pgvector extension, and all schemas by shimming `kubectl` → `docker exec` so the existing `setup-*.sh` scripts run unmodified against the container (no SQL duplication). It then applies the `ui-helm/migrations/*.sql` incremental migrations the same way the GKE Helm hook does — tracked in `lore.schema_migrations`, in filename order, one transaction per file, skipping already-applied ones — so migration-added tables exist locally even though local dev has no Helm hook. `npm start` runs this automatically once Postgres is ready.

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

### Agent credentials (the Floor)

Pipeline tasks — onboarding, implementation, review — run in the **Floor** (`:8080`), which creates branches and PRs through **GitHub App auth only** (`apps/floor/src/adapters/github.ts`) and generates files via an LLM. Without these credentials every such task fails immediately with `GitHub App not configured — cannot create PR`.

They live in the **root** `.env.local` (gitignored, sourced by `dev-local.sh` on `npm start`) — a different file from the web-UI's `apps/web-ui/.env.local` above.

**re:cinq members — do this, skip the rest.** The deployed Lore App already exists, so you create nothing in GitHub. Lore's secrets live in a dedicated GCP project's Secret Manager — **ask your infra / platform team for the project id** and for `roles/secretmanager.secretAccessor` on it if you don't already have access.

1. **Create your local file** from the template:

   ```bash
   cp .env.local.example .env.local
   ```

2. **Set the project, then check you can read the secrets** (and that you're authenticated):

   ```bash
   export PROJECT=<lore-gcp-project>   # ask your infra / platform team for the id
   gcloud secrets versions access latest --secret=lore-github-app-id --project="$PROJECT"
   ```

   A value prints → you're set. An error → see the list at the end of this section.

3. **Fetch each value and paste it** into the matching line in `.env.local`. Print one secret at a time:

   ```bash
   gcloud secrets versions access latest --secret=<secret-name> --project="$PROJECT"
   ```

   | Secret name | Paste into |
   |---|---|
   | `lore-github-app-id` | `GITHUB_APP_ID=` |
   | `lore-github-app-installation-id` | `GITHUB_APP_INSTALLATION_ID=` |
   | `lore-anthropic-api-key` | `ANTHROPIC_API_KEY=` |

4. **For the private key**, copy it to your clipboard so the PEM's line breaks survive, then paste it **between the quotes** of `GITHUB_APP_PRIVATE_KEY="..."`:

   ```bash
   gcloud secrets versions access latest --secret=lore-github-app-private-key --project="$PROJECT" | pbcopy
   ```

   The Floor consumes the key raw — keep the real line breaks. If what you paste shows a literal `\n` instead of line breaks, replace each `\n` with an actual newline.

5. **Restart `npm start`** so the Floor reloads the values.

If a fetch fails:

- **`CONSUMER_INVALID`** — your gcloud *default* project is a different (stale) one. Always pass `--project="$PROJECT"` (or run `gcloud config set project "$PROJECT"`).
- **`PERMISSION_DENIED`** — you lack `roles/secretmanager.secretAccessor` on the project. Ask your infra / platform team to grant it (or, if you're an admin): `gcloud projects add-iam-policy-binding "$PROJECT" --member="user:you@re-cinq.com" --role="roles/secretmanager.secretAccessor"`.
- **`NOT_FOUND`** — the secret names differ in your deployment; list them: `gcloud secrets list --project="$PROJECT" --filter="name:lore"`.
- **Don't know the project id, or which secrets exist?** Ask your infra / platform team — they own the Lore deployment.

<details>
<summary><b>Setting up a fresh org instead?</b> Create your own GitHub App and fill these by hand.</summary>

Copy the template (`cp .env.local.example .env.local`) and populate:

| Variable | What it is | Where to get it |
|----------|-----------|-----------------|
| `GITHUB_APP_ID` | The GitHub App's numeric ID | App settings → General → "App ID" |
| `GITHUB_APP_INSTALLATION_ID` | The installation's ID | The number in `…/settings/installations/<ID>` |
| `GITHUB_APP_PRIVATE_KEY` | The App private key (PEM) | App settings → "Generate a private key" → paste the `.pem` with **real line breaks**, wrapped in double quotes (the Floor consumes it raw — no `\n` un-escaping) |
| `ANTHROPIC_API_KEY` | Claude API key for file generation | https://console.anthropic.com → API Keys |

The GitHub App needs Repository, Issues, and Pull requests read/write (see [INSTALL.md](../INSTALL.md)).

</details>

## Project structure

```
lore/
├── apps/                       # deployable services
│   ├── floor/                  # Floor — coordinator runtime (TypeScript: task runner, scheduler, controllers)
│   ├── mcp-server/             # MCP server (serves context + memory + pipeline)
│   ├── web-ui/                 # Next.js dashboard (repo-centric UI, GitHub OAuth)
│   └── vscode-extension/       # VS Code extension (spec ↔ code highlighting)
├── libs/                       # shared libraries (consumed by apps)
│   ├── shared/                 # @re-cinq/lore-shared — chunker, redact, Project facade, types
│   └── runner/                 # @re-cinq/lore-runner — execution kernel (supervisor, workflows)
├── infra/                      # deploy & runtime
│   ├── terraform/modules/      # Helm charts (floor-helm, mcp-helm, ui-helm, lore-db-helm), LoreTask CRD
│   ├── docker/claude-runner/   # Ephemeral container for Claude Code in K8s Jobs
│   ├── k8s/                    # Ingress manifests, CronJobs
│   └── compose.yaml            # Local Postgres/Dgraph for the dev stack
├── scripts/                    # install.sh, lore-doctor, infra setup scripts
├── adrs/                       # Architecture decision records (MADR format)
├── specs/                      # Feature specifications (speckit workflow)
├── runbooks/                   # Incident & operational runbooks
├── teams/                      # Per-team CLAUDE.md overrides
├── docs/                       # Guides (using-lore, building-lore)
└── .github/workflows/          # CI: build + push containers for Floor, MCP, UI, runner
```

npm workspaces live under `apps/*` + `libs/*`; `web-ui` is a standalone Next.js app (its own lockfile, not a workspace).

## Tech stack

| Layer | Technology |
|-------|-----------|
| MCP Server | TypeScript, `@modelcontextprotocol/sdk`, Zod |
| Floor | TypeScript, `@anthropic-ai/sdk`, Claude Code (headless) |
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

Use the `/lore-feature` skill to start or continue a feature — it guides you through spec → plan → tasks → implementation interactively. When you're ready to open a PR, `/lore-pr` drafts a description from your spec and changed files against the template in `.github/pull_request_template.md`. Full conventions live in [CLAUDE.md](../../CLAUDE.md); the PR checklist is in the root [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## See also

- [Architecture](architecture.md) — how the components you're editing fit together.
- [Scheduled Jobs](scheduled-jobs.md) — the recurring jobs the Floor runs.
- [CONTRIBUTING.md](../../CONTRIBUTING.md) and [CLAUDE.md](../../CLAUDE.md) — PR checklist and full code conventions.
- [Back to README](../../README.md)
