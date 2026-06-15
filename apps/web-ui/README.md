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
- **Pipeline** (`/pipeline`) — task list and live detail (logs, PR status,
  stage timeline).
- **Cross-repo** — global specs viewer, semantic search, knowledge-graph
  explorer, episodes, gaps, analytics/spend, audit log, memory pools.
- **API routes** (`src/app/api/`) — pipeline actions, repo context/settings,
  onboarding, GitHub-App-backed PR status, NextAuth.

## Layout

```
src/
  app/        App Router pages + route handlers (see the tree in CLAUDE.md)
  components/  shared React components
  lib/
    db.ts      PostgreSQL pool + cross-schema helpers (query, queryOne, queryAllChunks)
    github.ts  GitHub App client for PR status
    theme/     fonts + theme
  middleware.ts
```

All DB access goes through [`src/lib/db.ts`](./src/lib/db.ts). The DB user is
`lore_ui` (read-only on team schemas); `queryAllChunks` fans a query across every
team schema + `org_shared`. Auth is NextAuth (GitHub).

## Develop

```bash
npm install            # from this directory (own lockfile, not a workspace)
npm run dev            # http://localhost:3000
npm test               # vitest + Testing Library (jsdom)
npm run build          # production build (Next standalone output)
```

For the full local stack (Postgres + all four services), run `npm start` from
the repo root; the UI comes up on `:3000`.

## Deploy

Built into a container via [`Dockerfile`](./Dockerfile) (Next standalone output)
and deployed to GKE via Terraform/Helm. The deploy path also runs the ordered,
idempotent SQL migrations in
[`infra/.../ui-helm/migrations/`](../../infra) on every UI deploy. See the root
README and [`infra/`](../../infra).
