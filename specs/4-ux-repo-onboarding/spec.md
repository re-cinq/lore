# Feature Specification: UX Redesign + Repo Onboarding

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | UX Redesign + Repo Onboarding               |
| Branch         | 4-ux-repo-onboarding                        |
| Status         | Shipped                                     |
| Created        | 2026-03-29                                  |
| Owner          | Platform Engineering                        |

## Problem Statement

The Lore UI is organized by tool (agents, memory, pipeline, search,
audit, context, specs). But users think in repos — "what's happening
in my service?" not "let me check the pipeline tab then the memory
tab then the specs tab." The current layout forces users to mentally
map across tabs to get a coherent picture of one repo.

Adding a new repo to Lore requires manual setup: install the GitHub
App, create CLAUDE.md, add workflows, configure the MCP server.
There's no self-service flow — it's all platform engineer work.

Text fields in forms are unstyled. The repo selector is a free-text
input instead of a dropdown. Specs and Context pages are redundant.
The UI redirects to /pipeline unexpectedly.

## Vision

Lore's UI is repo-centric. You pick a repo and see everything: its
context (CLAUDE.md, ADRs), active pipeline tasks, agent memory,
specs, and audit trail — all in one view. Adding a new repo is one
click: Lore creates an onboarding PR on the target repo with
everything needed (CLAUDE.md, skills, workflows, PR template). The
repo owner merges and they're live.

## User Personas

### Developer

Works in a specific repo. Opens Lore to see what agents are doing
in their repo, check specs, and create tasks scoped to their code.

### Product Owner

Creates tasks for specific repos. Needs to see which repos are
active, what tasks are running, and review agent PRs — all from
a repo-centric view.

### Platform Engineer

Onboards new repos, manages org-wide settings, monitors all
agents across all repos.

## User Scenarios & Acceptance Criteria

### Scenario 1: Repo-Centric Dashboard

**Actor:** Developer

**Flow:**
1. Developer opens Lore, sees a list of repos with activity summary.
2. Clicks their repo.
3. Sees: recent pipeline tasks, active agents, context (CLAUDE.md),
   specs, and audit trail — all for that repo.

**Acceptance Criteria:**
- Home page shows repos, not agents.
- Each repo shows: task count (by status), last activity, context
  freshness.
- Repo detail page has tabs: Overview, Tasks, Context, Specs, Agents.
- No need to visit separate /pipeline, /search, /audit pages.

### Scenario 2: Onboard a New Repo

**Actor:** Platform Engineer or Developer

**Flow:**
1. User clicks "Add Repo" in the Lore UI.
2. Selects a repo from their GitHub repos (dropdown, filtered by
   GitHub App installation).
3. Lore creates a PR on the target repo containing:
   - `CLAUDE.md` skeleton with HTML comment prompts
   - `AGENTS.md` pointing to Lore MCP
   - `.github/PULL_REQUEST_TEMPLATE.md`
   - `.github/workflows/pr-description-check.yml`
   - `.github/workflows/spec-agent.yml` (spec PR → agent trigger)
4. User sees the PR link in the UI.
5. Repo owner reviews and merges the PR.
6. Lore's nightly ingestion picks up the new repo's content.
7. Repo appears in the Lore dashboard.

**Acceptance Criteria:**
- One-click onboarding from the UI.
- PR created via the GitHub App (lore-agent bot).
- PR contains all required files with sensible defaults.
- After merge, repo content is ingested automatically.
- Repo appears in dashboard within 24 hours (or immediately if
  manual ingest is triggered).

### Scenario 3: Create Task Scoped to a Repo

**Actor:** Product Owner

**Flow:**
1. PO navigates to a repo's detail page.
2. Clicks "New Task" — repo is pre-filled.
3. Writes task description, selects type.
4. Task is created, agent spawns.

**Acceptance Criteria:**
- Task creation is scoped to the current repo (no free-text input).
- Repo dropdown only shows repos where the GitHub App is installed.
- Task appears in the repo's task list immediately.

### Scenario 4: Cross-Repo Search

**Actor:** Any user

**Flow:**
1. User uses the global search bar.
2. Results show context, memories, and specs across all repos.
3. Each result shows which repo it belongs to.

**Acceptance Criteria:**
- Search works across all repos.
- Results are attributed to their source repo.
- Can filter by repo.

### Scenario 5: Repo Settings

**Actor:** Platform Engineer

**Flow:**
1. Platform engineer opens a repo's settings tab.
2. Configures: team ownership, ingestion schedule, eval config,
   task types available.
3. Changes are saved to Lore's database.

**Acceptance Criteria:**
- Each repo has configurable settings.
- Settings affect which task types are available and how ingestion
  runs.

## Functional Requirements

### FR-1: Repo Registry

The system MUST maintain a registry of onboarded repos.

- FR-1.1: `repos` table in PostgreSQL: id, name (owner/repo),
  team, onboarded_at, last_ingested_at, settings (JSONB).
- FR-1.2: Repos populated from GitHub App installation (which repos
  the App has access to).
- FR-1.3: Repo list shown as the home page of the UI.
- FR-1.4: MCP tool `list_repos` returns all onboarded repos.

### FR-2: Repo Onboarding via PR

The system MUST onboard new repos by creating a PR.

- FR-2.1: "Add Repo" button in the UI shows repos from the GitHub
  App installation that aren't onboarded yet.
- FR-2.2: On click, Lore creates a branch `lore/onboarding` on the
  target repo.
- FR-2.3: Commits onboarding files: CLAUDE.md, AGENTS.md, PR
  template, workflows.
- FR-2.4: Opens a PR with description explaining what each file does.
- FR-2.5: Tracks the onboarding PR in the pipeline (status: pending
  until merged).
- FR-2.6: After merge, adds repo to the registry and triggers
  initial ingestion.

### FR-3: Repo-Centric UI Layout

The system MUST reorganize the UI around repos.

- FR-3.1: Home page (`/`) shows repo list with activity summary.
- FR-3.2: Repo detail (`/repos/[owner]/[repo]`) has tabs:
  Overview, Tasks, Context, Specs, Agents, Settings.
- FR-3.3: Overview tab shows: recent tasks, active agents, context
  freshness, latest PRs.
- FR-3.4: Tasks tab shows pipeline tasks filtered to this repo.
- FR-3.5: Context tab shows CLAUDE.md, ADRs, runbooks for this repo.
- FR-3.6: Specs tab shows .specify/ specs for this repo.
- FR-3.7: Agents tab shows agent memories scoped to this repo.
- FR-3.8: Global search, audit, and shared pools remain as
  top-level nav items.

### FR-4: Form and Input Styling

The system MUST have clean, consistent form styling.

- FR-4.1: All text inputs, textareas, selects, and buttons use
  consistent styling from globals.css.
- FR-4.2: Repo selector is a dropdown populated from the registry,
  not free text.
- FR-4.3: Task type selector shows descriptions, not just names.
- FR-4.4: Forms have proper labels, validation, and error states.

### FR-5: Onboarding PR Content

The PR created for repo onboarding MUST include:

- FR-5.1: `CLAUDE.md` — skeleton with section prompts (Architecture,
  Code Conventions, Key Services).
- FR-5.2: `AGENTS.md` — instructions for Claude Code pointing to
  Lore MCP, task tracking, delegation.
- FR-5.3: `.github/PULL_REQUEST_TEMPLATE.md` — required sections
  (Why, Alternatives Rejected, ADR References, Spec).
- FR-5.4: `.github/workflows/pr-description-check.yml` — CI check
  for PR description quality.
- FR-5.5: `.github/workflows/spec-agent.yml` — spec PR triggers
  implementation agent.
- FR-5.6: All files have comments explaining their purpose and how
  to customize them.

## Non-Functional Requirements

### NFR-1: Performance

- Repo list loads in under 500ms.
- Repo detail page loads in under 1 second.
- Onboarding PR created within 30 seconds of clicking "Add Repo."

### NFR-2: UX

- No more than 2 clicks to reach any repo's information.
- Forms are visually consistent and accessible.
- No unexpected redirects.

## Scope Boundaries

### In Scope

- Repo registry (PostgreSQL table + MCP tool).
- Repo onboarding via PR (GitHub App creates files).
- Repo-centric UI redesign (home, detail, tabs).
- Form styling improvements.
- Fix /pipeline redirect issue.

### Out of Scope

- Per-repo access control (use GitHub org membership for now).
- Repo removal/archiving workflow.
- Multi-org support (single org for now).
- Custom onboarding templates per repo.

## Dependencies

- GitHub App (lore-agent) — already configured.
- Pipeline module — for tracking onboarding PRs.
- Web UI — existing Next.js app, redesigned.

## Success Criteria

1. A developer onboards a new repo in under 1 minute via the UI.
2. The onboarding PR contains all required files and is mergeable.
3. After merge, the repo appears in the dashboard with ingested
   context.
4. Users navigate by repo, not by tool — the home page shows repos.
5. Task creation is always scoped to a repo (no free-text input).
6. Forms look clean and consistent across all pages.
