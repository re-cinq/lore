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
- Home page shows repos, not agents. ([validated by `HomeView.test.tsx:43`](apps/web-ui/src/app/HomeView.test.tsx#L43), [`HomeView.test.tsx:56`](apps/web-ui/src/app/HomeView.test.tsx#L56), [`HomeView.test.tsx:65`](apps/web-ui/src/app/HomeView.test.tsx#L65), [`HomeView.test.tsx:76`](apps/web-ui/src/app/HomeView.test.tsx#L76), [`HomeView.test.tsx:216`](apps/web-ui/src/app/HomeView.test.tsx#L216))
- Each repo card shows task count, team badge, running-agents count,
  last-ingested date, ingest-freshness/workflow badges, and a
  fix-ingest action when repos are misaligned. ([validated by `HomeView.test.tsx:83`](apps/web-ui/src/app/HomeView.test.tsx#L83), [`HomeView.test.tsx:89`](apps/web-ui/src/app/HomeView.test.tsx#L89), [`HomeView.test.tsx:94`](apps/web-ui/src/app/HomeView.test.tsx#L94), [`HomeView.test.tsx:99`](apps/web-ui/src/app/HomeView.test.tsx#L99), [`HomeView.test.tsx:104`](apps/web-ui/src/app/HomeView.test.tsx#L104), [`HomeView.test.tsx:111`](apps/web-ui/src/app/HomeView.test.tsx#L111), [`HomeView.test.tsx:118`](apps/web-ui/src/app/HomeView.test.tsx#L118), [`HomeView.test.tsx:125`](apps/web-ui/src/app/HomeView.test.tsx#L125), [`HomeView.test.tsx:137`](apps/web-ui/src/app/HomeView.test.tsx#L137), [`HomeView.test.tsx:144`](apps/web-ui/src/app/HomeView.test.tsx#L144), [`HomeView.test.tsx:149`](apps/web-ui/src/app/HomeView.test.tsx#L149), [`HomeView.test.tsx:161`](apps/web-ui/src/app/HomeView.test.tsx#L161), [`HomeView.test.tsx:174`](apps/web-ui/src/app/HomeView.test.tsx#L174), [`HomeView.test.tsx:187`](apps/web-ui/src/app/HomeView.test.tsx#L187), [`HomeView.test.tsx:194`](apps/web-ui/src/app/HomeView.test.tsx#L194), [`HomeView.test.tsx:205`](apps/web-ui/src/app/HomeView.test.tsx#L205))
- Repo detail page has tabs whose active state tracks the exact path
  and its sub-routes. ([validated by `TabNav.test.tsx:32`](apps/web-ui/src/app/repos/[owner]/[repo]/TabNav.test.tsx#L32), [`TabNav.test.tsx:38`](apps/web-ui/src/app/repos/[owner]/[repo]/TabNav.test.tsx#L38), [`TabNav.test.tsx:44`](apps/web-ui/src/app/repos/[owner]/[repo]/TabNav.test.tsx#L44), [`TabNav.test.tsx:52`](apps/web-ui/src/app/repos/[owner]/[repo]/TabNav.test.tsx#L52))
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
- Task creation is scoped to the current repo (no free-text input):
  the heading names the full repo, a hidden `target_repo` carries it,
  and the form exposes a description textarea and immediate-priority
  checkbox. ([validated by `RepoTaskCreateView.test.tsx:21`](apps/web-ui/src/app/repos/[owner]/[repo]/tasks/create/RepoTaskCreateView.test.tsx#L21), [`RepoTaskCreateView.test.tsx:9`](apps/web-ui/src/app/repos/[owner]/[repo]/tasks/create/RepoTaskCreateView.test.tsx#L9), [`RepoTaskCreateView.test.tsx:55`](apps/web-ui/src/app/repos/[owner]/[repo]/tasks/create/RepoTaskCreateView.test.tsx#L55))
- Repo dropdown only shows repos where the GitHub App is installed.
- Task appears in the repo's task list immediately.

### Scenario 4: Cross-Repo Search

**Actor:** Any user

**Flow:**
1. User uses the global search bar.
2. Results show context, memories, and specs across all repos.
3. Each result shows which repo it belongs to.

**Acceptance Criteria:**
- Search works across all repos, returning memory, fact, episode and
  chunk results with a singular/plural result-count line and a
  zero-match empty state. ([validated by `SearchView.test.tsx:49`](apps/web-ui/src/app/search/SearchView.test.tsx#L49), [`SearchView.test.tsx:55`](apps/web-ui/src/app/search/SearchView.test.tsx#L55), [`SearchView.test.tsx:63`](apps/web-ui/src/app/search/SearchView.test.tsx#L63), [`SearchView.test.tsx:89`](apps/web-ui/src/app/search/SearchView.test.tsx#L89), [`SearchView.test.tsx:115`](apps/web-ui/src/app/search/SearchView.test.tsx#L115), [`SearchView.test.tsx:126`](apps/web-ui/src/app/search/SearchView.test.tsx#L126), [`SearchView.test.tsx:175`](apps/web-ui/src/app/search/SearchView.test.tsx#L175))
- Results are attributed to their source repo, and omit the repo meta
  and badge when a result has no repo. ([validated by `SearchView.test.tsx:137`](apps/web-ui/src/app/search/SearchView.test.tsx#L137), [`SearchView.test.tsx:163`](apps/web-ui/src/app/search/SearchView.test.tsx#L163))
- Can filter by repo, preselecting the active repo and preserving the
  typed query. ([validated by `SearchView.test.tsx:25`](apps/web-ui/src/app/search/SearchView.test.tsx#L25), [`SearchView.test.tsx:41`](apps/web-ui/src/app/search/SearchView.test.tsx#L41), [`SearchView.test.tsx:74`](apps/web-ui/src/app/search/SearchView.test.tsx#L74))

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
- FR-1.4: MCP tool `lore_list_repos` returns all onboarded repos. ([validated by `repo-tools.test.ts:115`](apps/mcp-server/src/mcp/tools/repo-tools.test.ts#L115))

### FR-2: Repo Onboarding via PR

The system MUST onboard new repos by creating a PR.

- FR-2.1: "Add Repo" button in the UI shows repos from the GitHub
  App installation that aren't onboarded yet. The onboard page renders
  the intro copy, the full_name input + submit button, an
  already-onboarded hint (only when the list is non-empty), and keeps
  the typed repo name while surfacing an action error on a failed
  submit. ([validated by `OnboardView.test.tsx:9`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L9), [`OnboardView.test.tsx:21`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L21), [`OnboardView.test.tsx:36`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L36), [`OnboardView.test.tsx:44`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L44), [`OnboardView.test.tsx:60`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L60), [`OnboardView.test.tsx:81`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L81))
- FR-2.2: On click, Lore creates a branch `lore/onboarding` on the
  target repo.
- FR-2.3: Commits onboarding files: CLAUDE.md, AGENTS.md, PR
  template, workflows.
- FR-2.4: Opens a PR per repo with the canonical onboarding path and
  content, counting only the repos where a PR was actually opened and
  tolerating per-repo failures/nulls. ([validated by `actions.test.ts:26`](apps/web-ui/src/app/actions.test.ts#L26), [`actions.test.ts:50`](apps/web-ui/src/app/actions.test.ts#L50))
- FR-2.5: Tracks the onboarding PR in the pipeline (status: pending
  until merged). ([validated by `onboard.test.ts:11`](apps/web-ui/src/lib/onboard.test.ts#L11))
- FR-2.6: After merge, adds repo to the registry and triggers
  initial ingestion; re-onboarding creates an onboard task and
  redirects to the new task page (or back to the repo when none is
  created), and the fix-ingest control re-triggers ingestion for
  misaligned repos with a singular/plural PR label. ([validated by `actions.test.ts:22`](apps/web-ui/src/app/repos/[owner]/[repo]/actions.test.ts#L22), [`actions.test.ts:31`](apps/web-ui/src/app/repos/[owner]/[repo]/actions.test.ts#L31), [`FixIngestButton.test.tsx:13`](apps/web-ui/src/components/FixIngestButton.test.tsx#L13), [`FixIngestButton.test.tsx:21`](apps/web-ui/src/components/FixIngestButton.test.tsx#L21), [`FixIngestButton.test.tsx:40`](apps/web-ui/src/components/FixIngestButton.test.tsx#L40))

### FR-3: Repo-Centric UI Layout

The system MUST reorganize the UI around repos.

- FR-3.1: Home page (`/`) shows repo list with activity summary. ([validated by `HomeView.test.tsx:43`](apps/web-ui/src/app/HomeView.test.tsx#L43))
- FR-3.2: Repo detail (`/repos/[owner]/[repo]`) has tabs:
  Overview, Assembly Lines, Context, Assembled, Specs, Features,
  ADRs, Graph, Agents, Dark Factory, Settings.
- FR-3.3: Overview tab shows recent tasks (PR + pipeline links,
  truncated descriptions, empty state), latest events (status badge +
  Show-all, empty state), the enrollment/re-onboard controls, and the
  repo's Dark Factory mode. ([validated by `RepoOverviewView.test.tsx:94`](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L94), [`RepoOverviewView.test.tsx:110`](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L110), [`RepoOverviewView.test.tsx:151`](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L151), [`RepoOverviewView.test.tsx:185`](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L185), [`RepoOverviewView.test.tsx:197`](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L197), [`RepoOverviewView.test.tsx:207`](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L207), [`RepoOverviewView.test.tsx:236`](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L236), [`EnrollmentSection.test.tsx:34`](apps/web-ui/src/components/EnrollmentSection.test.tsx#L34), [`EnrollmentSection.test.tsx:50`](apps/web-ui/src/components/EnrollmentSection.test.tsx#L50), [`ReonboardButton.test.tsx:7`](apps/web-ui/src/components/ReonboardButton.test.tsx#L7), [`ReonboardButton.test.tsx:21`](apps/web-ui/src/components/ReonboardButton.test.tsx#L21))
- FR-3.3a: Overview renders the repo README (or omits it when absent),
  as collapsible markdown with GFM tables, raw inline HTML, fenced
  code, and relative image/link URLs resolved against the repo's raw
  and HTML base URLs. ([validated by `ReadmeBox.test.tsx:20`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L20), [`ReadmeBox.test.tsx:32`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L32), [`ReadmeBox.test.tsx:45`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L45), [`ReadmeBox.test.tsx:57`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L57), [`ReadmeBox.test.tsx:76`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L76), [`ReadmeBox.test.tsx:97`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L97), [`ReadmeBox.test.tsx:120`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L120), [`ReadmeBox.test.tsx:132`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L132), [`ReadmeBox.test.tsx:145`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L145), [`ReadmeBox.test.tsx:156`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L156), [`ReadmeBox.test.tsx:168`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L168), [`ReadmeBox.test.tsx:177`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L177), [`ReadmeBox.test.tsx:188`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L188), [`readme-markdown.test.ts:7`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L7), [`readme-markdown.test.ts:13`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L13), [`readme-markdown.test.ts:19`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L19), [`readme-markdown.test.ts:25`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L25), [`readme-markdown.test.ts:29`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L29), [`readme-markdown.test.ts:33`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L33), [`readme-markdown.test.ts:39`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L39), [`readme-markdown.test.ts:45`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L45), [`readme-markdown.test.ts:53`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L53), [`readme-markdown.test.ts:57`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L57), [`readme-markdown.test.ts:61`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L61), [`RepoOverviewView.test.tsx:73`](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L73), [`RepoOverviewView.test.tsx:89`](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L89))
- FR-3.3b: PR status pills render the PR state text (nothing when the
  status is null/empty, muted colour for an unknown status), and the
  panel fetches per-task PR status, re-fetches when the task id
  changes, and stays silent on a missing status, rejection, or a
  resolve after unmount. ([validated by `PRStatusBadge.test.tsx:7`](apps/web-ui/src/app/tasks/PRStatusBadge.test.tsx#L7), [`PRStatusBadge.test.tsx:14`](apps/web-ui/src/app/tasks/PRStatusBadge.test.tsx#L14), [`PRStatusBadge.test.tsx:20`](apps/web-ui/src/app/tasks/PRStatusBadge.test.tsx#L20), [`PRStatusBadge.test.tsx:48`](apps/web-ui/src/app/tasks/PRStatusBadge.test.tsx#L48), [`PRStatusBadgePanel.test.tsx:42`](apps/web-ui/src/app/tasks/PRStatusBadgePanel.test.tsx#L42), [`PRStatusBadgePanel.test.tsx:50`](apps/web-ui/src/app/tasks/PRStatusBadgePanel.test.tsx#L50), [`PRStatusBadgePanel.test.tsx:61`](apps/web-ui/src/app/tasks/PRStatusBadgePanel.test.tsx#L61), [`PRStatusBadgePanel.test.tsx:70`](apps/web-ui/src/app/tasks/PRStatusBadgePanel.test.tsx#L70), [`PRStatusBadgePanel.test.tsx:78`](apps/web-ui/src/app/tasks/PRStatusBadgePanel.test.tsx#L78), [`PRStatusBadgePanel.test.tsx:89`](apps/web-ui/src/app/tasks/PRStatusBadgePanel.test.tsx#L89), [`PRStatusBadgePanel.test.tsx:109`](apps/web-ui/src/app/tasks/PRStatusBadgePanel.test.tsx#L109))
- FR-3.4: Tasks (Assembly Lines) tab shows pipeline runs filtered to
  this repo — the heading, intro copy and New Task link, a run row
  with its summed cost, and an empty-state row when there are none;
  the job-run detail page renders the job/status badges, all optional
  fields, the log output (or missing/unreadable/in-process messages),
  and a not-found state with a back link. ([validated by `RepoTasksView.test.tsx:54`](apps/web-ui/src/app/repos/[owner]/[repo]/tasks/RepoTasksView.test.tsx#L54), [`RepoTasksView.test.tsx:34`](apps/web-ui/src/app/repos/[owner]/[repo]/tasks/RepoTasksView.test.tsx#L34), [`RepoTasksView.test.tsx:49`](apps/web-ui/src/app/repos/[owner]/[repo]/tasks/RepoTasksView.test.tsx#L49), [`JobRunView.test.tsx:40`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L40), [`JobRunView.test.tsx:52`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L52), [`JobRunView.test.tsx:70`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L70), [`JobRunView.test.tsx:78`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L78), [`JobRunView.test.tsx:89`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L89), [`JobRunView.test.tsx:97`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L97), [`JobRunView.test.tsx:106`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L106))
- FR-3.5: Context tab shows CLAUDE.md, ADRs, runbooks for this repo. ([validated by `RepoContextView.test.tsx:49`](apps/web-ui/src/app/repos/[owner]/[repo]/context/RepoContextView.test.tsx#L49))
- FR-3.6: Specs tab shows .specify/ specs for this repo, with status
  pills and a filter-chip row (an All chip counting the true list
  length plus one chip per present status, aria-pressed on the active
  filter, a legend distinguishing status from coverage). ([validated by `SpecListView.test.tsx:7`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecListView.test.tsx#L7), [`SpecStatusChips.test.tsx:7`](apps/web-ui/src/components/SpecStatusChips.test.tsx#L7), [`SpecStatusChips.test.tsx:15`](apps/web-ui/src/components/SpecStatusChips.test.tsx#L15), [`SpecStatusChips.test.tsx:31`](apps/web-ui/src/components/SpecStatusChips.test.tsx#L31), [`SpecStatusChips.test.tsx:46`](apps/web-ui/src/components/SpecStatusChips.test.tsx#L46), [`SpecStatusChips.test.tsx:66`](apps/web-ui/src/components/SpecStatusChips.test.tsx#L66), [`SpecStatusChips.test.tsx:82`](apps/web-ui/src/components/SpecStatusChips.test.tsx#L82), [`SpecStatusPill.test.tsx:7`](apps/web-ui/src/components/SpecStatusPill.test.tsx#L7), [`SpecStatusPill.test.tsx:13`](apps/web-ui/src/components/SpecStatusPill.test.tsx#L13))
- FR-3.7: Agents tab shows agent definitions scoped to this repo. ([validated by `AgentList.test.tsx:21`](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentList.test.tsx#L21))
- FR-3.8: Global search, audit, and shared pools remain as
  top-level nav items; a shared-pool detail page renders the pool
  heading/breadcrumb, a truncated creator, singular/plural entry
  counts, an empty-entries row, and each entry's key, readable agent
  id and version, with short values verbatim and long values
  truncated with an expand/collapse toggle. ([validated by `PoolDetailView.test.tsx:26`](apps/web-ui/src/app/pools/[name]/PoolDetailView.test.tsx#L26), [`PoolDetailView.test.tsx:49`](apps/web-ui/src/app/pools/[name]/PoolDetailView.test.tsx#L49), [`PoolDetailView.test.tsx:72`](apps/web-ui/src/app/pools/[name]/PoolDetailView.test.tsx#L72), [`PoolDetailView.test.tsx:91`](apps/web-ui/src/app/pools/[name]/PoolDetailView.test.tsx#L91), [`PoolDetailView.test.tsx:117`](apps/web-ui/src/app/pools/[name]/PoolDetailView.test.tsx#L117), [`PoolDetailView.test.tsx:130`](apps/web-ui/src/app/pools/[name]/PoolDetailView.test.tsx#L130), [`PoolValueCell.test.tsx:37`](apps/web-ui/src/app/pools/[name]/PoolValueCell.test.tsx#L37), [`PoolValueCell.test.tsx:45`](apps/web-ui/src/app/pools/[name]/PoolValueCell.test.tsx#L45), [`PoolValueCell.test.tsx:58`](apps/web-ui/src/app/pools/[name]/PoolValueCell.test.tsx#L58), [`PoolValueCell.test.tsx:76`](apps/web-ui/src/app/pools/[name]/PoolValueCell.test.tsx#L76))
- FR-3.9: ADRs tab renders a card per ADR summary with a Details link
  to the encoded detail path, and an empty-state hint when the graph
  holds no ADRs. ([validated by `AdrListView.test.tsx:7`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/AdrListView.test.tsx#L7), [`AdrListView.test.tsx:36`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/AdrListView.test.tsx#L36))
- FR-3.10: Assembled tab previews assembled context — a template
  selector (current option preselected), submit disabled until a
  non-blank query is entered, a fetch to the context-preview endpoint
  with encoded query + template, and rendering of the budget summary,
  source cards, the nested context/section/document prompt tree (with
  a rendered-markdown/raw toggle), or an HTTP/rejection error that is
  cleared on the next successful assemble. ([validated by `AssembledContextView.test.tsx:84`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L84), [`AssembledContextView.test.tsx:94`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L94), [`AssembledContextView.test.tsx:102`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L102), [`AssembledContextView.test.tsx:121`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L121), [`AssembledContextView.test.tsx:147`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L147), [`AssembledContextView.test.tsx:165`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L165), [`AssembledContextView.test.tsx:191`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L191), [`AssembledContextView.test.tsx:202`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L202), [`AssembledContextPanel.test.tsx:79`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextPanel.test.tsx#L79), [`AssembledContextPanel.test.tsx:86`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextPanel.test.tsx#L86), [`AssembledContextPanel.test.tsx:104`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextPanel.test.tsx#L104), [`AssembledContextPanel.test.tsx:121`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextPanel.test.tsx#L121), [`AssembledContextPanel.test.tsx:134`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextPanel.test.tsx#L134), [`AssembledContextPanel.test.tsx:150`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextPanel.test.tsx#L150))
- FR-3.11: Features tab lists a feature's decomposed stories/tasks
  (each story linked to its GitHub issue, tasks with status, a labelled
  no-story group, nothing when there are no tasks), and maps each
  lifecycle status to its pill colour and in-flight state. ([validated by `DecompositionView.test.tsx:7`](apps/web-ui/src/app/repos/[owner]/[repo]/features/[id]/DecompositionView.test.tsx#L7), [`DecompositionView.test.tsx:15`](apps/web-ui/src/app/repos/[owner]/[repo]/features/[id]/DecompositionView.test.tsx#L15), [`feature-status.test.ts:16`](apps/web-ui/src/app/repos/[owner]/[repo]/features/feature-status.test.ts#L16), [`feature-status.test.ts:22`](apps/web-ui/src/app/repos/[owner]/[repo]/features/feature-status.test.ts#L22), [`feature-status.test.ts:26`](apps/web-ui/src/app/repos/[owner]/[repo]/features/feature-status.test.ts#L26), [`feature-status.test.ts:32`](apps/web-ui/src/app/repos/[owner]/[repo]/features/feature-status.test.ts#L32), [`feature-status.test.ts:39`](apps/web-ui/src/app/repos/[owner]/[repo]/features/feature-status.test.ts#L39))
- FR-3.12: Events tab renders a row per repo event (name + status) or
  an empty state, filtering by the repo column, ordering newest-first,
  and paging one row past the page size from the given offset. ([validated by `EventsView.test.tsx:18`](apps/web-ui/src/app/repos/[owner]/[repo]/events/EventsView.test.tsx#L18), [`EventsView.test.tsx:46`](apps/web-ui/src/app/repos/[owner]/[repo]/events/EventsView.test.tsx#L46), [`pagination.test.ts:5`](apps/web-ui/src/app/repos/[owner]/[repo]/events/pagination.test.ts#L5), [`pagination.test.ts:12`](apps/web-ui/src/app/repos/[owner]/[repo]/events/pagination.test.ts#L12))
- FR-3.13: Settings tab renders the General section prefilled from
  settings and every onboarded repo as a cross-repo option (no
  dark-factory/agent/approval-PR controls), and its save-result banner
  reports saved, applied-privileged, two-key-required (gated field
  paths + approval-PR instructions), codeowners-failed, gated-API
  unconfigured, and generic-error outcomes. ([validated by `SettingsView.test.tsx:22`](apps/web-ui/src/app/repos/[owner]/[repo]/settings/SettingsView.test.tsx#L22), [`SettingsView.test.tsx:53`](apps/web-ui/src/app/repos/[owner]/[repo]/settings/SettingsView.test.tsx#L53), [`SettingsView.test.tsx:64`](apps/web-ui/src/app/repos/[owner]/[repo]/settings/SettingsView.test.tsx#L64), [`SaveResultBanner.test.tsx:7`](apps/web-ui/src/app/repos/[owner]/[repo]/settings/SaveResultBanner.test.tsx#L7), [`SaveResultBanner.test.tsx:15`](apps/web-ui/src/app/repos/[owner]/[repo]/settings/SaveResultBanner.test.tsx#L15), [`SaveResultBanner.test.tsx:21`](apps/web-ui/src/app/repos/[owner]/[repo]/settings/SaveResultBanner.test.tsx#L21), [`SaveResultBanner.test.tsx:33`](apps/web-ui/src/app/repos/[owner]/[repo]/settings/SaveResultBanner.test.tsx#L33), [`SaveResultBanner.test.tsx:51`](apps/web-ui/src/app/repos/[owner]/[repo]/settings/SaveResultBanner.test.tsx#L51), [`SaveResultBanner.test.tsx:70`](apps/web-ui/src/app/repos/[owner]/[repo]/settings/SaveResultBanner.test.tsx#L70), [`SaveResultBanner.test.tsx:79`](apps/web-ui/src/app/repos/[owner]/[repo]/settings/SaveResultBanner.test.tsx#L79))
- FR-3.14: The app shell renders a collapsible sidebar (every nav link
  once in declared order, active highlighting on exact/sub-routes via
  the "/" boundary, pinned Settings/Add-Repo footer actions, grouped
  collapsible sections, and in-flight spinners) with a mobile
  hamburger/overlay drawer (focus management, aria-expanded, and
  Escape/overlay/route-change close semantics) and a user menu (name /
  email / avatar fallbacks and sign-out). ([validated by `SidebarNav.test.tsx:69`](apps/web-ui/src/app/SidebarNav.test.tsx#L69), [`SidebarNav.test.tsx:82`](apps/web-ui/src/app/SidebarNav.test.tsx#L82), [`SidebarNav.test.tsx:94`](apps/web-ui/src/app/SidebarNav.test.tsx#L94), [`SidebarNav.test.tsx:106`](apps/web-ui/src/app/SidebarNav.test.tsx#L106), [`SidebarNav.test.tsx:118`](apps/web-ui/src/app/SidebarNav.test.tsx#L118), [`SidebarNav.test.tsx:136`](apps/web-ui/src/app/SidebarNav.test.tsx#L136), [`SidebarNav.test.tsx:146`](apps/web-ui/src/app/SidebarNav.test.tsx#L146), [`SidebarNav.test.tsx:163`](apps/web-ui/src/app/SidebarNav.test.tsx#L163), [`SidebarNav.test.tsx:178`](apps/web-ui/src/app/SidebarNav.test.tsx#L178), [`SidebarNav.test.tsx:186`](apps/web-ui/src/app/SidebarNav.test.tsx#L186), [`SidebarNav.test.tsx:204`](apps/web-ui/src/app/SidebarNav.test.tsx#L204), [`SidebarNav.test.tsx:218`](apps/web-ui/src/app/SidebarNav.test.tsx#L218), [`SidebarNav.test.tsx:227`](apps/web-ui/src/app/SidebarNav.test.tsx#L227), [`SidebarNav.test.tsx:239`](apps/web-ui/src/app/SidebarNav.test.tsx#L239), [`SidebarNav.test.tsx:254`](apps/web-ui/src/app/SidebarNav.test.tsx#L254), [`SidebarNav.test.tsx:275`](apps/web-ui/src/app/SidebarNav.test.tsx#L275), [`SidebarNav.test.tsx:283`](apps/web-ui/src/app/SidebarNav.test.tsx#L283), [`SidebarNav.test.tsx:298`](apps/web-ui/src/app/SidebarNav.test.tsx#L298), [`SidebarNav.test.tsx:309`](apps/web-ui/src/app/SidebarNav.test.tsx#L309), [`SidebarNav.test.tsx:315`](apps/web-ui/src/app/SidebarNav.test.tsx#L315), [`SidebarNav.test.tsx:334`](apps/web-ui/src/app/SidebarNav.test.tsx#L334), [`AppShell.test.tsx:44`](apps/web-ui/src/app/AppShell.test.tsx#L44), [`AppShell.test.tsx:53`](apps/web-ui/src/app/AppShell.test.tsx#L53), [`AppShell.test.tsx:60`](apps/web-ui/src/app/AppShell.test.tsx#L60), [`AppShell.test.tsx:66`](apps/web-ui/src/app/AppShell.test.tsx#L66), [`AppShell.test.tsx:71`](apps/web-ui/src/app/AppShell.test.tsx#L71), [`AppShell.test.tsx:76`](apps/web-ui/src/app/AppShell.test.tsx#L76), [`AppShell.test.tsx:85`](apps/web-ui/src/app/AppShell.test.tsx#L85), [`AppShell.test.tsx:93`](apps/web-ui/src/app/AppShell.test.tsx#L93), [`AppShell.test.tsx:101`](apps/web-ui/src/app/AppShell.test.tsx#L101), [`AppShell.test.tsx:110`](apps/web-ui/src/app/AppShell.test.tsx#L110), [`AppShell.test.tsx:118`](apps/web-ui/src/app/AppShell.test.tsx#L118), [`AppShell.test.tsx:126`](apps/web-ui/src/app/AppShell.test.tsx#L126), [`AppShell.test.tsx:134`](apps/web-ui/src/app/AppShell.test.tsx#L134), [`AppShell.test.tsx:146`](apps/web-ui/src/app/AppShell.test.tsx#L146), [`AppShell.test.tsx:163`](apps/web-ui/src/app/AppShell.test.tsx#L163), [`AppShell.test.tsx:177`](apps/web-ui/src/app/AppShell.test.tsx#L177), [`UserMenu.test.tsx:35`](apps/web-ui/src/app/UserMenu.test.tsx#L35), [`UserMenu.test.tsx:42`](apps/web-ui/src/app/UserMenu.test.tsx#L42), [`UserMenu.test.tsx:49`](apps/web-ui/src/app/UserMenu.test.tsx#L49), [`UserMenu.test.tsx:56`](apps/web-ui/src/app/UserMenu.test.tsx#L56), [`UserMenu.test.tsx:64`](apps/web-ui/src/app/UserMenu.test.tsx#L64), [`UserMenu.test.tsx:71`](apps/web-ui/src/app/UserMenu.test.tsx#L71), [`UserMenu.test.tsx:77`](apps/web-ui/src/app/UserMenu.test.tsx#L77), [`UserMenu.test.tsx:83`](apps/web-ui/src/app/UserMenu.test.tsx#L83), [`UserMenu.test.tsx:91`](apps/web-ui/src/app/UserMenu.test.tsx#L91), [`UserMenu.test.tsx:102`](apps/web-ui/src/app/UserMenu.test.tsx#L102), [`UserMenu.test.tsx:108`](apps/web-ui/src/app/UserMenu.test.tsx#L108), [`UserMenu.test.tsx:114`](apps/web-ui/src/app/UserMenu.test.tsx#L114), [`UserMenu.test.tsx:125`](apps/web-ui/src/app/UserMenu.test.tsx#L125), [`UserMenu.test.tsx:133`](apps/web-ui/src/app/UserMenu.test.tsx#L133), [`UserMenu.test.tsx:140`](apps/web-ui/src/app/UserMenu.test.tsx#L140), [`UserMenu.test.tsx:148`](apps/web-ui/src/app/UserMenu.test.tsx#L148))
- FR-3.15: Top-level Tasks and org Settings pages exist — the global
  Tasks view renders the heading/global-view notice, a Create-Task
  form wired to the injected action, per-task cards (badge-open on open
  status, none otherwise), an activity table, and both empty states;
  the org Settings page renders the section headings, stat cards, the
  platform-config form (api_url/ingest_token, blank defaults), the
  regenerate-token danger form, the approval form, and the install
  command with the supplied token/api-url (or placeholders). ([validated by `TasksView.test.tsx:25`](apps/web-ui/src/app/tasks/TasksView.test.tsx#L25), [`TasksView.test.tsx:41`](apps/web-ui/src/app/tasks/TasksView.test.tsx#L41), [`TasksView.test.tsx:56`](apps/web-ui/src/app/tasks/TasksView.test.tsx#L56), [`TasksView.test.tsx:69`](apps/web-ui/src/app/tasks/TasksView.test.tsx#L69), [`TasksView.test.tsx:87`](apps/web-ui/src/app/tasks/TasksView.test.tsx#L87), [`TasksView.test.tsx:104`](apps/web-ui/src/app/tasks/TasksView.test.tsx#L104), [`SettingsView.test.tsx:43`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L43), [`SettingsView.test.tsx:66`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L66), [`SettingsView.test.tsx:79`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L79), [`SettingsView.test.tsx:92`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L92), [`SettingsView.test.tsx:104`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L104), [`SettingsView.test.tsx:113`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L113), [`SettingsView.test.tsx:143`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L143), [`SettingsView.test.tsx:165`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L165), [`SettingsView.test.tsx:177`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L177))

### FR-4: Form and Input Styling

The system MUST have clean, consistent form styling.

- FR-4.1: All text inputs, textareas, selects, and buttons use
  consistent styling from globals.css.
- FR-4.2: Repo selector is a dropdown populated from the registry,
  not free text. ([validated by `AssemblyLineCreateView.test.tsx:39`](apps/web-ui/src/app/assembly-lines/create/AssemblyLineCreateView.test.tsx#L39))
- FR-4.3: Task type selector shows descriptions, not just names —
  describing the first option by default, updating the description on
  change, and keeping the `task_type` field name for submission. ([validated by `RepoTaskCreateView.test.tsx:34`](apps/web-ui/src/app/repos/[owner]/[repo]/tasks/create/RepoTaskCreateView.test.tsx#L34), [`TaskTypeSelect.test.tsx:12`](apps/web-ui/src/components/TaskTypeSelect.test.tsx#L12), [`TaskTypeSelect.test.tsx:19`](apps/web-ui/src/components/TaskTypeSelect.test.tsx#L19), [`TaskTypeSelect.test.tsx:29`](apps/web-ui/src/components/TaskTypeSelect.test.tsx#L29))
- FR-4.4: Forms have proper labels, validation, and error states; the
  shared submit button shows its idle label while enabled and swaps to
  the pending label and disables while the form is pending (keeping its
  children as the label when no pendingLabel is given). ([validated by `SubmitButton.test.tsx:18`](apps/web-ui/src/components/SubmitButton.test.tsx#L18), [`SubmitButton.test.tsx:27`](apps/web-ui/src/components/SubmitButton.test.tsx#L27), [`SubmitButton.test.tsx:36`](apps/web-ui/src/components/SubmitButton.test.tsx#L36))

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
