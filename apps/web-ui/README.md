# Lore Web UI (`@re-cinq/lore-ui`)

The Lore platform frontend — a [Next.js](https://nextjs.org) (App Router, React
19) app for browsing context, the task pipeline, the knowledge graph, specs, and
analytics. Unlike the other apps, this is a **standalone** Next.js app with its
own lockfile, not an npm-workspace member.

> Detailed design notes and known gotchas (the specs viewer URL-encoding
> contract, DB access patterns, manually-added specs without embeddings) live in
> [`CLAUDE.md`](./CLAUDE.md).

## What's in it

- **Repo views** (`/repos/[owner]/[repo]`) — overview, tasks, specs, context,
  ADRs, graph, settings, plus self-service onboarding.
- **Assembly Lines** (`/assembly-runs`) — cross-repo run list and live run
  detail; task detail lives at `/tasks/[id]` (logs, PR status, stage
  timeline). Legacy `/pipeline` URLs redirect here.
- **Cross-repo** — global specs viewer, semantic search, knowledge-graph
  explorer, episodes, gaps, analytics/spend, audit log, memory pools.
- **API routes** (`src/app/api/`) — pipeline actions, repo context/settings,
  onboarding, GitHub-App-backed PR status, the sign-in routes.

## Layout

```
src/
  app/        App Router pages + route handlers (see the tree in CLAUDE.md)
  components/  shared React components
  lib/
    api/       typed clients over the lore-api routes (types generated from
               apps/lore-api/openapi.json into schema.d.ts)
    github.ts  GitHub App client for PR status
    theme/     fonts + theme
  middleware.ts
```

The web UI holds **no database pool** — `pg` is not a dependency, and the
`lore/no-sql-in-web-ui` lint rule runs at `error`. All data access goes through
the typed clients in [`src/lib/api/`](./src/lib/api) over the lore-api `/api/*`
routes. Auth is a session cookie: lore-api runs the GitHub sign-in and mints the token the cookie holds (ADR-053).

## Develop

```bash
npm install            # from this directory (own lockfile, not a workspace)
npm run dev            # http://localhost:3000
npm test               # vitest + Testing Library (jsdom)
npm run build          # production build (Next standalone output)
```

For the full local stack (Postgres + every service), run `npm start` from
the repo root; the UI comes up on `:3000`. With `LORE_API_URL=https://...` in
the root `.env.local`, `npm start` runs only the UI against that backend. The
root `.env.local` is the one env file; `apps/web-ui/.env.local` is ignored by
`npm start`.

## Deploy

Built into a container via [`Dockerfile`](./Dockerfile) (Next standalone output)
and deployed to GKE via Terraform/Helm. A pre-install/pre-upgrade Helm hook
also runs the ordered, idempotent SQL migrations in
[`infra/.../ui-helm/migrations/`](../../infra) on every deploy of the
`lore-platform` umbrella (not just UI changes). See the root
README and [`infra/`](../../infra).
