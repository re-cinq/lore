# Tasks: UX Redesign + Repo Onboarding

| Field   | Value                                |
|---------|--------------------------------------|
| Feature | UX Redesign + Repo Onboarding        |
| Branch  | 4-ux-repo-onboarding                 |
| Plan    | [plan.md](plan.md)                   |
| Spec    | [spec.md](spec.md)                   |
| Created | 2026-03-29                           |

## User Story Map

| Story | Spec Scenario                | Priority | Phase |
|-------|------------------------------|----------|-------|
| US1   | Repo-Centric Dashboard       | P1       | 2     |
| US2   | Onboard a New Repo           | P1       | 1-2   |
| US3   | Create Task Scoped to Repo   | P2       | 2     |
| US4   | Cross-Repo Search            | P2       | 2     |
| US5   | Repo Settings                | P3       | 2     |

---

## Phase 1: Setup

- [x] T001 Create repos schema DDL script in scripts/infra/setup-repos-schema.sh (lore.repos table with indexes, grants to lore user)
- [x] T002 Run schema DDL on the existing lore database
- [x] T003 [P] Create onboarding template files in scripts/onboarding-templates/ (CLAUDE.md, AGENTS.md, PR template, pr-description-check.yml, spec-agent.yml)

---

## Phase 2: Foundational — Repo Backend

- [x] T004 Create mcp-server/src/repo-onboard.ts: fetch repos from GitHub App installation, filter to unonboarded, onboard flow (create branch, commit templates, open PR, insert to lore.repos)
- [x] T005 Register list_repos MCP tool in mcp-server/src/index.ts: query lore.repos with activity summary (task count from pipeline.tasks, last_ingested_at)
- [x] T006 Register onboard_repo MCP tool in mcp-server/src/index.ts: calls repo-onboard.ts, returns PR URL
- [x] T007 Create web-ui API route for fetching available repos: web-ui/src/app/api/repos/route.ts (queries GitHub App installation repos + lore.repos to show onboarded vs available)

---

## Phase 3: US1 — Repo-Centric Dashboard [P1]

### Story Goal
Home page shows repos, not agents. Each repo links to a detail
page with tabs for tasks, context, specs, and agents.

### Independent Test Criteria
- Home page shows list of onboarded repos with activity summary.
- Clicking a repo shows its detail page with tabs.
- Each tab shows data scoped to that repo.

### Tasks

- [x] T008 [US1] Create web-ui/src/app/page.tsx (replace): repo list as home page — queries lore.repos + pipeline.tasks count + last_ingested_at, shows repo cards with activity badges
- [x] T009 [US1] Create web-ui/src/app/repos/[owner]/[repo]/layout.tsx: repo detail layout with tab navigation (Overview, Tasks, Context, Specs, Agents, Settings)
- [x] T010 [US1] Create web-ui/src/app/repos/[owner]/[repo]/page.tsx: overview tab — recent tasks, active agents, context freshness, latest PRs
- [x] T011 [P] [US1] Create web-ui/src/app/repos/[owner]/[repo]/tasks/page.tsx: pipeline tasks filtered by target_repo
- [x] T012 [P] [US1] Create web-ui/src/app/repos/[owner]/[repo]/context/page.tsx: CLAUDE.md + ADRs + runbooks from org_shared.chunks WHERE file_path matches repo
- [x] T013 [P] [US1] Create web-ui/src/app/repos/[owner]/[repo]/specs/page.tsx: .specify/ specs for this repo
- [x] T014 [P] [US1] Create web-ui/src/app/repos/[owner]/[repo]/agents/page.tsx: agent memories scoped to agents that worked on this repo
- [x] T015 [US1] Update web-ui/src/app/SidebarNav.tsx: replace tool-centric nav with repo-centric (Repos, Search, Audit, Pools) + Add Repo button

---

## Phase 4: US2 — Onboard a New Repo [P1]

### Story Goal
User clicks "Add Repo", selects from GitHub repos, Lore creates
onboarding PR with all required files.

### Independent Test Criteria
- /onboard page shows repos from GitHub App not yet in lore.repos.
- Clicking a repo creates a PR on the target repo.
- PR contains CLAUDE.md, AGENTS.md, PR template, workflows.
- Repo appears in dashboard after PR is merged.

### Tasks

- [x] T016 [US2] Create web-ui/src/app/onboard/page.tsx: shows available repos (from API route T007), click to onboard, shows progress + PR link
- [x] T017 [US2] Create web-ui/src/app/api/onboard/route.ts: server action that calls onboard_repo via direct PostgreSQL + GitHub API (not MCP, since UI has its own DB connection)
- [x] T018 [US2] Add merge detection for onboarding PRs: polling or webhook that checks if onboarding PR is merged, updates lore.repos.onboarding_pr_merged = true
- [x] T019 [US2] Trigger initial ingestion after onboarding PR merge: when PR merged, clone repo content into org_shared.chunks with repo attribution

---

## Phase 5: US3 — Create Task Scoped to Repo [P2]

### Story Goal
Task creation is always scoped to a repo via dropdown, not free text.

### Independent Test Criteria
- Task creation form shows repo dropdown (only onboarded repos).
- Created task has target_repo pre-filled.
- Task appears in the repo's tasks tab.

### Tasks

- [x] T020 [US3] Update web-ui/src/app/repos/[owner]/[repo]/tasks/page.tsx: add "New Task" button that opens creation form with repo pre-filled
- [x] T021 [US3] Create web-ui/src/app/repos/[owner]/[repo]/tasks/create/page.tsx: task creation form with repo locked to current repo, task type dropdown, description textarea
- [x] T022 [US3] Update web-ui/src/app/pipeline/create/page.tsx: replace free-text repo input with dropdown of onboarded repos from lore.repos

---

## Phase 6: US4 — Cross-Repo Search [P2]

### Story Goal
Global search returns results attributed to their source repo.

### Independent Test Criteria
- Search results show which repo each result belongs to.
- Can filter by repo.
- Works across context chunks, memories, and specs.

### Tasks

- [x] T023 [US4] Update web-ui/src/app/search/page.tsx: add repo filter dropdown, show repo attribution on each result, search across org_shared.chunks + memory.memories with repo context
- [x] T024 [P] [US4] Add repo column to search results: join org_shared.chunks.metadata->>'file_path' to determine source repo

---

## Phase 7: US5 — Repo Settings [P3]

### Story Goal
Platform engineer configures per-repo settings (team, ingestion,
task types).

### Independent Test Criteria
- Settings page shows current repo config.
- Changes saved to lore.repos.settings.
- Settings affect task type availability.

### Tasks

- [x] T025 [US5] Create web-ui/src/app/repos/[owner]/[repo]/settings/page.tsx: form to edit team, ingestion schedule, available task types, eval config. Saves to lore.repos.settings JSONB.
- [x] T026 [US5] Create web-ui/src/app/api/repos/[owner]/[repo]/settings/route.ts: POST handler to update lore.repos.settings

---

## Phase 8: Form Styling + Fixes

- [x] T027 Update web-ui/src/app/globals.css: comprehensive form styling — inputs, textareas, selects, buttons, labels, validation states, all consistent dark theme
- [x] T028 Fix /pipeline redirect issue: investigate and fix the middleware or layout causing unexpected redirect to /pipeline
- [x] T029 Remove redundant pages: /specs and /context now live under /repos/[owner]/[repo]/, remove or redirect old routes
- [x] T030 Update /pipeline/page.tsx: add repo column to pipeline dashboard table, link to repo detail

---

## Phase 9: Polish — Ingestion + Freshness

- [x] T031 Update nightly ingestion CronJob to iterate over lore.repos and ingest per-repo content (not just the lore repo)
- [x] T032 Add freshness indicator to repo list: show "last ingested X hours ago" with color coding (green < 24h, yellow < 7d, red > 7d)
- [x] T033 Build and push updated MCP server and web-ui images via CI (merge to main)
- [x] T034 Update CLAUDE.md to document repo onboarding flow and repo-centric UI

---

## Dependencies

```
Phase 1 (Setup: schema + templates)
  └── Phase 2 (Foundational: onboard module + MCP tools + API)
        ├── Phase 3 (US1: Repo dashboard + detail pages) ── T008-T015
        │     └── Phase 5 (US3: Task creation scoped to repo) ── T020-T022
        ├── Phase 4 (US2: Onboard flow + UI) ── T016-T019
        ├── Phase 6 (US4: Cross-repo search) ── T023-T024
        └── Phase 7 (US5: Repo settings) ── T025-T026
```

## Parallel Execution Opportunities

### Phase 1-2 (Days 1-3)
```
Agent A: T001, T002 (schema)
Agent B: T003 (templates) [P]
Then:
Agent A: T004 (onboard module)
Agent B: T005, T006 (MCP tools) [P]
Agent C: T007 (API route) [P]
```

### Phase 3-4 (Days 4-6)
```
Agent A: T008, T009, T010, T015 (home + layout + overview + nav)
Agent B: T011, T012, T013, T014 (repo detail tabs) [P]
Agent C: T016, T017 (onboard UI) [P]
Agent D: T018, T019 (merge detection + ingestion) [P]
```

### Phase 5-7 (Days 7-8)
```
Agent A: T020, T021, T022 (task creation) [P]
Agent B: T023, T024 (search) [P]
Agent C: T025, T026 (settings) [P]
```

### Phase 8-9 (Day 9)
```
Agent A: T027, T028, T029, T030 (styling + fixes) [P]
Agent B: T031, T032 (ingestion + freshness) [P]
Agent C: T033, T034 (deploy + docs)
```

## Implementation Strategy

### MVP (Phase 1-4, ~6 days)
- T001-T019: Repo registry, onboarding, repo-centric dashboard.
- Gate: user onboards a repo via UI and sees it in the dashboard.

### Full Feature (Phase 5-7, ~2 days)
- T020-T026: Scoped task creation, cross-repo search, settings.

### Polish (~1 day)
- T027-T034: Styling, fixes, ingestion, docs.

## Summary

| Metric                       | Value |
|------------------------------|-------|
| Total tasks                  | 34    |
| Phase 1 (Setup) tasks       | 3     |
| Phase 2 (Foundational) tasks | 4     |
| US1 (Dashboard) tasks        | 8     |
| US2 (Onboarding) tasks       | 4     |
| US3 (Scoped Tasks) tasks     | 3     |
| US4 (Search) tasks           | 2     |
| US5 (Settings) tasks         | 2     |
| Styling + Fixes tasks        | 4     |
| Polish tasks                 | 4     |
| Parallelizable tasks ([P])  | 14    |
| User stories covered         | 5/5   |
