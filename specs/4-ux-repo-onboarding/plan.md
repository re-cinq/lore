# Implementation Plan: UX Redesign + Repo Onboarding

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | UX Redesign + Repo Onboarding               |
| Branch         | 4-ux-repo-onboarding                        |
| Status         | Planned                                     |
| Created        | 2026-03-29                                  |
| Estimated      | 9 working days (3 phases)                   |

## Phase 1: Repo Registry + Onboarding Backend (3 days)

### Day 1: Database + Schema

**Task 1.1: Create `lore.repos` table**

New schema `lore` in PostgreSQL (separate from `pipeline`, `memory`,
and `org_shared` — this is cross-cutting platform data).

Schema setup script: `scripts/infra/setup-repos-schema.sh`

Table: `lore.repos`

| Field               | Type         | Constraints                       |
|---------------------|--------------|-----------------------------------|
| id                  | UUID         | PK, DEFAULT gen_random_uuid()     |
| owner               | TEXT         | NOT NULL                          |
| name                | TEXT         | NOT NULL                          |
| full_name           | TEXT         | UNIQUE NOT NULL (owner/name)      |
| team                | TEXT         | nullable                          |
| onboarded_at        | TIMESTAMPTZ  | DEFAULT now()                     |
| last_ingested_at    | TIMESTAMPTZ  | nullable                          |
| onboarding_pr_url   | TEXT         | nullable                          |
| onboarding_pr_merged| BOOLEAN      | DEFAULT false                     |
| settings            | JSONB        | nullable                          |

Indexes:
- UNIQUE on `full_name`
- INDEX on `owner`
- INDEX on `team`

**Task 1.2: MCP tools — `list_repos`, `onboard_repo`**

Add to `mcp-server/src/index.ts`:
- `list_repos` — queries `lore.repos`, returns all onboarded repos
  with activity summary (task count, last ingested, onboarding status).
- `onboard_repo` — accepts `owner/name`, triggers the onboarding
  module, returns the onboarding PR URL.

### Day 2: Onboarding Module

**Task 1.3: Onboarding module — `mcp-server/src/repo-onboard.ts`**

New module that handles the full onboarding flow:

1. Fetch repos from GitHub App installation via
   `GET /app/installations/{installation_id}/repositories` (octokit).
2. Filter to repos not yet in `lore.repos`.
3. On `onboard_repo` call:
   a. Create branch `lore/onboarding` on target repo.
   b. Commit onboarding files (from templates).
   c. Open PR via `pipeline-github.ts` (existing module).
   d. Insert row into `lore.repos` with `onboarding_pr_url`.
   e. Return PR URL.

GitHub App: `lore-agent` (App ID GITHUB_APP_ID), already configured with
repo contents + pull request permissions.

**Task 1.4: Onboarding templates — `scripts/onboarding-templates/`**

Static template files, version-controlled in the lore repo:

- `CLAUDE.md` — skeleton with HTML comment prompts for Architecture,
  Code Conventions, Key Services, Testing Patterns.
- `AGENTS.md` — instructions pointing to Lore MCP, task tracking via
  Beads, delegation patterns.
- `.github/PULL_REQUEST_TEMPLATE.md` — required sections: Why,
  Alternatives Rejected, ADR References, Spec.
- `.github/workflows/pr-description-check.yml` — CI check for PR
  description quality (warning-only first 2 weeks, hard fail after).
- `.github/workflows/spec-agent.yml` — spec PR triggers
  implementation agent via Klaus.

### Day 3: API Routes + Integration Testing

**Task 1.5: API routes for the web UI**

New API routes in `web-ui/src/app/api/`:
- `GET /api/repos` — list all repos from `lore.repos`.
- `GET /api/repos/available` — list repos from GitHub App installation
  that are not yet onboarded.
- `POST /api/repos/onboard` — trigger onboarding for a repo.
- `GET /api/repos/[owner]/[repo]` — repo detail with activity summary.

**Task 1.6: Integration test**

Verify end-to-end: call `onboard_repo` via MCP, confirm branch +
files + PR created on a test repo, confirm `lore.repos` row written.

## Phase 2: Repo-Centric UI Redesign (4 days)

### Day 4: Route Restructure + Repo List

**Task 2.1: Restructure `web-ui/src/app/` routes**

New route structure:

```
web-ui/src/app/
  page.tsx                          # / → Repo list (replaces agent overview)
  onboard/page.tsx                  # /onboard → Add repo page
  repos/[owner]/[repo]/
    page.tsx                        # Repo detail overview
    tasks/page.tsx                  # Pipeline tasks for this repo
    context/page.tsx                # CLAUDE.md, ADRs, chunks
    specs/page.tsx                  # Specs for this repo
    agents/page.tsx                 # Agent memories for this repo
    settings/page.tsx               # Repo config
    layout.tsx                      # Shared repo layout with tabs
  search/page.tsx                   # Global search (keep as-is)
  audit/page.tsx                    # Global audit (keep as-is)
  pools/page.tsx                    # Shared pools (keep as-is)
```

Strategy: keep existing page components, re-mount them under
`/repos/[owner]/[repo]/` routes. The existing `/pipeline`, `/agents`,
`/context`, `/specs` pages become the building blocks for repo-scoped
views — filter their data by the `owner/repo` params.

**Task 2.2: Home page — repo list**

Replace the current home page with a repo list showing:
- Repo name (owner/repo).
- Team tag.
- Task count by status (queued, in-progress, done, failed).
- Last activity timestamp.
- Context freshness (last_ingested_at).
- Onboarding status badge (discovered / pr-created / onboarded / active).
- "Add Repo" button → `/onboard`.

### Day 5: Repo Detail + Tabs

**Task 2.3: Repo detail layout — `repos/[owner]/[repo]/layout.tsx`**

Shared layout with:
- Repo header (name, team, status badge, settings gear icon).
- Tab bar: Overview, Tasks, Context, Specs, Agents, Settings.
- Tabs are Next.js links to the sub-routes.

**Task 2.4: Repo sub-pages**

- Overview: recent tasks, active agents, context freshness, latest PRs.
- Tasks: re-use existing pipeline page component, filtered by repo.
- Context: re-use existing context page, filtered by repo.
- Specs: re-use existing specs page, filtered by repo.
- Agents: re-use existing agents page, filtered by repo.
- Settings: repo config form (team, ingestion schedule, task types).

### Day 6: Onboard Page + Task Creation

**Task 2.5: `/onboard` page**

- Fetches `GET /api/repos/available` (unboarded repos from GitHub App).
- Dropdown to select a repo.
- "Onboard" button → `POST /api/repos/onboard`.
- Shows progress: creating branch... committing files... opening PR...
- On success: shows PR link, button to view repo in dashboard.

**Task 2.6: Repo-scoped task creation**

- "New Task" button on repo detail page pre-fills the repo.
- Repo field is a read-only display (not a free-text input).
- Task type selector shows descriptions from `scripts/task-types.yaml`.

### Day 7: Form Styling + Navigation Fixes

**Task 2.7: Form styling overhaul**

Extend `web-ui/src/app/globals.css` with form-specific styles:
- Consistent text input, textarea, select, button styling.
- Focus states, validation states, error messages.
- Dark mode compatibility (existing theme).
- Apply across all pages (task creation, search, settings, onboard).

**Task 2.8: Fix /pipeline redirect issue**

Investigate and fix the unexpected redirect to `/pipeline`. Likely
caused by a middleware or layout redirect that should be removed now
that `/` is the repo list.

**Task 2.9: Update sidebar navigation**

- Remove tool-centric nav items (Pipeline, Agents, Memory, Context, Specs).
- Add: Repos (home), Search, Audit, Pools.
- Active state follows current route.

## Phase 3: Polish + Ingestion Integration (2 days)

### Day 8: Post-Merge Ingestion

**Task 3.1: Detect onboarding PR merge**

- Webhook or polling: when the onboarding PR is merged, update
  `lore.repos` row: `onboarding_pr_merged = true`.
- Trigger initial ingestion for the repo (via Klaus agent).

**Task 3.2: Per-repo nightly ingestion**

- Extend existing nightly CronJob to iterate over all repos in
  `lore.repos` where `onboarding_pr_merged = true`.
- Each repo gets its own ingestion run (not just the lore repo).
- Update `last_ingested_at` after each successful run.

### Day 9: Dashboard Polish

**Task 3.3: Repo freshness indicator**

- Dashboard shows freshness badge per repo:
  - Green: ingested within 24h.
  - Yellow: ingested within 7 days.
  - Red: not ingested or older than 7 days.
  - Gray: not yet ingested (onboarding PR not merged).

**Task 3.4: Edge case fixes**

- Handle repos where GitHub App is uninstalled after onboarding.
- Handle repos that are archived or deleted on GitHub.
- Empty states for repos with no tasks, no context, etc.
- Loading and error states across all new pages.

**Task 3.5: Smoke test full flow**

End-to-end validation:
1. Open Lore UI → see repo list.
2. Click "Add Repo" → select repo → onboarding PR created.
3. Merge PR on GitHub.
4. Repo appears in dashboard with "active" status.
5. Navigate to repo → see context, tasks, specs tabs.
6. Create a task scoped to the repo.
7. Search across repos — results attributed correctly.

## Constitution Compliance Check

| Principle | Compliance | Notes |
|-----------|------------|-------|
| P1: DX-First Delivery | PASS | Onboarding is one-click, no manual setup |
| P2: Zero Stored Credentials | PASS | GitHub App auth via existing Workload Identity; no new credentials |
| P3: PR Description Quality Gates | PASS | Onboarding PR includes the PR template + CI check |
| P4: Three-Command Developer Interface | PASS | No new commands for developers; onboarding is UI-driven |
| P5: Single Interface (Lore MCP) | PASS | `list_repos` and `onboard_repo` added to MCP |
| P6: Distributed Ownership | PASS | Onboarding PR is reviewed by repo owner, not platform |
| P7: Architecture Decisions Are Final | PASS | Uses PostgreSQL (CNPG), GKE, existing stack |
| P8: Schema-Per-Team Isolation | PASS | `lore` schema is platform-level, not team data |
| P9: Intelligent Agents Over Mechanical Scripts | PASS | Post-merge ingestion runs via Klaus agent |
| P10: Opt-In Data Collection | PASS | Repo onboarding is explicit opt-in by the repo owner |

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| GitHub App permissions insufficient for creating branches/PRs on target repos | Low | High | Verify App permissions upfront; document required scopes |
| Existing page components tightly coupled to current routes | Medium | Medium | Refactor to accept owner/repo as props; keep old routes as redirects during transition |
| Onboarding PR conflicts with existing files in target repo | Low | Low | Check for existing files before committing; skip files that already exist |
| Nightly ingestion overloads with many repos | Low | Medium | Stagger ingestion; add concurrency limit to CronJob |
| Form styling breaks existing pages | Low | Medium | Scope new styles carefully; test all pages before merging |

## Critical Path

```
Phase 1 (backend):
  setup-repos-schema.sh → repo-onboard.ts → MCP tools → API routes
                                                              │
Phase 2 (frontend):                                           ▼
  Route restructure → Repo list page → Repo detail + tabs → Onboard page → Form styling
                                                                                  │
Phase 3 (integration):                                                            ▼
  PR merge detection → Per-repo ingestion → Freshness indicators → Smoke test
```

The critical path runs through the API routes (end of Phase 1) into
the route restructure (start of Phase 2). Form styling and navigation
fixes can be parallelized with the onboard page work.

## Dependencies

| Dependency | Status | Owner |
|------------|--------|-------|
| GitHub App (lore-agent, App ID GITHUB_APP_ID) | Configured | Platform Engineering |
| PostgreSQL (CNPG) | Running (schemas: org_shared, memory, pipeline) | Platform Engineering |
| Pipeline module (pipeline-github.ts) | Existing | Platform Engineering |
| Web UI (Next.js App Router, lore-ui namespace) | Deployed on GKE | Platform Engineering |
| GitHub OAuth | Working on the UI | Platform Engineering |
| Klaus agents | Running in klaus namespace | Platform Engineering |
