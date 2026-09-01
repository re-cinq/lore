# Feature Specification: UX Redesign + Repo Onboarding

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | UX Redesign + Repo Onboarding               |
| Branch         | 4-ux-repo-onboarding                        |
| Status         | Shipped                                     |
| Created        | 2026-03-29                                  |
| Owner          | Platform Engineering                        |

This spec reorganizes the Lore UI around repos instead of tools — a single repo-centric view for context, pipeline tasks, agent memory, specs, and audit — and adds a one-click self-service onboarding flow that opens a setup PR on the target repo.

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
everything needed — the ingest and spec-impact workflows, a PR template
and PR-description check, issue templates, and a generated AGENTS.md. The
repo owner merges and they're live.

## User Personas

**Developer** — Works in a specific repo. Opens Lore to see what agents are
doing in their repo, check specs, and create tasks scoped to their code.

**Product Owner** — Creates tasks for specific repos. Needs to see which repos
are active, what tasks are running, and review agent PRs — all from a
repo-centric view.

**Platform Engineer** — Onboards new repos, manages org-wide settings, monitors
all agents across all repos.

## Background — User Scenarios & Acceptance Criteria

These walkthroughs are illustrative; the normative, testable contract lives in
the Functional Requirements below. The acceptance-criteria bullets that carry
`([validated by …])` links point at the components that satisfy them.

**Scenario 1: Repo-Centric Dashboard**

**Actor:** Developer

**Flow:**
1. Developer opens Lore, sees a list of repos with activity summary.
2. Clicks their repo.
3. Sees: recent pipeline tasks, active agents, context (CLAUDE.md),
   specs, and audit trail — all for that repo.

**Acceptance Criteria:**
- Home page shows repos, not agents. ([validated by `HomeView.test.tsx:43`](apps/web-ui/src/app/HomeView.test.tsx#L46), [`HomeView.test.tsx:56`](apps/web-ui/src/app/HomeView.test.tsx#L59), [`HomeView.test.tsx:65`](apps/web-ui/src/app/HomeView.test.tsx#L68), [`HomeView.test.tsx:76`](apps/web-ui/src/app/HomeView.test.tsx#L79), [`HomeView.test.tsx:216`](apps/web-ui/src/app/HomeView.test.tsx#L221))
- Each repo card shows task count, team badge, running-agents count,
  last-ingested date, ingest-freshness/workflow badges, and a
  fix-ingest action when repos are misaligned. ([validated by `HomeView.test.tsx:83`](apps/web-ui/src/app/HomeView.test.tsx#L86), [`HomeView.test.tsx:89`](apps/web-ui/src/app/HomeView.test.tsx#L92), [`HomeView.test.tsx:94`](apps/web-ui/src/app/HomeView.test.tsx#L97), [`HomeView.test.tsx:99`](apps/web-ui/src/app/HomeView.test.tsx#L102), [`HomeView.test.tsx:104`](apps/web-ui/src/app/HomeView.test.tsx#L107), [`HomeView.test.tsx:111`](apps/web-ui/src/app/HomeView.test.tsx#L114), [`HomeView.test.tsx:118`](apps/web-ui/src/app/HomeView.test.tsx#L121), [`HomeView.test.tsx:125`](apps/web-ui/src/app/HomeView.test.tsx#L128), [`HomeView.test.tsx:137`](apps/web-ui/src/app/HomeView.test.tsx#L140), [`HomeView.test.tsx:144`](apps/web-ui/src/app/HomeView.test.tsx#L147), [`HomeView.test.tsx:149`](apps/web-ui/src/app/HomeView.test.tsx#L152), [`HomeView.test.tsx:161`](apps/web-ui/src/app/HomeView.test.tsx#L164), [`HomeView.test.tsx:174`](apps/web-ui/src/app/HomeView.test.tsx#L177), [`HomeView.test.tsx:187`](apps/web-ui/src/app/HomeView.test.tsx#L192), [`HomeView.test.tsx:194`](apps/web-ui/src/app/HomeView.test.tsx#L199), [`HomeView.test.tsx:205`](apps/web-ui/src/app/HomeView.test.tsx#L210))
- Repo detail page has tabs whose active state tracks the exact path
  and its sub-routes. ([validated by `TabNav.test.tsx:32`](apps/web-ui/src/app/repos/[owner]/[repo]/TabNav.test.tsx#L32), [`TabNav.test.tsx:38`](apps/web-ui/src/app/repos/[owner]/[repo]/TabNav.test.tsx#L38), [`TabNav.test.tsx:44`](apps/web-ui/src/app/repos/[owner]/[repo]/TabNav.test.tsx#L44), [`TabNav.test.tsx:52`](apps/web-ui/src/app/repos/[owner]/[repo]/TabNav.test.tsx#L52))
- No need to visit separate /pipeline, /search, /audit pages.

**Scenario 2: Onboard a New Repo**

**Actor:** Platform Engineer or Developer

**Flow:**
1. User clicks "Add Repo" in the Lore UI.
2. Selects a repo from their GitHub repos (dropdown, filtered by
   GitHub App installation).
3. Lore creates a PR on the target repo containing:
   - `.github/workflows/lore-ingest.yml` (context ingest) and
     `.github/workflows/lore-trace-impact.yml` (advisory spec-impact)
   - `.github/PULL_REQUEST_TEMPLATE.md` and
     `.github/workflows/pr-description-check.yml`
   - `.claude/settings.json` and `.github/ISSUE_TEMPLATE/*.yml`
   - LLM-drafted `AGENTS.md` (pointing to Lore MCP) and `.specify/spec.md`
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

**Scenario 3: Create Task Scoped to a Repo**

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

**Scenario 4: Cross-Repo Search**

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

**Scenario 5: Repo Settings**

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

The system MUST maintain a registry of onboarded repos. ([validated by `repos.test.ts:37`](apps/lore-api/src/api/routes/repos/repos.test.ts#L36))

- FR-1.1: `repos` table in PostgreSQL: id, name (owner/repo),
  team, onboarded_at, last_ingested_at, settings (JSONB). ([validated by `repos.test.ts:37`](apps/lore-api/src/api/routes/repos/repos.test.ts#L36))
- FR-1.2: Repos are written to the registry on onboard (from the set the
  GitHub App has access to). ([validated by `repo-onboard.test.ts:120`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L120))
- FR-1.3: Repo list shown as the home page of the UI. ([validated by `HomeView.test.tsx:43`](apps/web-ui/src/app/HomeView.test.tsx#L46))
- FR-1.4: MCP tool `lore_list_repos` returns all onboarded repos. ([validated by `repo-tools.test.ts:161`](apps/mcp-server/src/mcp/tools/repo-tools.test.ts#L161))

### FR-2: Repo Onboarding via PR

The system MUST onboard new repos by creating a PR. ([validated by `worker.onboard.test.ts:136`](apps/floor/src/jobs/task/worker.onboard.test.ts#L136))

- FR-2.1: "Add Repo" button in the UI shows repos from the GitHub
  App installation that aren't onboarded yet. The onboard page renders
  the intro copy, the full_name input + submit button, an
  already-onboarded hint (only when the list is non-empty), and keeps
  the typed repo name while surfacing an action error on a failed
  submit. ([validated by `OnboardView.test.tsx:9`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L9), [`OnboardView.test.tsx:21`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L21), [`OnboardView.test.tsx:36`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L36), [`OnboardView.test.tsx:44`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L44), [`OnboardView.test.tsx:60`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L60), [`OnboardView.test.tsx:81`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L81))
- FR-2.2: Lore creates a per-task branch (`lore/onboard/<slug>-<id8>`) on the
  target repo before committing. ([validated by `worker.onboard.test.ts:136`](apps/floor/src/jobs/task/worker.onboard.test.ts#L136))
- FR-2.3: Commits the onboarding files onto that branch — the ingest and
  spec-impact workflows, static scaffolding, and the LLM-drafted AGENTS.md,
  PR template, pr-description-check workflow, and `.specify/spec.md`. ([validated by `worker.onboard.test.ts:119`](apps/floor/src/jobs/task/worker.onboard.test.ts#L119))
- FR-2.4: Opens a PR per repo with the canonical onboarding path and
  content, counting only the repos where a PR was actually opened,
  reporting each repo where no PR was opened with its reason (a thrown
  error's message, or an App-not-configured hint on a null) for both the
  ingest and trace-impact fix actions, and evicting the cached
  ingest-workflow statuses before revalidating so the re-rendered page
  refetches them ([validated by `actions.test.ts:31`](apps/web-ui/src/app/actions.test.ts#L31), [`actions.test.ts:56`](apps/web-ui/src/app/actions.test.ts#L56), [`actions.test.ts:90`](apps/web-ui/src/app/actions.test.ts#L90), [`actions.test.ts:102`](apps/web-ui/src/app/actions.test.ts#L102))
- FR-2.5: Tracks the onboarding PR in the pipeline (status: pending
  until merged). ([validated by `onboard.test.ts:16`](apps/web-ui/src/lib/onboard.test.ts#L16))
- FR-2.6: After merge, adds repo to the registry and triggers
  initial ingestion; re-onboarding creates an onboard task and
  redirects to the new task page (or back to the repo when none is
  created), and the fix-ingest control re-triggers ingestion for
  misaligned repos with a singular/plural PR label plus a failure count
  and per-repo reasons when some PRs could not be opened; a re-onboard
  raised while the previous pass is still running lands on that in-flight
  task instead of
  queueing a duplicate. ([validated by `actions.test.ts:22`](apps/web-ui/src/app/repos/[owner]/[repo]/actions.test.ts#L22), [`actions.test.ts:33`](apps/web-ui/src/app/repos/[owner]/[repo]/actions.test.ts#L33), [`actions.test.ts:46`](apps/web-ui/src/app/repos/[owner]/[repo]/actions.test.ts#L46), [`FixIngestButton.test.tsx:13`](apps/web-ui/src/components/FixIngestButton.test.tsx#L13), [`FixIngestButton.test.tsx:21`](apps/web-ui/src/components/FixIngestButton.test.tsx#L21), [`FixIngestButton.test.tsx:42`](apps/web-ui/src/components/FixIngestButton.test.tsx#L42), [`FixIngestButton.test.tsx:56`](apps/web-ui/src/components/FixIngestButton.test.tsx#L56))
- FR-2.7: When some files cannot be committed, the onboarding PR still
  opens and its body carries a needs-attention section listing each
  failed file with its error; a commit rejected for the missing Workflows App permission (classified
  by the shared failure detector across both GitHub phrasings, never by
  bare status keying) is named for what it is, and the failure set is recorded in the audit log as
  `onboard_files_failed`. ([validated by `worker.onboard.test.ts:178`](apps/floor/src/jobs/task/worker.onboard.test.ts#L178), [`worker.onboard.test.ts:197`](apps/floor/src/jobs/task/worker.onboard.test.ts#L197), [`worker.onboard.test.ts:213`](apps/floor/src/jobs/task/worker.onboard.test.ts#L213), [`worker.onboard.test.ts:305`](apps/floor/src/jobs/task/worker.onboard.test.ts#L305))
- FR-2.8: The ingest callback config (repo variable `LORE_INGEST_URL`,
  secret `LORE_INGEST_TOKEN`) is written before the PR opens so its
  failures land in the PR body; an unset Floor-side value is reported
  instead of being written as an empty variable, and a rejected
  secret write is reported with its error. ([validated by `worker.onboard.test.ts:239`](apps/floor/src/jobs/task/worker.onboard.test.ts#L239), [`worker.onboard.test.ts:264`](apps/floor/src/jobs/task/worker.onboard.test.ts#L264), [`worker.onboard.test.ts:284`](apps/floor/src/jobs/task/worker.onboard.test.ts#L284))

### FR-3: Repo-Centric UI Layout

The system MUST reorganize the UI around repos. ([validated by `HomeView.test.tsx:43`](apps/web-ui/src/app/HomeView.test.tsx#L46))

- FR-3.1: Home page (`/`) shows repo list with activity summary. ([validated by `HomeView.test.tsx:43`](apps/web-ui/src/app/HomeView.test.tsx#L46))
- FR-3.2: Repo detail (`/repos/[owner]/[repo]`) has tabs:
  Overview, Assembly Lines, Context, Assembled, Specs, Features,
  ADRs, Graph, Agents, Dark Factory, Settings. ([validated by `TabNav.test.tsx:32`](apps/web-ui/src/app/repos/[owner]/[repo]/TabNav.test.tsx#L32))
- FR-3.3: Overview tab shows recent tasks (PR + pipeline links,
  truncated descriptions, empty state), latest events (status badge +
  Show-all, empty state), the enrollment/re-onboard controls, and the
  repo's Dark Factory mode. ([validated by `RepoOverviewView.test.tsx:94`](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L94), [`RepoOverviewView.test.tsx:110`](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L110), [`RepoOverviewView.test.tsx:151`](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L151), [`RepoOverviewView.test.tsx:185`](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L185), [`RepoOverviewView.test.tsx:197`](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L197), [`RepoOverviewView.test.tsx:207`](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L207), [`RepoOverviewView.test.tsx:236`](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L236), [`EnrollmentSection.test.tsx:34`](apps/web-ui/src/components/EnrollmentSection.test.tsx#L34), [`EnrollmentSection.test.tsx:50`](apps/web-ui/src/components/EnrollmentSection.test.tsx#L50), [`ReonboardButton.test.tsx:7`](apps/web-ui/src/components/ReonboardButton.test.tsx#L7), [`ReonboardButton.test.tsx:21`](apps/web-ui/src/components/ReonboardButton.test.tsx#L21))
- FR-3.3a: Overview renders the repo README (or omits it when absent),
  as collapsible markdown with GFM tables, raw inline HTML, fenced
  code, and relative image/link URLs resolved against the repo's raw
  and HTML base URLs. ([validated by `ReadmeBox.test.tsx:20`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L20), [`ReadmeBox.test.tsx:32`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L32), [`ReadmeBox.test.tsx:45`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L45), [`ReadmeBox.test.tsx:57`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L57), [`ReadmeBox.test.tsx:76`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L76), [`ReadmeBox.test.tsx:97`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L97), [`ReadmeBox.test.tsx:120`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L120), [`ReadmeBox.test.tsx:132`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L132), [`ReadmeBox.test.tsx:145`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L145), [`ReadmeBox.test.tsx:156`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L156), [`ReadmeBox.test.tsx:168`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L168), [`ReadmeBox.test.tsx:177`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L177), [`ReadmeBox.test.tsx:255`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L255), [`readme-markdown.test.ts:7`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L7), [`readme-markdown.test.ts:13`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L13), [`readme-markdown.test.ts:19`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L19), [`readme-markdown.test.ts:23`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L23), [`readme-markdown.test.ts:27`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L27), [`readme-markdown.test.ts:31`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L31), [`readme-markdown.test.ts:37`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L37), [`readme-markdown.test.ts:43`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L43), [`readme-markdown.test.ts:51`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L51), [`readme-markdown.test.ts:55`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L55), [`readme-markdown.test.ts:59`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L59), [`RepoOverviewView.test.tsx:73`](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L73), [`RepoOverviewView.test.tsx:89`](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L89))
- FR-3.3c: The README markdown is sanitized after raw-HTML parsing: an
  injected `<script>` renders nothing executable, an `onerror` attribute
  is stripped from raw `<img>` HTML, `javascript:` hrefs are stripped
  from both markdown and raw-HTML links, and an injected `<iframe>` is
  dropped, as is an injected `<svg onload>` — while GFM task-list
  checkboxes still render through the sanitizer — and `resolveUrl`
  blanks any non-allowlisted absolute scheme (javascript:, data:,
  vbscript:) instead of passing it through to href/src.
  ([validated by `ReadmeBox.test.tsx:188`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L188), [`ReadmeBox.test.tsx:200`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L200), [`ReadmeBox.test.tsx:213`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L213), [`ReadmeBox.test.tsx:224`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L224), [`ReadmeBox.test.tsx:235`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L235), [`ReadmeBox.test.tsx:244`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L244), [`ReadmeBox.test.tsx:265`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L265), [`readme-markdown.test.ts:65`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L65), [`readme-markdown.test.ts:69`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L69))
- FR-3.3b: PR status pills render the PR state text (nothing when the
  status is null/empty, muted colour for an unknown status), and the
  panel fetches per-task PR status, re-fetches when the task id
  changes, and stays silent on a missing status, rejection, or a
  resolve after unmount. ([validated by `PRStatusBadge.test.tsx:7`](apps/web-ui/src/app/tasks/PRStatusBadge.test.tsx#L7), [`PRStatusBadge.test.tsx:14`](apps/web-ui/src/app/tasks/PRStatusBadge.test.tsx#L14), [`PRStatusBadge.test.tsx:20`](apps/web-ui/src/app/tasks/PRStatusBadge.test.tsx#L20), [`PRStatusBadge.test.tsx:48`](apps/web-ui/src/app/tasks/PRStatusBadge.test.tsx#L48), [validated by `maps the %s status to its pill color`](apps/web-ui/src/app/tasks/PRStatusBadge.test.tsx#L38), [`PRStatusBadgePanel.test.tsx:42`](apps/web-ui/src/app/tasks/PRStatusBadgePanel.test.tsx#L42), [`PRStatusBadgePanel.test.tsx:50`](apps/web-ui/src/app/tasks/PRStatusBadgePanel.test.tsx#L50), [`PRStatusBadgePanel.test.tsx:61`](apps/web-ui/src/app/tasks/PRStatusBadgePanel.test.tsx#L64), [`PRStatusBadgePanel.test.tsx:70`](apps/web-ui/src/app/tasks/PRStatusBadgePanel.test.tsx#L73), [`PRStatusBadgePanel.test.tsx:78`](apps/web-ui/src/app/tasks/PRStatusBadgePanel.test.tsx#L81), [`PRStatusBadgePanel.test.tsx:89`](apps/web-ui/src/app/tasks/PRStatusBadgePanel.test.tsx#L92), [`PRStatusBadgePanel.test.tsx:109`](apps/web-ui/src/app/tasks/PRStatusBadgePanel.test.tsx#L112))
- FR-3.4: Tasks (Assembly Lines) tab shows pipeline runs filtered to
  this repo — the heading, intro copy and New Task link, a run row
  with its summed cost, and an empty-state row when there are none;
  the job-run detail page renders the job/status badges, all optional
  fields, the log output (or missing/unreadable/in-process messages),
  and a not-found state with a back link. ([validated by `RepoTasksView.test.tsx:54`](apps/web-ui/src/app/repos/[owner]/[repo]/tasks/RepoTasksView.test.tsx#L55), [`RepoTasksView.test.tsx:34`](apps/web-ui/src/app/repos/[owner]/[repo]/tasks/RepoTasksView.test.tsx#L35), [`RepoTasksView.test.tsx:49`](apps/web-ui/src/app/repos/[owner]/[repo]/tasks/RepoTasksView.test.tsx#L50), [`JobRunView.test.tsx:40`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L40), [`JobRunView.test.tsx:52`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L52), [`JobRunView.test.tsx:70`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L70), [`JobRunView.test.tsx:78`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L78), [`JobRunView.test.tsx:89`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L89), [`JobRunView.test.tsx:97`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L97), [`JobRunView.test.tsx:106`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L106))
- FR-3.5: Context tab shows CLAUDE.md, ADRs, runbooks for this repo. ([validated by `RepoContextView.test.tsx:49`](apps/web-ui/src/app/repos/[owner]/[repo]/context/RepoContextView.test.tsx#L49))
- FR-3.6: Specs tab shows .specify/ specs for this repo, with status
  pills and a filter-chip row (an All chip counting the true list
  length plus one chip per present status, aria-pressed on the active
  filter, a legend distinguishing status from coverage). ([validated by `SpecListView.test.tsx:7`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecListView.test.tsx#L7), [`SpecStatusChips.test.tsx:7`](apps/web-ui/src/components/SpecStatusChips.test.tsx#L7), [`SpecStatusChips.test.tsx:15`](apps/web-ui/src/components/SpecStatusChips.test.tsx#L15), [`SpecStatusChips.test.tsx:31`](apps/web-ui/src/components/SpecStatusChips.test.tsx#L31), [`SpecStatusChips.test.tsx:46`](apps/web-ui/src/components/SpecStatusChips.test.tsx#L46), [`SpecStatusChips.test.tsx:66`](apps/web-ui/src/components/SpecStatusChips.test.tsx#L66), [`SpecStatusChips.test.tsx:82`](apps/web-ui/src/components/SpecStatusChips.test.tsx#L82), [`SpecStatusPill.test.tsx:7`](apps/web-ui/src/components/SpecStatusPill.test.tsx#L7), [`SpecStatusPill.test.tsx:13`](apps/web-ui/src/components/SpecStatusPill.test.tsx#L13))
- FR-3.7: Agents tab shows agent definitions scoped to this repo. ([validated by `AgentList.test.tsx:21`](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentList.test.tsx#L42))
- FR-3.8: Global search, audit, and shared pools remain as
  top-level nav items; a shared-pool detail page renders the pool
  heading/breadcrumb, a truncated creator, singular/plural entry
  counts, an empty-entries row, and each entry's key, readable agent
  id and version, with short values verbatim and long values
  truncated with an expand/collapse toggle. ([validated by `PoolDetailView.test.tsx:26`](apps/web-ui/src/app/pools/[name]/PoolDetailView.test.tsx#L26), [`PoolDetailView.test.tsx:49`](apps/web-ui/src/app/pools/[name]/PoolDetailView.test.tsx#L49), [`PoolDetailView.test.tsx:72`](apps/web-ui/src/app/pools/[name]/PoolDetailView.test.tsx#L72), [`PoolDetailView.test.tsx:91`](apps/web-ui/src/app/pools/[name]/PoolDetailView.test.tsx#L91), [`PoolDetailView.test.tsx:117`](apps/web-ui/src/app/pools/[name]/PoolDetailView.test.tsx#L117), [`PoolDetailView.test.tsx:130`](apps/web-ui/src/app/pools/[name]/PoolDetailView.test.tsx#L130), [`PoolValueCell.test.tsx:37`](apps/web-ui/src/app/pools/[name]/PoolValueCell.test.tsx#L37), [`PoolValueCell.test.tsx:45`](apps/web-ui/src/app/pools/[name]/PoolValueCell.test.tsx#L45), [`PoolValueCell.test.tsx:58`](apps/web-ui/src/app/pools/[name]/PoolValueCell.test.tsx#L58), [`PoolValueCell.test.tsx:76`](apps/web-ui/src/app/pools/[name]/PoolValueCell.test.tsx#L76))
- FR-3.9: ADRs tab renders a card per ADR summary — title, lead-paragraph
  description, and a status pill parsed from the ADR's frontmatter — with
  a Details link to the encoded detail path, an adr-kind filter-chip row
  (frontmatter legend, no coverage clause) that narrows the cards and
  hides unstatused ADRs under a status filter, the shared search box and
  lifecycle sort, and empty-state/no-match hints. ([validated by `AdrListView:26`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/AdrListView.test.tsx#L26), [`AdrListView:42`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/AdrListView.test.tsx#L42), [`AdrListView:47`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/AdrListView.test.tsx#L47), [`AdrListView:61`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/AdrListView.test.tsx#L61), [`AdrListView:77`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/AdrListView.test.tsx#L77), [`AdrListView:97`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/AdrListView.test.tsx#L97), [`AdrListView:104`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/AdrListView.test.tsx#L104), [`AdrListView:114`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/AdrListView.test.tsx#L114), [`AdrListView:123`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/AdrListView.test.tsx#L123), [`SpecStatusChips:95`](apps/web-ui/src/components/SpecStatusChips.test.tsx#L95))
- FR-3.10: Assembled tab previews assembled context — a template
  selector (current option preselected), submit disabled until a
  non-blank query is entered, a fetch to the context-preview endpoint
  with encoded query + template, and rendering of the budget summary,
  source cards, the nested context/section/document prompt tree (with
  a rendered-markdown/raw toggle), or an HTTP/rejection error that is
  cleared on the next successful assemble. ([validated by `AssembledContextView.test.tsx:84`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L84), [`AssembledContextView.test.tsx:94`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L94), [`AssembledContextView.test.tsx:102`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L102), [`AssembledContextView.test.tsx:121`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L121), [`AssembledContextView.test.tsx:147`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L147), [`AssembledContextView.test.tsx:165`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L165), [`AssembledContextView.test.tsx:191`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L191), [`AssembledContextView.test.tsx:202`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L202), [`AssembledContextPanel.test.tsx:79`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextPanel.test.tsx#L79), [`AssembledContextPanel.test.tsx:86`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextPanel.test.tsx#L86), [`AssembledContextPanel.test.tsx:104`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextPanel.test.tsx#L105), [`AssembledContextPanel.test.tsx:121`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextPanel.test.tsx#L122), [`AssembledContextPanel.test.tsx:134`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextPanel.test.tsx#L135), [`AssembledContextPanel.test.tsx:150`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextPanel.test.tsx#L151))
- FR-3.11: Features tab lists a feature's decomposed stories/tasks
  (each story linked to its GitHub issue, tasks with status, a labelled
  no-story group, nothing when there are no tasks), and maps each
  lifecycle status to its pill colour and in-flight state. ([validated by `DecompositionView.test.tsx:7`](apps/web-ui/src/app/repos/[owner]/[repo]/features/[id]/DecompositionView.test.tsx#L7), [`DecompositionView.test.tsx:15`](apps/web-ui/src/app/repos/[owner]/[repo]/features/[id]/DecompositionView.test.tsx#L15), [`feature-status.test.ts:17`](apps/web-ui/src/app/repos/[owner]/[repo]/features/feature-status.test.ts#L17), [`feature-status.test.ts:23`](apps/web-ui/src/app/repos/[owner]/[repo]/features/feature-status.test.ts#L23), [`feature-status.test.ts:27`](apps/web-ui/src/app/repos/[owner]/[repo]/features/feature-status.test.ts#L27), [`feature-status.test.ts:33`](apps/web-ui/src/app/repos/[owner]/[repo]/features/feature-status.test.ts#L33), [`feature-status.test.ts:40`](apps/web-ui/src/app/repos/[owner]/[repo]/features/feature-status.test.ts#L40))
- FR-3.12: Events tab renders a row per repo event (name + status) or
  an empty state, filtering by the repo column, ordering newest-first,
  and paging one row past the page size from the given offset. ([validated by `EventsView.test.tsx:18`](apps/web-ui/src/app/repos/[owner]/[repo]/events/EventsView.test.tsx#L18), [`EventsView.test.tsx:46`](apps/web-ui/src/app/repos/[owner]/[repo]/events/EventsView.test.tsx#L46), [`events-data.test.ts:20`](apps/web-ui/src/app/repos/[owner]/[repo]/events/events-data.test.ts#L20), [`events-data.test.ts:32`](apps/web-ui/src/app/repos/[owner]/[repo]/events/events-data.test.ts#L32), [`events-data.test.ts:44`](apps/web-ui/src/app/repos/[owner]/[repo]/events/events-data.test.ts#L44), [`events-data.test.ts:55`](apps/web-ui/src/app/repos/[owner]/[repo]/events/events-data.test.ts#L55))
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
  email / avatar fallbacks and sign-out). ([validated by `SidebarNav.test.tsx:73`](apps/web-ui/src/app/SidebarNav.test.tsx#L73), [`SidebarNav.test.tsx:86`](apps/web-ui/src/app/SidebarNav.test.tsx#L86), [`SidebarNav.test.tsx:98`](apps/web-ui/src/app/SidebarNav.test.tsx#L98), [`SidebarNav.test.tsx:110`](apps/web-ui/src/app/SidebarNav.test.tsx#L110), [`SidebarNav.test.tsx:122`](apps/web-ui/src/app/SidebarNav.test.tsx#L122), [`SidebarNav.test.tsx:140`](apps/web-ui/src/app/SidebarNav.test.tsx#L140), [`SidebarNav.test.tsx:150`](apps/web-ui/src/app/SidebarNav.test.tsx#L150), [`SidebarNav.test.tsx:167`](apps/web-ui/src/app/SidebarNav.test.tsx#L167), [`SidebarNav.test.tsx:182`](apps/web-ui/src/app/SidebarNav.test.tsx#L182), [`SidebarNav.test.tsx:190`](apps/web-ui/src/app/SidebarNav.test.tsx#L190), [`SidebarNav.test.tsx:208`](apps/web-ui/src/app/SidebarNav.test.tsx#L208), [`SidebarNav.test.tsx:222`](apps/web-ui/src/app/SidebarNav.test.tsx#L222), [`SidebarNav.test.tsx:231`](apps/web-ui/src/app/SidebarNav.test.tsx#L231), [`SidebarNav.test.tsx:243`](apps/web-ui/src/app/SidebarNav.test.tsx#L243), [`SidebarNav.test.tsx:258`](apps/web-ui/src/app/SidebarNav.test.tsx#L258), [`SidebarNav.test.tsx:279`](apps/web-ui/src/app/SidebarNav.test.tsx#L279), [`SidebarNav.test.tsx:287`](apps/web-ui/src/app/SidebarNav.test.tsx#L287), [`SidebarNav.test.tsx:302`](apps/web-ui/src/app/SidebarNav.test.tsx#L302), [`SidebarNav.test.tsx:313`](apps/web-ui/src/app/SidebarNav.test.tsx#L313), [`SidebarNav.test.tsx:319`](apps/web-ui/src/app/SidebarNav.test.tsx#L319), [`SidebarNav.test.tsx:346`](apps/web-ui/src/app/SidebarNav.test.tsx#L346), [`AppShell.test.tsx:44`](apps/web-ui/src/app/AppShell.test.tsx#L44), [`AppShell.test.tsx:53`](apps/web-ui/src/app/AppShell.test.tsx#L53), [`AppShell.test.tsx:60`](apps/web-ui/src/app/AppShell.test.tsx#L60), [`AppShell.test.tsx:66`](apps/web-ui/src/app/AppShell.test.tsx#L66), [`AppShell.test.tsx:71`](apps/web-ui/src/app/AppShell.test.tsx#L71), [`AppShell.test.tsx:76`](apps/web-ui/src/app/AppShell.test.tsx#L76), [`AppShell.test.tsx:85`](apps/web-ui/src/app/AppShell.test.tsx#L85), [`AppShell.test.tsx:93`](apps/web-ui/src/app/AppShell.test.tsx#L93), [`AppShell.test.tsx:101`](apps/web-ui/src/app/AppShell.test.tsx#L101), [`AppShell.test.tsx:110`](apps/web-ui/src/app/AppShell.test.tsx#L110), [`AppShell.test.tsx:118`](apps/web-ui/src/app/AppShell.test.tsx#L118), [`AppShell.test.tsx:126`](apps/web-ui/src/app/AppShell.test.tsx#L126), [`AppShell.test.tsx:134`](apps/web-ui/src/app/AppShell.test.tsx#L134), [`AppShell.test.tsx:146`](apps/web-ui/src/app/AppShell.test.tsx#L146), [`AppShell.test.tsx:163`](apps/web-ui/src/app/AppShell.test.tsx#L163), [`AppShell.test.tsx:177`](apps/web-ui/src/app/AppShell.test.tsx#L177), [`UserMenu.test.tsx:35`](apps/web-ui/src/app/UserMenu.test.tsx#L35), [`UserMenu.test.tsx:42`](apps/web-ui/src/app/UserMenu.test.tsx#L42), [`UserMenu.test.tsx:49`](apps/web-ui/src/app/UserMenu.test.tsx#L49), [`UserMenu.test.tsx:56`](apps/web-ui/src/app/UserMenu.test.tsx#L56), [`UserMenu.test.tsx:64`](apps/web-ui/src/app/UserMenu.test.tsx#L64), [`UserMenu.test.tsx:71`](apps/web-ui/src/app/UserMenu.test.tsx#L71), [`UserMenu.test.tsx:77`](apps/web-ui/src/app/UserMenu.test.tsx#L77), [`UserMenu.test.tsx:83`](apps/web-ui/src/app/UserMenu.test.tsx#L83), [`UserMenu.test.tsx:91`](apps/web-ui/src/app/UserMenu.test.tsx#L91), [`UserMenu.test.tsx:102`](apps/web-ui/src/app/UserMenu.test.tsx#L102), [`UserMenu.test.tsx:108`](apps/web-ui/src/app/UserMenu.test.tsx#L108), [`UserMenu.test.tsx:114`](apps/web-ui/src/app/UserMenu.test.tsx#L114), [`UserMenu.test.tsx:125`](apps/web-ui/src/app/UserMenu.test.tsx#L125), [`UserMenu.test.tsx:133`](apps/web-ui/src/app/UserMenu.test.tsx#L133), [`UserMenu.test.tsx:140`](apps/web-ui/src/app/UserMenu.test.tsx#L140), [`UserMenu.test.tsx:148`](apps/web-ui/src/app/UserMenu.test.tsx#L148))
- FR-3.15: A top-level org Settings page exists — it renders the
  section headings, stat cards, the platform-config form
  (api_url/ingest_token, blank defaults), the regenerate-token danger
  form, the approval form, and the install command with the supplied
  token/api-url (or placeholders). The former global Tasks view (a
  legacy chunk-backed page predating the pipeline) was removed in
  #1057 (issue #1049) in favor of the per-repo Assembly Lines tab. ([validated by `SettingsView.test.tsx:43`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L43), [`SettingsView.test.tsx:66`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L66), [`SettingsView.test.tsx:79`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L79), [`SettingsView.test.tsx:92`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L92), [`SettingsView.test.tsx:104`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L104), [`SettingsView.test.tsx:113`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L113), [`SettingsView.test.tsx:143`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L143), [`SettingsView.test.tsx:165`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L165), [`SettingsView.test.tsx:177`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L177))
- FR-3.16: Every doc card list (specs, ADRs, the global browsers)
  shares one pure filter/sort helper — status counts and visibility
  (unstatused docs shown only under "All"), a case-insensitive text
  query over title/description that recounts the chips within the
  match, and a path-or-lifecycle sort ordering unstatused docs last
  without mutating the input — surfaced on both tabs through shared
  search/sort controls whose card lists narrow and reorder accordingly. ([validated by `doc-filter:23`](apps/web-ui/src/lib/doc-filter.test.ts#L23), [`doc-filter:30`](apps/web-ui/src/lib/doc-filter.test.ts#L30), [`doc-filter:34`](apps/web-ui/src/lib/doc-filter.test.ts#L34), [`doc-filter:40`](apps/web-ui/src/lib/doc-filter.test.ts#L40), [`doc-filter:46`](apps/web-ui/src/lib/doc-filter.test.ts#L46), [`doc-filter:55`](apps/web-ui/src/lib/doc-filter.test.ts#L55), [`doc-filter:63`](apps/web-ui/src/lib/doc-filter.test.ts#L63), [`doc-filter:67`](apps/web-ui/src/lib/doc-filter.test.ts#L67), [`doc-filter:83`](apps/web-ui/src/lib/doc-filter.test.ts#L83), [`DocListControls:7`](apps/web-ui/src/components/DocListControls.test.tsx#L7), [`DocListControls:18`](apps/web-ui/src/components/DocListControls.test.tsx#L18), [`DocListControls:36`](apps/web-ui/src/components/DocListControls.test.tsx#L36), [`SpecListView:96`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecListView.test.tsx#L96), [`SpecListView:125`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecListView.test.tsx#L125))
- FR-3.17: Doc lifecycle statuses for the list pages ride the list API
  response itself — each doc's `{status, label}` pill is derived
  server-side by the canonical kind-aware `docStatusPill` parser (the
  `| Status |` header row for the spec kind, the frontmatter `status:`
  value for the adr kind), and entries whose status is missing or
  unparseable get no pill. ([validated by `spec-status:363`](libs/shared/src/spec-status.test.ts#L363), [`spec-status:322`](libs/shared/src/spec-status.test.ts#L322), [`spec-status:353`](libs/shared/src/spec-status.test.ts#L353), [`spec-status:359`](libs/shared/src/spec-status.test.ts#L359))
- FR-3.18: The ADR detail page strips the leading YAML frontmatter from
  the rendered source (a minimal YAML-lite parser: scalars, quoted
  scalars, flow and block lists; a later `---` is a horizontal rule; the
  body starts right after the closing fence) and renders it as a
  metadata header — status pill, decision date, domain chips, and
  cross-links (`relates` → the owning spec's detail page, `amends` → the
  amended ADR's detail page) — omitting absent keys, skipping the pill
  for an unrecognized status, and rendering nothing for empty meta. ([validated by `frontmatter:19`](apps/web-ui/src/lib/frontmatter.test.ts#L19), [`frontmatter:31`](apps/web-ui/src/lib/frontmatter.test.ts#L31), [`frontmatter:39`](apps/web-ui/src/lib/frontmatter.test.ts#L39), [`frontmatter:45`](apps/web-ui/src/lib/frontmatter.test.ts#L45), [`frontmatter:51`](apps/web-ui/src/lib/frontmatter.test.ts#L51), [`frontmatter:57`](apps/web-ui/src/lib/frontmatter.test.ts#L57), [`AdrMetaView:16`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/[...path]/AdrMetaView.test.tsx#L16), [`AdrMetaView:25`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/[...path]/AdrMetaView.test.tsx#L25), [`AdrMetaView:46`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/[...path]/AdrMetaView.test.tsx#L46), [`AdrMetaView:54`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/[...path]/AdrMetaView.test.tsx#L54))

### FR-4: Form and Input Styling

- FR-4.1: All form controls — every text input, textarea, select, and button —
  share one base rule in `globals.css` that opts them into the theme font, and
  native `<select>` option popups are pinned to theme surface tokens (no
  per-control hardcoding). ([validated by `globals-styling.test.ts:11`](apps/web-ui/src/app/globals-styling.test.ts#L11), [`globals-styling.test.ts:15`](apps/web-ui/src/app/globals-styling.test.ts#L15), [`globals-styling.test.ts:23`](apps/web-ui/src/app/globals-styling.test.ts#L23))
- FR-4.2: Repo selector is a dropdown populated from the registry,
  not free text. ([validated by `AssemblyRunCreateView.test.tsx:39`](apps/web-ui/src/app/assembly-runs/create/AssemblyRunCreateView.test.tsx#L39))
- FR-4.3: Task type selector shows descriptions, not just names —
  describing the first option by default, updating the description on
  change, and keeping the `task_type` field name for submission. ([validated by `RepoTaskCreateView.test.tsx:34`](apps/web-ui/src/app/repos/[owner]/[repo]/tasks/create/RepoTaskCreateView.test.tsx#L34), [`TaskTypeSelect.test.tsx:12`](apps/web-ui/src/components/TaskTypeSelect.test.tsx#L12), [`TaskTypeSelect.test.tsx:19`](apps/web-ui/src/components/TaskTypeSelect.test.tsx#L19), [`TaskTypeSelect.test.tsx:29`](apps/web-ui/src/components/TaskTypeSelect.test.tsx#L29))
- FR-4.4: Forms have proper labels, validation, and error states; the
  shared submit button shows its idle label while enabled and swaps to
  the pending label and disables while the form is pending (keeping its
  children as the label when no pendingLabel is given). ([validated by `SubmitButton.test.tsx:18`](apps/web-ui/src/components/SubmitButton.test.tsx#L18), [`SubmitButton.test.tsx:27`](apps/web-ui/src/components/SubmitButton.test.tsx#L27), [`SubmitButton.test.tsx:36`](apps/web-ui/src/components/SubmitButton.test.tsx#L36))

### FR-5: Onboarding PR Content

The onboarding PR scaffolds a target repo with deterministic files committed verbatim plus LLM-drafted files generated from a fixed prompt against the repo's context and reviewed by the owner in the PR. ([validated by `worker.onboard.test.ts:119`](apps/floor/src/jobs/task/worker.onboard.test.ts#L119), [`worker.onboard.test.ts:136`](apps/floor/src/jobs/task/worker.onboard.test.ts#L136))

- FR-5.1: The context-ingest and advisory spec-impact workflows are committed
  verbatim — `.github/workflows/lore-ingest.yml` and
  `.github/workflows/lore-trace-impact.yml`. ([validated by `ingest-workflow.test.ts:22`](libs/shared/src/ingest-workflow.test.ts#L22), [`ingest-workflow.test.ts:34`](libs/shared/src/ingest-workflow.test.ts#L34), [`trace-impact-workflow.test.ts:11`](libs/shared/src/trace-impact-workflow.test.ts#L11), [`trace-impact-workflow.test.ts:25`](libs/shared/src/trace-impact-workflow.test.ts#L25))
- FR-5.2: `.github/PULL_REQUEST_TEMPLATE.md` carries the canonical PR sections —
  Why, What Changed, Alternatives Considered, ADRs & Architecture, Testing. ([validated by `pr-template.test.ts:11`](libs/shared/src/pr-template.test.ts#L11), [`pr-template.test.ts:15`](libs/shared/src/pr-template.test.ts#L15), [`pr-template.test.ts:19`](libs/shared/src/pr-template.test.ts#L19), [`pr-template.test.ts:23`](libs/shared/src/pr-template.test.ts#L23), [`pr-template.test.ts:27`](libs/shared/src/pr-template.test.ts#L27), [`pr-template.test.ts:31`](libs/shared/src/pr-template.test.ts#L31))
- FR-5.3: `.github/workflows/pr-description-check.yml` enforces those PR sections
  in CI, treating a comment-only or blank section as empty. ([validated by `pr-section-check.test.ts:28`](libs/shared/src/pr-section-check.test.ts#L28), [`pr-section-check.test.ts:46`](libs/shared/src/pr-section-check.test.ts#L46), [`pr-section-check.test.ts:69`](libs/shared/src/pr-section-check.test.ts#L69), [`pr-section-check.test.ts:80`](libs/shared/src/pr-section-check.test.ts#L80))

- FR-5.4: The onboarding PR commits static scaffolding verbatim —
  `.claude/settings.json` carrying the Lore MCP system-prompt suffix, and the
  four `.github/ISSUE_TEMPLATE/*.yml` task templates. ([validated by `onboard-files.test.ts:10`](apps/floor/src/jobs/task/onboard-files.test.ts#L10), [`onboard-files.test.ts:20`](apps/floor/src/jobs/task/onboard-files.test.ts#L20))
- FR-5.5: It LLM-drafts `AGENTS.md`, the PR template, the pr-description-check
  workflow, and `.specify/spec.md` from fixed prompts against the repo's context
  — the AGENTS.md prompt targets the repo's own stack and the PR-template prompt
  names the five canonical sections. ([validated by `onboard-files.test.ts:33`](apps/floor/src/jobs/task/onboard-files.test.ts#L33), [`onboard-files.test.ts:40`](apps/floor/src/jobs/task/onboard-files.test.ts#L40), [`onboard-files.test.ts:56`](apps/floor/src/jobs/task/onboard-files.test.ts#L56))
- FR-5.6: The onboarding PR scaffolds no `CLAUDE.md` (requested in the onboarding
  issue for the owner to author) and no `spec-agent.yml` — spec and ingest
  triggering ride the ingest and spec-impact workflows above. ([validated by `onboard-files.test.ts:67`](apps/floor/src/jobs/task/onboard-files.test.ts#L67), [`onboard-files.test.ts:71`](apps/floor/src/jobs/task/onboard-files.test.ts#L71))

### FR-6: Top-Level Observability Pages

The top-level nav hosts org-wide observability pages that read across
every repo. ([validated by `AuditView.test.tsx:31`](apps/web-ui/src/app/audit/AuditView.test.tsx#L31))

- FR-6.1: The Audit page (`/audit`) renders one row per audit-log entry
  with a truncated agent id and an operation badge, showing the key,
  pool and stringified-metadata cells (em-dashes when null) with full
  metadata expandable as pretty-printed JSON; it offers an operations
  filter dropdown seeded from the current agent/op query, distinguishes
  a first-run empty state from a no-matches state on an out-of-range
  page, and renders pagination links that disable at the ends and
  preserve the active filters in their hrefs. ([validated by `AuditView.test.tsx:31`](apps/web-ui/src/app/audit/AuditView.test.tsx#L31), [`AuditView.test.tsx:65`](apps/web-ui/src/app/audit/AuditView.test.tsx#L65), [`AuditView.test.tsx:92`](apps/web-ui/src/app/audit/AuditView.test.tsx#L92), [`AuditView.test.tsx:107`](apps/web-ui/src/app/audit/AuditView.test.tsx#L107), [`AuditView.test.tsx:128`](apps/web-ui/src/app/audit/AuditView.test.tsx#L128), [`AuditView.test.tsx:145`](apps/web-ui/src/app/audit/AuditView.test.tsx#L145), [`AuditView.test.tsx:167`](apps/web-ui/src/app/audit/AuditView.test.tsx#L167), [`AuditView.test.tsx:189`](apps/web-ui/src/app/audit/AuditView.test.tsx#L189), [`AuditView.test.tsx:210`](apps/web-ui/src/app/audit/AuditView.test.tsx#L210), [`AuditView.test.tsx:229`](apps/web-ui/src/app/audit/AuditView.test.tsx#L229), [`AuditView.test.tsx:262`](apps/web-ui/src/app/audit/AuditView.test.tsx#L262))
- FR-6.2: The Episodes page (`/episodes`) renders a row per episode
  with a truncated agent id, a source badge, its ref (em-dash when
  null) and fact count, and a content preview that appends an ellipsis
  only when it hits the 300-char cap; it exposes a source filter, an
  empty-state row, and pagination that hides on a single page, carries
  the source into the page links, and disables Previous/Next at the
  first/last page. ([validated by `EpisodesView.test.tsx:20`](apps/web-ui/src/app/episodes/EpisodesView.test.tsx#L20), [`EpisodesView.test.tsx:60`](apps/web-ui/src/app/episodes/EpisodesView.test.tsx#L60), [`EpisodesView.test.tsx:73`](apps/web-ui/src/app/episodes/EpisodesView.test.tsx#L73), [`EpisodesView.test.tsx:88`](apps/web-ui/src/app/episodes/EpisodesView.test.tsx#L88), [`EpisodesView.test.tsx:102`](apps/web-ui/src/app/episodes/EpisodesView.test.tsx#L102), [`EpisodesView.test.tsx:124`](apps/web-ui/src/app/episodes/EpisodesView.test.tsx#L124), [`EpisodesView.test.tsx:138`](apps/web-ui/src/app/episodes/EpisodesView.test.tsx#L138), [`EpisodesView.test.tsx:152`](apps/web-ui/src/app/episodes/EpisodesView.test.tsx#L152), [`EpisodesView.test.tsx:173`](apps/web-ui/src/app/episodes/EpisodesView.test.tsx#L173))
- FR-6.3: The Gaps page (`/gaps`) renders a card per gap-detection
  finding (its key and raw value) and a table row per recorded
  zero-result search (its query and serialized metadata), each with its
  own empty state. ([validated by `GapsView.test.tsx:43`](apps/web-ui/src/app/gaps/GapsView.test.tsx#L43), [`GapsView.test.tsx:59`](apps/web-ui/src/app/gaps/GapsView.test.tsx#L59), [`GapsView.test.tsx:66`](apps/web-ui/src/app/gaps/GapsView.test.tsx#L66), [`GapsView.test.tsx:87`](apps/web-ui/src/app/gaps/GapsView.test.tsx#L87))
- FR-6.4: The Graph explorer page (`/graph`) renders an entity-type
  filter row (an All badge active when no type is selected, the matching
  badge active when one is, hidden when there are no types), a row per
  entity with name, type badge, repo (em-dash when absent), edge count
  and an explore link carrying the active type query only when set, and
  an entities empty state; selecting an entity reveals a relationships
  section with a Show/Hide-invalidated toggle and invalidated badges, or
  its own empty state when the entity has no edges. ([validated by `GraphView.test.tsx:52`](apps/web-ui/src/app/graph/GraphView.test.tsx#L52), [`GraphView.test.tsx:70`](apps/web-ui/src/app/graph/GraphView.test.tsx#L70), [`GraphView.test.tsx:85`](apps/web-ui/src/app/graph/GraphView.test.tsx#L85), [`GraphView.test.tsx:98`](apps/web-ui/src/app/graph/GraphView.test.tsx#L98), [`GraphView.test.tsx:120`](apps/web-ui/src/app/graph/GraphView.test.tsx#L120), [`GraphView.test.tsx:133`](apps/web-ui/src/app/graph/GraphView.test.tsx#L133), [`GraphView.test.tsx:148`](apps/web-ui/src/app/graph/GraphView.test.tsx#L148), [`GraphView.test.tsx:165`](apps/web-ui/src/app/graph/GraphView.test.tsx#L165), [`GraphView.test.tsx:178`](apps/web-ui/src/app/graph/GraphView.test.tsx#L178), [`GraphView.test.tsx:201`](apps/web-ui/src/app/graph/GraphView.test.tsx#L201), [`GraphView.test.tsx:218`](apps/web-ui/src/app/graph/GraphView.test.tsx#L218))
- FR-6.5: The shared-pools list page (`/pools`) renders the heading and
  column headers, a link per pool to its encoded detail page, entry and
  agent counts, a localized created-at date, and a `created_by` that
  stays whole when readable but truncates an opaque hex value (full
  value in the title), with an empty-state row when there are no
  pools. ([validated by `PoolsView.test.tsx:17`](apps/web-ui/src/app/pools/PoolsView.test.tsx#L17), [`PoolsView.test.tsx:29`](apps/web-ui/src/app/pools/PoolsView.test.tsx#L29), [`PoolsView.test.tsx:34`](apps/web-ui/src/app/pools/PoolsView.test.tsx#L34), [`PoolsView.test.tsx:41`](apps/web-ui/src/app/pools/PoolsView.test.tsx#L41), [`PoolsView.test.tsx:49`](apps/web-ui/src/app/pools/PoolsView.test.tsx#L49), [`PoolsView.test.tsx:60`](apps/web-ui/src/app/pools/PoolsView.test.tsx#L60), [`PoolsView.test.tsx:69`](apps/web-ui/src/app/pools/PoolsView.test.tsx#L69), [`PoolsView.test.tsx:78`](apps/web-ui/src/app/pools/PoolsView.test.tsx#L78))
- FR-6.6: The Spend page (`/spend`) is Lore-computed-first (no admin key
  required): it renders the title and every section heading, headlines the
  Lore-computed cost with the API-call count and input/output token totals, and
  breaks spend down by model (including a non-token fallback label), by kind
  (code-review vs task vs memory/curation), by day with localized dates and call
  counts, and — where tasks are attributed — by repo and task type, each table
  falling back to an empty-state row when there is no data. The Anthropic
  billed-cost card and by-model/daily tables render only when an `sk-ant-admin`
  key is configured, so the page is complete without one. Because Anthropic's cost report
  never includes the in-progress day, the billed card also carries a labeled
  Lore-computed line bringing it current — naming the last billed day and
  covering every day after it, worded "today" only when that really is one
  day and "over N days since" when the sync has fallen further behind,
  shown only when billed data is present and the unbilled spend is
  non-zero. ([validated by `SpendView.test.tsx:120`](apps/web-ui/src/app/spend/SpendView.test.tsx#L120), [`SpendView.test.tsx:145`](apps/web-ui/src/app/spend/SpendView.test.tsx#L145), [`SpendView.test.tsx:156`](apps/web-ui/src/app/spend/SpendView.test.tsx#L156), [`SpendView.test.tsx:168`](apps/web-ui/src/app/spend/SpendView.test.tsx#L168), [`SpendView.test.tsx:177`](apps/web-ui/src/app/spend/SpendView.test.tsx#L177), [`SpendView.test.tsx:188`](apps/web-ui/src/app/spend/SpendView.test.tsx#L188), [`SpendView.test.tsx:188`](apps/web-ui/src/app/spend/SpendView.test.tsx#L188), [`SpendView.test.tsx:216`](apps/web-ui/src/app/spend/SpendView.test.tsx#L216), [`SpendView.test.tsx:244`](apps/web-ui/src/app/spend/SpendView.test.tsx#L244), [`SpendView.test.tsx:254`](apps/web-ui/src/app/spend/SpendView.test.tsx#L254), [`SpendView.test.tsx:269`](apps/web-ui/src/app/spend/SpendView.test.tsx#L269), [`SpendView.test.tsx:285`](apps/web-ui/src/app/spend/SpendView.test.tsx#L285), [`SpendView.test.tsx:304`](apps/web-ui/src/app/spend/SpendView.test.tsx#L304), [`SpendView.test.tsx:322`](apps/web-ui/src/app/spend/SpendView.test.tsx#L322), [`SpendView.test.tsx:277`](apps/web-ui/src/app/spend/SpendView.test.tsx#L277))
- FR-6.7: The knowledge-graph force layout (`lib/graph-layout`) seeds
  feature positions within a radius at distinct spots (larger features
  further out), partitions links into connected components, places
  component spots on a rim, scales a bounding radius by the square root
  of (vertices + edges) between a floor and a cap, clamps a node's
  velocity inside that border, floors/scales/caps the pre-warm settle
  ticks, lays a radial tree out ring-by-ring centred on each parent's
  children, separates small components past a margin, grows the feature
  ring so trees don't overlap, and counts edge crossings. ([validated by `graph-layout.test.ts:20`](apps/web-ui/src/lib/graph-layout.test.ts#L20), [`graph-layout.test.ts:37`](apps/web-ui/src/lib/graph-layout.test.ts#L37), [`graph-layout.test.ts:60`](apps/web-ui/src/lib/graph-layout.test.ts#L60), [`graph-layout.test.ts:79`](apps/web-ui/src/lib/graph-layout.test.ts#L79), [`graph-layout.test.ts:89`](apps/web-ui/src/lib/graph-layout.test.ts#L89), [`graph-layout.test.ts:96`](apps/web-ui/src/lib/graph-layout.test.ts#L96), [`graph-layout.test.ts:103`](apps/web-ui/src/lib/graph-layout.test.ts#L103), [`graph-layout.test.ts:109`](apps/web-ui/src/lib/graph-layout.test.ts#L109), [`graph-layout.test.ts:115`](apps/web-ui/src/lib/graph-layout.test.ts#L115), [`graph-layout.test.ts:121`](apps/web-ui/src/lib/graph-layout.test.ts#L121), [`graph-layout.test.ts:132`](apps/web-ui/src/lib/graph-layout.test.ts#L132), [`graph-layout.test.ts:138`](apps/web-ui/src/lib/graph-layout.test.ts#L138), [`graph-layout.test.ts:144`](apps/web-ui/src/lib/graph-layout.test.ts#L144), [`graph-layout.test.ts:150`](apps/web-ui/src/lib/graph-layout.test.ts#L150), [`graph-layout.test.ts:156`](apps/web-ui/src/lib/graph-layout.test.ts#L156), [`graph-layout.test.ts:175`](apps/web-ui/src/lib/graph-layout.test.ts#L175), [`graph-layout.test.ts:179`](apps/web-ui/src/lib/graph-layout.test.ts#L179), [`graph-layout.test.ts:183`](apps/web-ui/src/lib/graph-layout.test.ts#L183), [`graph-layout.test.ts:191`](apps/web-ui/src/lib/graph-layout.test.ts#L191), [`graph-layout.test.ts:195`](apps/web-ui/src/lib/graph-layout.test.ts#L195), [`graph-layout.test.ts:204`](apps/web-ui/src/lib/graph-layout.test.ts#L204), [`graph-layout.test.ts:222`](apps/web-ui/src/lib/graph-layout.test.ts#L222), [`graph-layout.test.ts:238`](apps/web-ui/src/lib/graph-layout.test.ts#L238), [`graph-layout.test.ts:266`](apps/web-ui/src/lib/graph-layout.test.ts#L266), [`graph-layout.test.ts:273`](apps/web-ui/src/lib/graph-layout.test.ts#L273), [`graph-layout.test.ts:286`](apps/web-ui/src/lib/graph-layout.test.ts#L286), [`graph-layout.test.ts:298`](apps/web-ui/src/lib/graph-layout.test.ts#L298), [`graph-layout.test.ts:317`](apps/web-ui/src/lib/graph-layout.test.ts#L317), [`graph-layout.test.ts:329`](apps/web-ui/src/lib/graph-layout.test.ts#L329))
- FR-6.8: The graph crowding helpers (`lib/graph-crowding`) count node
  degrees across links, weaken a link's strength by its busier
  (higher-degree) endpoint down to a floor, scale node repulsion by the
  square root of degree (capped so a mega-hub cannot explode the
  layout), and grow a node's collide radius with degree up to a padding
  cap. ([validated by `graph-crowding.test.ts:10`](apps/web-ui/src/lib/graph-crowding.test.ts#L10), [`graph-crowding.test.ts:16`](apps/web-ui/src/lib/graph-crowding.test.ts#L16), [`graph-crowding.test.ts:26`](apps/web-ui/src/lib/graph-crowding.test.ts#L26), [`graph-crowding.test.ts:32`](apps/web-ui/src/lib/graph-crowding.test.ts#L32), [`graph-crowding.test.ts:36`](apps/web-ui/src/lib/graph-crowding.test.ts#L36), [`graph-crowding.test.ts:40`](apps/web-ui/src/lib/graph-crowding.test.ts#L40), [`graph-crowding.test.ts:44`](apps/web-ui/src/lib/graph-crowding.test.ts#L44), [`graph-crowding.test.ts:50`](apps/web-ui/src/lib/graph-crowding.test.ts#L50), [`graph-crowding.test.ts:54`](apps/web-ui/src/lib/graph-crowding.test.ts#L54), [`graph-crowding.test.ts:58`](apps/web-ui/src/lib/graph-crowding.test.ts#L58), [`graph-crowding.test.ts:64`](apps/web-ui/src/lib/graph-crowding.test.ts#L64), [`graph-crowding.test.ts:68`](apps/web-ui/src/lib/graph-crowding.test.ts#L68), [`graph-crowding.test.ts:72`](apps/web-ui/src/lib/graph-crowding.test.ts#L72))
- FR-6.9: The edge-bundling helpers (`lib/edge-bundling`) build a
  containment forest from `in_feature`/`in_spec` parent edges (ignoring
  cross-cutting kinds), walk a node's ancestor chain to the root
  (stopping on a cycle), and route an edge through its endpoints' lowest
  common ancestor, ordering the control ids source → LCA → target. ([validated by `edge-bundling.test.ts:16`](apps/web-ui/src/lib/edge-bundling.test.ts#L16), [`edge-bundling.test.ts:25`](apps/web-ui/src/lib/edge-bundling.test.ts#L25), [`edge-bundling.test.ts:34`](apps/web-ui/src/lib/edge-bundling.test.ts#L34), [`edge-bundling.test.ts:46`](apps/web-ui/src/lib/edge-bundling.test.ts#L46), [`edge-bundling.test.ts:55`](apps/web-ui/src/lib/edge-bundling.test.ts#L55), [`edge-bundling.test.ts:59`](apps/web-ui/src/lib/edge-bundling.test.ts#L59), [`edge-bundling.test.ts:78`](apps/web-ui/src/lib/edge-bundling.test.ts#L78), [`edge-bundling.test.ts:88`](apps/web-ui/src/lib/edge-bundling.test.ts#L88), [`edge-bundling.test.ts:96`](apps/web-ui/src/lib/edge-bundling.test.ts#L96))
- FR-6.10: The assembly-line run presenters (`lib/assembly-run-presenter`)
  format a relative time (pluralised units, "just now" under a minute),
  format a duration in seconds/minutes (em-dash when null), and map a
  run's state and outcome to a visual tone — success for
  finished+completed, warning for iteration_max, muted for lease_held,
  danger for finished-but-failed, neutral for an unknown finished
  outcome, and muted/danger/running for queued/failed/running
  regardless of outcome. ([validated by `assembly-run-presenter.test.ts:11`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L11), [`assembly-run-presenter.test.ts:21`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L21), [`assembly-run-presenter.test.ts:29`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L29), [`assembly-run-presenter.test.ts:34`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L34), [`assembly-run-presenter.test.ts:40`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L40), [`assembly-run-presenter.test.ts:47`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L47), [`assembly-run-presenter.test.ts:54`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L54), [`assembly-run-presenter.test.ts:61`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L61), [`assembly-run-presenter.test.ts:74`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L74), [`assembly-run-presenter.test.ts:81`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L81), [`assembly-run-presenter.test.ts:92`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L92))
- FR-6.11: The run-row mapper (`lib/assembly-runs`) resolves a
  run's PR from its task join or from `args.pr_number` for a code-review
  run without a task PR, maps a run with no task and no PR to null
  pr/creator/cost, and computes node and run durations (left null while
  still running). ([validated by `assembly-runs.test.ts:40`](apps/web-ui/src/lib/assembly-runs.test.ts#L40), [`assembly-runs.test.ts:54`](apps/web-ui/src/lib/assembly-runs.test.ts#L54), [`assembly-runs.test.ts:74`](apps/web-ui/src/lib/assembly-runs.test.ts#L74), [`assembly-runs.test.ts:91`](apps/web-ui/src/lib/assembly-runs.test.ts#L91), [`assembly-runs.test.ts:100`](apps/web-ui/src/lib/assembly-runs.test.ts#L100), [`assembly-runs.test.ts:123`](apps/web-ui/src/lib/assembly-runs.test.ts#L125))

### FR-7: Shared UI Components

The app is built from a shared set of presentational components. ([validated by `EmptyState.test.tsx:7`](apps/web-ui/src/components/EmptyState.test.tsx#L7))

- FR-7.1: `CopyButton` shows the Copy label, writes the given text to
  the clipboard on click, swaps to Copied after a successful write and
  reverts to Copy 1500ms later, and keeps the Copy label when the
  clipboard write rejects. ([validated by `CopyButton.test.tsx:26`](apps/web-ui/src/components/CopyButton.test.tsx#L26), [`CopyButton.test.tsx:31`](apps/web-ui/src/components/CopyButton.test.tsx#L31), [`CopyButton.test.tsx:44`](apps/web-ui/src/components/CopyButton.test.tsx#L44), [`CopyButton.test.tsx:53`](apps/web-ui/src/components/CopyButton.test.tsx#L53), [`CopyButton.test.tsx:72`](apps/web-ui/src/components/CopyButton.test.tsx#L72))
- FR-7.2: `HelpPopover` renders a collapsed trigger (default label Help,
  a provided label applied to both the trigger and the opened dialog)
  that opens on click and toggles closed on a second click; while open
  it closes on an outside mousedown, on Escape and on unmount but stays
  open on an inside mousedown or a non-Escape keydown, registering its
  document listeners only while open and tearing them down on close and
  unmount. ([validated by `HelpPopover.test.tsx:7`](apps/web-ui/src/components/HelpPopover.test.tsx#L7), [`HelpPopover.test.tsx:18`](apps/web-ui/src/components/HelpPopover.test.tsx#L18), [`HelpPopover.test.tsx:30`](apps/web-ui/src/components/HelpPopover.test.tsx#L30), [`HelpPopover.test.tsx:45`](apps/web-ui/src/components/HelpPopover.test.tsx#L45), [`HelpPopover.test.tsx:57`](apps/web-ui/src/components/HelpPopover.test.tsx#L57), [`HelpPopover.test.tsx:73`](apps/web-ui/src/components/HelpPopover.test.tsx#L73), [`HelpPopover.test.tsx:84`](apps/web-ui/src/components/HelpPopover.test.tsx#L84), [`HelpPopover.test.tsx:95`](apps/web-ui/src/components/HelpPopover.test.tsx#L95), [`HelpPopover.test.tsx:104`](apps/web-ui/src/components/HelpPopover.test.tsx#L104), [`HelpPopover.test.tsx:114`](apps/web-ui/src/components/HelpPopover.test.tsx#L114), [`HelpPopover.test.tsx:128`](apps/web-ui/src/components/HelpPopover.test.tsx#L128))
- FR-7.3: `NavLink`/`NavLabel` apply the active class and `aria-current`
  when active (omitting both when inactive) and show a loading spinner
  while the link's navigation is pending. ([validated by `NavLink.test.tsx:17`](apps/web-ui/src/components/NavLink.test.tsx#L17), [`NavLink.test.tsx:23`](apps/web-ui/src/components/NavLink.test.tsx#L23), [`NavLink.test.tsx:31`](apps/web-ui/src/components/NavLink.test.tsx#L31), [`NavLink.test.tsx:40`](apps/web-ui/src/components/NavLink.test.tsx#L40), [`NavLink.test.tsx:48`](apps/web-ui/src/components/NavLink.test.tsx#L48))
- FR-7.4: `EmptyState` renders its title alone, plus an optional
  description and an optional action link. ([validated by `EmptyState.test.tsx:7`](apps/web-ui/src/components/EmptyState.test.tsx#L7), [`EmptyState.test.tsx:13`](apps/web-ui/src/components/EmptyState.test.tsx#L13), [`EmptyState.test.tsx:25`](apps/web-ui/src/components/EmptyState.test.tsx#L25))
- FR-7.5: `InlineMarkdown` renders bold/italic/inline-code as
  `strong`/`em`/`code` and plain prose without a block paragraph;
  `Linkified` (over the `parseReferences` helper) renders a file path or
  issue reference as a GitHub link opening in a new tab, a task uuid as
  an in-place internal pipeline link, and plain prose as text with
  interleaved prose and links kept in order — `parseReferences`
  defaulting the branch to main, not treating a version number as a
  file, never linkifying inside an inline code span, an existing
  markdown link, or a bare URL, and segmenting identically to the
  shared canonical scanner (mirror held in lockstep by the parity
  test, whose one intentional delta is that web-ui always links task
  uuids to the relative internal page).
  ([validated by `InlineMarkdown.test.tsx:7`](apps/web-ui/src/components/InlineMarkdown.test.tsx#L7), [`InlineMarkdown.test.tsx:14`](apps/web-ui/src/components/InlineMarkdown.test.tsx#L14), [`InlineMarkdown.test.tsx:20`](apps/web-ui/src/components/InlineMarkdown.test.tsx#L20), [`InlineMarkdown.test.tsx:26`](apps/web-ui/src/components/InlineMarkdown.test.tsx#L26), [`Linkified.test.tsx:10`](apps/web-ui/src/components/Linkified.test.tsx#L10), [`Linkified.test.tsx:21`](apps/web-ui/src/components/Linkified.test.tsx#L21), [`Linkified.test.tsx:32`](apps/web-ui/src/components/Linkified.test.tsx#L32), [`Linkified.test.tsx:40`](apps/web-ui/src/components/Linkified.test.tsx#L40), [`Linkified.test.tsx:46`](apps/web-ui/src/components/Linkified.test.tsx#L46), [`references.test.ts:8`](apps/web-ui/src/lib/references.test.ts#L8), [`references.test.ts:18`](apps/web-ui/src/lib/references.test.ts#L18), [`references.test.ts:25`](apps/web-ui/src/lib/references.test.ts#L25), [`references.test.ts:32`](apps/web-ui/src/lib/references.test.ts#L32), [`references.test.ts:41`](apps/web-ui/src/lib/references.test.ts#L41), [`references.test.ts:47`](apps/web-ui/src/lib/references.test.ts#L47), [`references.test.ts:51`](apps/web-ui/src/lib/references.test.ts#L51), [`references.test.ts:59`](apps/web-ui/src/lib/references.test.ts#L59), [`references-parity`](apps/web-ui/src/lib/references.parity.test.ts#L29), [`references-parity-delta`](apps/web-ui/src/lib/references.parity.test.ts#L33))
- FR-7.6: `TimeAgo` keeps the absolute date/time visible alongside a
  relative label — "just now" under a minute, hours-ago within the day,
  days-ago within the week, and the full timestamp for old dates —
  renders the raw value for an unparseable date, and renders absolute
  and relative on one line when inline. ([validated by `TimeAgo.test.tsx:20`](apps/web-ui/src/components/TimeAgo.test.tsx#L20), [`TimeAgo.test.tsx:26`](apps/web-ui/src/components/TimeAgo.test.tsx#L26), [`TimeAgo.test.tsx:30`](apps/web-ui/src/components/TimeAgo.test.tsx#L30), [`TimeAgo.test.tsx:34`](apps/web-ui/src/components/TimeAgo.test.tsx#L34), [`TimeAgo.test.tsx:38`](apps/web-ui/src/components/TimeAgo.test.tsx#L38), [`TimeAgo.test.tsx:46`](apps/web-ui/src/components/TimeAgo.test.tsx#L46), [`TimeAgo.test.tsx:50`](apps/web-ui/src/components/TimeAgo.test.tsx#L50))
- FR-7.7: The route error boundaries render the shared `RouteError`
  fallback — showing the error message (a generic fallback when it has
  none) and wiring the reset callback through to a Try-again button —
  for both the per-route and the global-error boundary. ([validated by `RouteError.test.tsx:7`](apps/web-ui/src/components/RouteError.test.tsx#L7), [`RouteError.test.tsx:14`](apps/web-ui/src/components/RouteError.test.tsx#L14), [`RouteError.test.tsx:19`](apps/web-ui/src/components/RouteError.test.tsx#L19), [`route-error-boundaries.test.tsx:28`](apps/web-ui/src/app/route-error-boundaries.test.tsx#L28), [`route-error-boundaries.test.tsx:37`](apps/web-ui/src/app/route-error-boundaries.test.tsx#L37), [validated by `renders the RouteError fallback for the %s boundary`](apps/web-ui/src/app/route-error-boundaries.test.tsx#L18))
- FR-7.8: Navigating to the home, repo-overview, search and context
  routes shows an immediate route-level loading skeleton — a labeled
  status region of pulsing placeholder blocks mirroring each page's
  layout — instead of freezing on the previous page while the server
  component fetches. ([validated by `renders a labeled status region of skeleton blocks for the %s route`](apps/web-ui/src/app/route-loading-skeletons.test.tsx#L17))

## Operational Targets (Background)

These are aspirational service targets and manual UX guidelines, not
unit-testable assertions.

**NFR-1: Performance**

- Repo list loads in under 500ms.
- Repo detail page loads in under 1 second.
- Onboarding PR created within 30 seconds of clicking "Add Repo."

**NFR-2: UX**

- No more than 2 clicks to reach any repo's information.
- Forms are visually consistent and accessible.
- No unexpected redirects.

## Scope (Background)

**In Scope**

- Repo registry (PostgreSQL table + MCP tool).
- Repo onboarding via PR (GitHub App creates files).
- Repo-centric UI redesign (home, detail, tabs).
- Form styling improvements.
- Fix /pipeline redirect issue.

**Out of Scope**

- Per-repo access control (use GitHub org membership for now).
- Repo removal/archiving workflow.
- Multi-org support (single org for now).
- Custom onboarding templates per repo.

## Background: Dependencies

- GitHub App (lore-agent) — already configured.
- Pipeline module — for tracking onboarding PRs.
- Web UI — existing Next.js app, redesigned.

## Goals & Non-Goals

1. A developer onboards a new repo in under 1 minute via the UI.
2. The onboarding PR contains all required files and is mergeable.
3. After merge, the repo appears in the dashboard with ingested
   context.
4. Users navigate by repo, not by tool — the home page shows repos.
5. Task creation is always scoped to a repo (no free-text input).
6. Forms look clean and consistent across all pages.
