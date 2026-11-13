# Feature Specification: UX Redesign + Repo Onboarding

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | UX Redesign + Repo Onboarding               |
| Branch         | 4-ux-repo-onboarding                        |
| Status         | In Progress                                 |
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
- Home page shows repos, not agents. ([validated by `HomeView.test.tsx@b41d3b8c`](apps/web-ui/src/app/HomeView.test.tsx#L57), [`HomeView.test.tsx@b69a67f2`](apps/web-ui/src/app/HomeView.test.tsx#L70), [`HomeView.test.tsx@587ed414`](apps/web-ui/src/app/HomeView.test.tsx#L79), [`HomeView.test.tsx@401e4c7d`](apps/web-ui/src/app/HomeView.test.tsx#L90), [`HomeView.test.tsx@35ae39ce`](apps/web-ui/src/app/HomeView.test.tsx#L239))
- Each repo card shows task count, team badge, running-agents count,
  last-ingested date, ingest-freshness/workflow badges, and a
  fix-ingest action when repos are misaligned. ([validated by `HomeView.test.tsx@405b9023`](apps/web-ui/src/app/HomeView.test.tsx#L98), [`HomeView.test.tsx@b8cebb83`](apps/web-ui/src/app/HomeView.test.tsx#L104), [`HomeView.test.tsx@f17491f6`](apps/web-ui/src/app/HomeView.test.tsx#L109), [`HomeView.test.tsx@0f79ce92`](apps/web-ui/src/app/HomeView.test.tsx#L115), [`HomeView.test.tsx@1e07f1c5`](apps/web-ui/src/app/HomeView.test.tsx#L120), [`HomeView.test.tsx@f198163e`](apps/web-ui/src/app/HomeView.test.tsx#L127), [`HomeView.test.tsx@1bda5040`](apps/web-ui/src/app/HomeView.test.tsx#L134), [`HomeView.test.tsx@e4036199`](apps/web-ui/src/app/HomeView.test.tsx#L158), [`HomeView.test.tsx@c7914722`](apps/web-ui/src/app/HomeView.test.tsx#L165), [`HomeView.test.tsx@a206b889`](apps/web-ui/src/app/HomeView.test.tsx#L170), [`HomeView.test.tsx@02f7df7b`](apps/web-ui/src/app/HomeView.test.tsx#L182), [`HomeView.test.tsx@32f0b3a5`](apps/web-ui/src/app/HomeView.test.tsx#L195), [`HomeView.test.tsx@7f80c088`](apps/web-ui/src/app/HomeView.test.tsx#L210), [`HomeView.test.tsx@5f6c0845`](apps/web-ui/src/app/HomeView.test.tsx#L217), [`HomeView.test.tsx@1e0c8249`](apps/web-ui/src/app/HomeView.test.tsx#L228), [renders no workflow badge for aligned or unknown ingest status @1bda5040](apps/web-ui/src/app/HomeView.test.tsx#L134), [shows pending-PR when never ingested and PR not merged @c7914722](apps/web-ui/src/app/HomeView.test.tsx#L165), [uses the never-ingested freshness indicator when last_ingested_at is null @7f80c088](apps/web-ui/src/app/HomeView.test.tsx#L210), [renders a fully-populated card with every badge present @35ae39ce](apps/web-ui/src/app/HomeView.test.tsx#L239))
- Repo detail page has tabs whose active state tracks the exact path
  and its sub-routes. ([validated by `TabNav.test.tsx@ebf6a1f2`](apps/web-ui/src/app/repos/[owner]/[repo]/TabNav.test.tsx#L32), [`TabNav.test.tsx@bb8f3ac9`](apps/web-ui/src/app/repos/[owner]/[repo]/TabNav.test.tsx#L38), [`TabNav.test.tsx@8fd89c8c`](apps/web-ui/src/app/repos/[owner]/[repo]/TabNav.test.tsx#L44), [`TabNav.test.tsx@821debc3`](apps/web-ui/src/app/repos/[owner]/[repo]/TabNav.test.tsx#L52))
- No need to visit separate /pipeline, /search, /audit pages.

**Scenario 2: Onboard a New Repo**

**Actor:** Platform Engineer or Developer

**Flow:**
1. User clicks "Add Repo" in the Lore UI.
2. Selects a repo from their GitHub repos (dropdown, filtered by
   GitHub App installation).
3. Lore enrols the repo: the `lore`/`lore:*` dispatch labels and the
   priority taxonomy, the GitHub webhook, the ingest callback (repo
   variable `LORE_INGEST_URL` + secret `LORE_INGEST_TOKEN`), and the
   verbatim scaffolding committed on the task branch —
   `.github/workflows/lore-ingest.yml`, `.github/workflows/lore-trace-impact.yml`,
   `.claude/settings.json` and `.github/ISSUE_TEMPLATE/*.yml`.
4. The onboarding ticket — the task's GitHub Issue on the target repo —
   names every repo-specific file still owed with the prompt it is written
   from (`AGENTS.md`, the PR template, `pr-description-check.yml`,
   `.specify/spec.md`, the starter ADRs, `.lore/test-commands.yml` and
   `lore-tests.yml` when absent), and the `onboard` assembly line implements
   it: author → validate → push (opens THE pull request) → review.
5. User sees the PR link in the UI.
6. Repo owner reviews and merges the PR.
7. The merge pushes the scaffolding to the default branch, so the repo's
   own `lore-ingest.yml` and `lore-tests.yml` run on the merge commit and
   its content is ingested — no follow-up task.
8. Repo appears in the Lore dashboard.

**Acceptance Criteria:**
- One-click onboarding from the UI.
- ONE pull request per onboarding: opened by the line's push node via the
  GitHub App (lore-agent bot); the dashboard offers no fix-workflow PR
  while the onboarding PR is unmerged, and no initial-ingestion task follows
  the merge.
- PR contains all required files with sensible defaults.
- After merge, repo content is ingested by the merged workflows' own run.
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
  checkbox. *(Removed 2026-10-02: the create-task forms are deleted with the task types they offered, `specs/external-floor` FR16.7.)*
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
  zero-match empty state. ([validated by shows no result-count line, chips or empty-state when no query has run @afc45eb3](apps/web-ui/src/app/search/SearchView.test.tsx#L62), [validated by shows the singular result count for exactly one match @c2057931](apps/web-ui/src/app/search/SearchView.test.tsx#L69), [validated by shows the plural result count and zero-match empty state @58186ad7](apps/web-ui/src/app/search/SearchView.test.tsx#L74), [validated by renders a memory result with its key, value, truncated agent id and fixed score @18a159e6](apps/web-ui/src/app/search/SearchView.test.tsx#L98), [validated by renders multiple results in order @77f97863](apps/web-ui/src/app/search/SearchView.test.tsx#L158))
- Results are attributed to their source repo, and omit the repo
  when a result has no repo. ([validated by attributes a chunk result to its repo @138f326f](apps/web-ui/src/app/search/SearchView.test.tsx#L130), [validated by omits the repo when the result has no repo @95a4d4cf](apps/web-ui/src/app/search/SearchView.test.tsx#L149))
- Can filter by repo, preselecting the active repo and preserving the
  typed query. ([validated by renders the repo filter options with the active repo preselected @0c8b9cef](apps/web-ui/src/app/search/SearchView.test.tsx#L34), [validated by preserves the typed query in the search input @350ff6d4](apps/web-ui/src/app/search/SearchView.test.tsx#L44), [validated by appends the active repo to the result-count line @65a2a31c](apps/web-ui/src/app/search/SearchView.test.tsx#L82), [validated by verifies a selected repo cannot show another repo's memory/fact hits @a3e4fe4d](apps/web-ui/src/app/search/filter-memories.acceptance.test.ts#L62), [validated by propagates the selected repo into memory/fact retrieval @dcec8acf](apps/web-ui/src/app/search/search-memory-repo-propagation.acceptance.test.tsx#L47), [validated by scopes lexical memory and fact queries to the requested repo @82e2253b](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L240))
- The screen is titled Search under the `{knowledge}` group label, and each
  result card names its source in that source's tone. ([validated by titles the screen Search under the knowledge group @d8c3172b](apps/web-ui/src/app/search/SearchView.test.tsx#L52), [validated by labels each card with its source in that source's tone @f701701a](apps/web-ui/src/app/search/SearchView.test.tsx#L109))
- Source chips (All, then each source with hits) count the full result set
  and narrow the cards to one source through a `source` URL parameter, so a
  narrowed search is a shareable link like any other. ([validated by offers All plus each source that has hits, with counts from the full set @80b1f932](apps/web-ui/src/app/search/SearchView.test.tsx#L188), [validated by links each chip to the same search narrowed to its source @55a77477](apps/web-ui/src/app/search/SearchView.test.tsx#L201), [validated by shows only the active source's cards and marks its chip current @918cb2bc](apps/web-ui/src/app/search/SearchView.test.tsx#L217))

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

The system MUST maintain a registry of onboarded repos. ([validated by `repos.test.ts@76c00137`](apps/lore-api/src/transport/routes/repos/repos.test.ts#L36))

- FR-1.1: `repos` table in PostgreSQL: id, name (owner/repo),
  team, onboarded_at, last_ingested_at, settings (JSONB). ([validated by `repos.test.ts@76c00137`](apps/lore-api/src/transport/routes/repos/repos.test.ts#L36))
- FR-1.2: Repos are written to the registry on onboard (from the set the
  GitHub App has access to). ([validated by `repo-onboard.test.ts@727a6be2`](apps/lore-api/src/work/repo/repo-onboard.test.ts#L120))
- FR-1.3: Repo list shown as the home page of the UI. ([validated by `HomeView.test.tsx@b41d3b8c`](apps/web-ui/src/app/HomeView.test.tsx#L57))
- FR-1.4: MCP tool `lore_list_repos` returns all onboarded repos. ([validated by makes a single call when all repos fit in one page @dc92f2ad](apps/mcp-server/src/transport/tools/repo/list-repos.test.ts#L54))

### FR-2: Repo Onboarding via PR

The system MUST onboard new repos by creating ONE pull request *(amended
2026-09-17)*: the Floor enrols the repo and commits the verbatim scaffolding
on the task branch, then hands the onboarding ticket to the `onboard`
assembly line, whose push node opens the PR. The previous shape — an
in-process handler drafting each file with one LLM call from a pre-fetched
top-level tree, opening the PR itself, plus a dashboard fix-workflow PR and a
post-merge ingestion task — could leave three PRs open for one onboarding.

- FR-2.1: "Add Repo" button in the UI shows repos from the GitHub
  App installation that aren't onboarded yet. The onboard page renders
  the intro copy, the full_name input + submit button, what the
  onboarding PR adds, an already-onboarded hint (only when the list is non-empty), and keeps
  the typed repo name while surfacing an action error on a failed
  submit. ([validated by returns App-accessible, not-yet-onboarded repositories instead of hardcoded list @a78e2f9e](apps/web-ui/src/app/api/repos/route.acceptance.test.ts#L43), [validated by returns an upstream error when the GitHub fetch fails @ee18f6d0](apps/web-ui/src/app/api/repos/route.acceptance.test.ts#L55), [validated by calls /api/repos/available and returns the array @2090c02d](apps/web-ui/src/lib/api/repos.test.ts#L206), [validated by `OnboardView.test.tsx@b2e07622`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L11), [`OnboardView.test.tsx@ee7105ed`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L21), [`OnboardView.test.tsx@fd7ae7ec`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L36), [`OnboardView.test.tsx@0e28103f`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L44), [`OnboardView.test.tsx@45d34e3e`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L60), [`OnboardView.test.tsx@ffc3c7f8`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L94), [lists what the onboarding PR adds @d59a1221](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L81))
- FR-2.2: Lore creates the task branch off the repo's real default branch
  before committing to it, and only when it does not exist yet.
- FR-2.3: The Floor brings the deterministic scaffolding on that branch to
  today's requirements itself, by one rule for a first onboarding and an
  update alike: a LORE-owned file — the ingest and spec-impact workflows, the
  three `lore-*.yml` issue templates — is committed whenever the branch's copy
  differs from the canonical content.
  A REPO-owned one (`.claude/settings.json`, `ISSUE_TEMPLATE/config.yml`) is only committed when absent, so a
  repo's own settings are never overwritten. A file already at its canonical
  content is never committed.
  GitHub's contents API makes a commit even for
  identical bytes, and an up-to-date repo would get an empty pull request.
  Paths are read exactly, so a repo with a `.github/` directory still receives
  its issue templates (#1201). An LLM never retypes these. ([validated by owns the three lore issue templates as lore files and leaves .claude/settings.json and config.yml to the repo @7962cd0d](libs/shared/src/work/onboard-content.test.ts#L197), [validated by commits a Lore-owned file when the branch's copy differs from the canonical content @0146fe34](../../libs/shared/src/work/onboard/onboard-scaffold.acceptance.test.ts#L10), [validated by returns true for a lore-owned file when it differs from canonical content @fd674110](libs/shared/src/work/onboard/onboard-scaffold.test.ts#L14), [validated by returns true for any file when it is absent @efd56338](libs/shared/src/work/onboard/onboard-scaffold.test.ts#L23), [validated by returns false for a lore-owned file when it matches canonical content @9d1a4a59](libs/shared/src/work/onboard/onboard-scaffold.test.ts#L5))
- FR-2.4: Opens a PR per repo with the canonical onboarding path and
  content, counting only the repos where a PR was actually opened,
  reporting each repo where no PR was opened with its reason (a thrown
  error's message, or an App-not-configured hint on a null) for both the
  ingest and trace-impact fix actions, and evicting the cached
  ingest-workflow statuses before revalidating so the re-rendered page
  refetches them ([validated by `actions.test.ts@8f8b9f99`](apps/web-ui/src/app/actions.test.ts#L31), [`actions.test.ts@9e66c736`](apps/web-ui/src/app/actions.test.ts#L56), [`actions.test.ts@09008166`](apps/web-ui/src/app/actions.test.ts#L90), [`actions.test.ts@ba7f167d`](apps/web-ui/src/app/actions.test.ts#L102))
- FR-2.4b: *(amended 2026-09-17)* The fix-ingest and fix-trace-impact
  actions are offered only for repos whose onboarding PR has merged: a repo
  still being onboarded reads as "missing" because its scaffolding sits on
  the unmerged onboarding branch, and a fix PR there would be a second PR
  beside the one onboarding owns. ([validated by offers a fix for an onboarded repo whose workflow is missing or stale, not an aligned one @c13eb548](apps/web-ui/src/lib/workflow-fix.test.ts#L10), [validated by offers no fix for a repo whose onboarding PR has not merged, whatever its workflow status @44c90749](apps/web-ui/src/lib/workflow-fix.test.ts#L25), [validated by offers nothing for a repo with no status read @dbfa8f8e](apps/web-ui/src/lib/workflow-fix.test.ts#L36))
- FR-2.5: Tracks the onboarding PR in the pipeline (status: pending
  until merged). ([validated by `onboard.test.ts@854b1dc3`](apps/web-ui/src/lib/onboard.test.ts#L16))
- The merge-check sweep reads owner, repository and PR number from an onboarding GitHub pull URL; an empty URL or a repository URL without a pull request yields no PR to check. ([validated by reads owner, repo, and PR number from a github.com pull URL @41c33764](apps/stations/src/work/merge-check/merge-check.test.ts#L5), [validated by returns null for a URL that carries no pull request @5ef710ec](apps/stations/src/work/merge-check/merge-check.test.ts#L11), [validated by returns null for an empty string @1c6a1a84](apps/stations/src/work/merge-check/merge-check.test.ts#L15))
- FR-2.6: After merge, the merge-check station flips the repo to onboarded
  and the merged workflows ingest on their own push run — no task follows; re-onboarding creates an onboard task and
  redirects to its run (or returns the refusal error when none is
  created), from a trigger drawn as a plain button rather than a link, and the fix-ingest control re-triggers ingestion for
  misaligned repos with a singular/plural PR label plus a failure count
  and per-repo reasons when some PRs could not be opened; a re-onboard
  raised while the previous pass is still running lands on that in-flight
  task's run instead of
  queueing a duplicate. ([validated by is the plain global button, not the link-styled one @b7b2cfb8](apps/web-ui/src/components/ReonboardButton.test.tsx#L17), [`actions.test.ts@373f8726`](apps/web-ui/src/app/repos/[owner]/[repo]/actions.test.ts#L32), [`actions.test.ts@7472fa61`](apps/web-ui/src/app/repos/[owner]/[repo]/actions.test.ts#L43), [`actions.test.ts@50fd67bd`](apps/web-ui/src/app/repos/[owner]/[repo]/actions.test.ts#L56), [`FixIngestButton.test.tsx@a467387d`](apps/web-ui/src/components/FixIngestButton.test.tsx#L11), [`FixIngestButton.test.tsx@238c230a`](apps/web-ui/src/components/FixIngestButton.test.tsx#L19), [`FixIngestButton.test.tsx@599181b5`](apps/web-ui/src/components/FixIngestButton.test.tsx#L40), [`FixIngestButton.test.tsx@59172195`](apps/web-ui/src/components/FixIngestButton.test.tsx#L54))
- FR-2.6.1 *(added 2026-09-22, #2027)*: Flipping the repo to onboarded does
  not stamp `last_ingested_at`; only an ingest does. The stamp used to be set
  on merge although nothing had read the repo, which silenced the
  seven-day staleness warning on a repo no ingest had reached.
  ([validated by marks repo-42's onboarding merged without stamping last_ingested_at @b3fdadf8](libs/shared/src/outbound/project/settings/settings-pg.test.ts#L79),
  [validated by marks the onboarding merged and leaves a never-ingested repo's last_ingested_at unset @156757e1](libs/shared/src/outbound/project/settings/settings.test.ts#L70), [validated by records last_ingested_at only after a successful write @1ba55c92](apps/lore-api/src/transport/routes/ingest/ingest.acceptance.test.ts#L40), [validated by does not record last_ingested_at when no files landed @3fd83a2d](apps/lore-api/src/transport/routes/ingest/ingest.acceptance.test.ts#L63))
- FR-2.7: When enrolment leaves gaps — a file that could not be committed,
  a callback value that could not be set — the onboarding still proceeds and
  the gaps are COMMENTED ON THE TICKET, the human surface an onboarding has
  before its PR exists; a commit rejected for the missing Workflows App
  permission (classified by the shared failure detector across both GitHub
  phrasings, never by bare status keying) is named for what it is, the
  failure set is recorded in the audit log as `onboard_files_failed`, and a
  task with no ticket still audits and dispatches.
- FR-2.8: The ingest callback config (repo variable `LORE_INGEST_URL`,
  secret `LORE_INGEST_TOKEN`) is written before the line is dispatched so
  its failures reach the ticket; an unset Floor-side value is reported
  instead of being written as an empty variable, and a rejected secret
  write is reported with its error.
- FR-2.9: An onboard task ALWAYS walks the `onboard` assembly line, dark
  mode or not — only the line's push node opens the PR, so a single-Agent
  dispatch would never produce one; every other task type keeps its rule
  (dark mode or a feature-lifecycle type walks the line, otherwise a single
  Agent). The push node records the opened PR as the repo's onboarding PR,
  which the onboard guard blocks on and the merge-check station flips to
  merged; a feature-planning line's PR records nothing there.
- FR-2.10: The onboarding TICKET is the whole spec the line's agent gets:
  it names the repo, lists the deterministic scaffolding already on the
  branch so it is not rewritten, owes each repo-specific file with the
  prompt it is written from — the starter ADRs only for a repo with no
  `adrs/` or `docs/`, the test-command manifest and `lore-tests.yml` only
  when absent — and states the rules: existing files stay untouched, no
  `CLAUDE.md`, no code changes, and Lore opens the pull request. The API
  route sends that body as the task description, which becomes the Issue. ([validated by names re-cinq/app as the repository being onboarded @5355bcd4](libs/shared/src/work/onboard-content.test.ts#L123), [validated by owes every LLM-drafted path with its prompt @e9329ace](libs/shared/src/work/onboard-content.test.ts#L127), [validated by owes the starter ADRs only for a repo with no adrs/ or docs/ directory @121b4aea](libs/shared/src/work/onboard-content.test.ts#L135), [validated by owes the test-command manifest and lore-tests.yml with their own instructions, only when absent @791e6e83](libs/shared/src/work/onboard-content.test.ts#L152), [validated by says the deterministic scaffolding is already on the branch and must not be rewritten @4f039376](libs/shared/src/work/onboard-content.test.ts#L163), [validated by forbids CLAUDE.md, existing-file rewrites and code changes, and leaves the pull request to Lore @6bac9967](libs/shared/src/work/onboard-content.test.ts#L173), [validated by sends the onboarding ticket body instead of the bare repo name @509773b3](apps/lore-api/src/work/repo/repo-onboard.test.ts#L135))
- FR-2.11: *(added 2026-09-17)* Lore does not monitor a repo's setup; its
  owner triggers it by hand. The enrollment box carries ONE button, and only
  one: a missing file's check says what is missing but offers no action of
  its own, because a button per missing file read as one PR per file when
  every one of them queued the same run. That button is a standing trigger
  whose label follows the repo's state: **Open enrolment PR** while the repo
  has no onboarding PR, **Update Lore setup** once that PR has merged —
  standing because a setup that is complete but out of date fails no check,
  so no per-check action would offer it — and nothing while the PR is open,
  where the guard refuses a second run and the row's "review & merge" link is
  the action. The API's and the MCP tool's `reonboard` reach the same run,
  and the TICKET is chosen by the repo's state, never by that flag: the repo
  page always sends it, so a first enrolment raised from the box still gets
  the onboarding ticket. That run is the
  `onboard` assembly line fed the UPDATE ticket: the Floor refreshes Lore's
  own files under FR-2.3, and the agent adds every file a first onboarding
  owes that is missing and realigns only the two workflows written from a Lore
  instruction (`lore-tests.yml`, `pr-description-check.yml`), leaving
  everything else the repository has edited alone. It opens ONE pull request,
  or none: when the Floor had nothing to refresh and the agent nothing to add,
  the line COMPLETES saying the setup is already current, where any other
  line whose push delivered nothing still errors. ([validated by shows exactly one button for a repo missing two files: Open enrolment PR, never one per file @1241b9e2](apps/web-ui/src/components/EnrollmentSection.test.tsx#L40), [validated by carries no per-file PR action on a missing github file: the box's one trigger covers every missing file @419251a1](apps/web-ui/src/lib/enrollment.test.ts#L202), [validated by offers Open enrolment PR in the box for a repo with no onboarding PR, and runs the handler on click @c0c40972](apps/web-ui/src/components/EnrollmentSection.test.tsx#L65), [validated by offers Update Lore setup once the onboarding PR has merged, even with every check passing @c5be2141](apps/web-ui/src/components/EnrollmentSection.test.tsx#L79), [validated by offers neither trigger while the onboarding PR is open, nor without a handler @c2936d29](apps/web-ui/src/components/EnrollmentSection.test.tsx#L99), [validated by reads Open enrolment PR for a repo with no onboarding PR yet @530baf5c](apps/web-ui/src/lib/enrollment.test.ts#L461), [validated by reads Update Lore setup once the onboarding PR has merged @2a4d95d9](apps/web-ui/src/lib/enrollment.test.ts#L469), [validated by offers nothing while the onboarding PR is still open, where review & merge is the action @128b1b65](apps/web-ui/src/lib/enrollment.test.ts#L473), [validated by sends the update ticket, not the onboarding one, when o/r's onboarding PR has already merged @44f647f2](apps/lore-api/src/work/repo/repo-onboard.test.ts#L240), [validated by sends the onboarding ticket when reonboard is requested for o/r but its onboarding PR never merged @059d6724](apps/lore-api/src/work/repo/repo-onboard.test.ts#L260), [validated by asks to update re-cinq/app's Lore setup rather than onboard it @a9383cf4](libs/shared/src/work/onboard-content.test.ts#L217), [validated by owes every file a first onboarding owes, each only when missing @3ed0c933](libs/shared/src/work/onboard-content.test.ts#L224), [validated by realigns only lore-tests.yml and pr-description-check.yml, the workflows written from a Lore instruction @74589233](libs/shared/src/work/onboard-content.test.ts#L235), [validated by calls an already-current setup a success, not a failure @6bfb83e0](libs/shared/src/work/onboard-content.test.ts#L243))
- FR-2.12: *(added 2026-10-01)* Where an external floor is configured the
  onboarding runs there (`specs/external-floor` FR11), and three things
  differ from the requirements above. Enrolment gaps (FR-2.7, FR-2.8) are
  carried in the PULL REQUEST's body rather than commented on a ticket,
  because no ticket issue is filed. The line has no review or address node:
  once the build is green it asks the code-review line for a review. And the
  task branch is `lore/onboard/<first 8 of the task id>`. Everything else —
  one pull request, the scaffolding rule of FR-2.3, the ticket of FR-2.10,
  the guard, the "already current" ending of FR-2.11 — holds on both. ([validated by puts the needs-attention section in the pull request body, above the footer @92ee3ff3](apps/stations/src/onboard/open-pr/station.test.ts#L87), [validated by starts a forced review of pull request 42 of re-cinq/app @2d14e7aa](apps/stations/src/onboard/request-review/station.test.ts#L19), [validated by names the branch lore/onboard/1234abcd for task 1234abcd-… @d81f5ad3](libs/shared/src/work/onboard/floor-onboard.test.ts#L11))

- FR-2.13: *(added 2026-10-02, #2381)* Submitting the onboarding form gives
  feedback. On success the user lands on the repository's page, which shows
  its onboarding state. A refusal keeps the user on the form with the reason. ([validated by redirects to /repos/re-cinq/lore when onboarding queues task-1 @dffb6b49](apps/web-ui/src/app/onboard/page.test.tsx#L55), [stays on the form with the refusal when onboarding is refused @6168d30c](apps/web-ui/src/app/onboard/page.test.tsx#L65), [rejects a malformed repository without calling the API @17bacdf7](apps/web-ui/src/app/onboard/page.test.tsx#L81))

### FR-3: Repo-Centric UI Layout

The system MUST reorganize the UI around repos. ([validated by `HomeView.test.tsx@b41d3b8c`](apps/web-ui/src/app/HomeView.test.tsx#L57))

- FR-3.1: Home page (`/`) shows repo list with activity summary. ([validated by `HomeView.test.tsx@b41d3b8c`](apps/web-ui/src/app/HomeView.test.tsx#L57))
- FR-3.1a: The home page's title is summarised as "N onboarded · M need attention · K agents running". ([validated by summarises onboarded, attention and running counts under the title @df8dc6fd](apps/web-ui/src/app/HomeView.test.tsx#L261))
- FR-3.1b: A repo needs attention when its ingest workflow is missing (shown as danger), outdated, or its spec-impact workflow is outdated, in that order of precedence; the card shows the most urgent one in place of its ingest summary. ([validated by flags a repo whose spec-impact workflow is outdated @11c99eeb](apps/web-ui/src/app/HomeView.test.tsx#L271), [validated by ranks a missing ingest workflow above an outdated spec-impact one @333a917e](apps/web-ui/src/app/HomeView.filters.test.ts#L13))
- FR-3.1c: Chips above the grid filter it to All, Needs attention or Agents running. Each chip is a link carrying `?filter=` with the count it would show; an unknown filter reads as All, and a filter that hides every repo says so rather than showing the onboarding prompt. ([validated by keeps only the repos needing attention under the Needs attention chip @a6230f2c](apps/web-ui/src/app/HomeView.test.tsx#L280), [validated by keeps only repos with running agents under the Agents running chip @f5471d6a](apps/web-ui/src/app/HomeView.test.tsx#L296), [validated by links each chip to its filter with the count it would show @67f4d19d](apps/web-ui/src/app/HomeView.test.tsx#L309), [validated by says no repo matches when a chip hides every repo @a9c34621](apps/web-ui/src/app/HomeView.test.tsx#L320), [validated by reads a known filter and falls back to all for anything else @39b4b1d2](apps/web-ui/src/app/HomeView.filters.test.ts#L5))
- FR-3.1d: A card shows its last ingest as a short age (`8h`, `20d`, `now`) on one line, with the exact time on hover, and carries no separate last-ingested note. ([validated by @430ca258](apps/web-ui/src/app/HomeView.test.tsx#L141), [validated by @75949efa](apps/web-ui/src/app/HomeView.test.tsx#L152), [validated by @80df1486](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L34), [validated by @71ace970](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L52))
- FR-3.2: Repo detail (`/repos/[owner]/[repo]`) has tabs:
  Overview, Context, Assembled, Specs, Plans, Changelog, Loops,
  ADRs, Graph, Agents, Settings. ([validated by `renders one Loops tab where Backlog and Triage were` @f7fbc32f](apps/web-ui/src/app/repos/[owner]/[repo]/layout.test.tsx#L33))
- FR-3.3: Overview tab shows recent tasks (PR + pipeline links,
  truncated descriptions, empty state), latest events (status badge +
  Show-all, empty state), the enrollment/re-onboard controls, and the
  repo's Dark Factory mode. ([validated by renders the enrollment section and wires the one enrolment trigger + the webhook action button @ad1f0e17](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L88), [shows trust level full and 12 tasks this week on the activity card, linked to settings @ac1f09d0](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L102), [renders a row per recent task with a PR link and a pipeline link @62a7385c](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L115), [truncates long task descriptions to 60 chars with an ellipsis @032e5215](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L148), [shows No tasks yet and links All runs to the run list filtered to re-cinq/lore when there are no tasks @c5e3c74f](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L160), [renders a row per latest event with a status badge and a Show all link @c42bd91a](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L171), [shows the empty-events state with a Show all link when there are no events @b059f578](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L200), [`EnrollmentSection.test.tsx@b564f686`](apps/web-ui/src/components/EnrollmentSection.test.tsx#L32), [`EnrollmentSection.test.tsx:48`](apps/web-ui/src/components/EnrollmentSection.test.tsx#L48), [`EnrollmentSection.test.tsx@b7b6e282`](apps/web-ui/src/components/EnrollmentSection.test.tsx#L120), [`EnrollmentSection.test.tsx@d749f805`](apps/web-ui/src/components/EnrollmentSection.test.tsx#L147), [`ReonboardButton.test.tsx@3b2e2b4d`](apps/web-ui/src/components/ReonboardButton.test.tsx#L7), [`ReonboardButton.test.tsx@4544a8cd`](apps/web-ui/src/components/ReonboardButton.test.tsx#L25), [validated by retains existing activity behavior by rendering all PR links @824eb4d1](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.acceptance.test.tsx#L90), [validated by surfaces setup refusals @9ebdb19d](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.acceptance.test.tsx#L120))
- FR-3.3a: Overview renders the repo README (or omits it when absent),
  as collapsible markdown with GFM tables, raw inline HTML, fenced
  code, and relative image/link URLs resolved against the repo's raw
  and HTML base URLs. ([validated by `ReadmeBox.test.tsx@5a9fa724`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L18), [`ReadmeBox.test.tsx@a0544e95`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L30), [`ReadmeBox.test.tsx@a9c869c2`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L42), [`ReadmeBox.test.tsx@818a934d`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L54), [`ReadmeBox.test.tsx@a98b6a6b`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L72), [`ReadmeBox.test.tsx@3dc0c89c`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L92), [`ReadmeBox.test.tsx@9e492b65`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L114), [`ReadmeBox.test.tsx@2aff28e1`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L126), [`ReadmeBox.test.tsx@494dd520`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L139), [`ReadmeBox.test.tsx@26c3a052`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L150), [`ReadmeBox.test.tsx@87d38584`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L162), [`ReadmeBox.test.tsx@fc2c55ed`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L171), [`ReadmeBox.test.tsx@5dff9ef3`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L249), [`readme-markdown.test.ts@ff5dd4ce`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L7), [`readme-markdown.test.ts@f7bda2c6`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L13), [`readme-markdown.test.ts@9f191b04`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L19), [`readme-markdown.test.ts@ad4c58f7`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L23), [`readme-markdown.test.ts@1e21ce10`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L27), [`readme-markdown.test.ts@7c3b6b92`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L31), [`readme-markdown.test.ts@bbea6f85`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L37), [`readme-markdown.test.ts@08b9f93b`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L43), [`readme-markdown.test.ts@f189da35`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L51), [`readme-markdown.test.ts@ed15c57b`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L55), [`readme-markdown.test.ts@048f5de9`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L59), [renders the readme box when a readme is provided @29f7b805](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L67), [omits the readme box when readme is null @a5339989](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L83))
- FR-3.3d: Every repo page opens with a header that names the repo under a
  Repositories breadcrumb back to the list, renders the GitHub description
  when there is one, and shows the team, the ingest age and a GitHub link
  from Lore's record. ([validated by names the repo under a breadcrumb back to the repository list @e0388e8b](apps/web-ui/src/app/repos/[owner]/[repo]/RepoHeader.test.tsx#L15), [validated by renders the GitHub description when there is one @90c1c138](apps/web-ui/src/app/repos/[owner]/[repo]/RepoHeader.test.tsx#L36), [validated by shows the team, the ingest age and a GitHub link from Lore's record @25e8b7e6](apps/web-ui/src/app/repos/[owner]/[repo]/RepoHeader.test.tsx#L26))
- FR-3.3e: The overview lists the repo's ingested convention files with its
  indexed chunk count, and says so when no convention file is ingested yet.
  ([validated by lists the ingested convention files and the indexed chunk count @f9738252](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L209), [validated by says so when no convention files are ingested @8e65973e](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L221))
- FR-3.3c: The README markdown is sanitized after raw-HTML parsing: an
  injected `<script>` renders nothing executable, an `onerror` attribute
  is stripped from raw `<img>` HTML, `javascript:` hrefs are stripped
  from both markdown and raw-HTML links, and an injected `<iframe>` is
  dropped, as is an injected `<svg onload>` — while GFM task-list
  checkboxes still render through the sanitizer — and `resolveUrl`
  blanks any non-allowlisted absolute scheme (javascript:, data:,
  vbscript:) instead of passing it through to href/src.
  ([validated by `ReadmeBox.test.tsx@e133dcaa`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L182), [`ReadmeBox.test.tsx@d8dc2592`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L194), [`ReadmeBox.test.tsx@416f07df`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L207), [`ReadmeBox.test.tsx@8f3d5778`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L218), [`ReadmeBox.test.tsx@55609cf7`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L229), [`ReadmeBox.test.tsx@5e547699`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L238), [`ReadmeBox.test.tsx@511a6529`](apps/web-ui/src/app/repos/[owner]/[repo]/ReadmeBox.test.tsx#L258), [`readme-markdown.test.ts@5d4264c7`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L65), [`readme-markdown.test.ts@b68b7199`](apps/web-ui/src/app/repos/[owner]/[repo]/readme-markdown.test.ts#L69))
- FR-3.3b: PR status pills render the PR state text (nothing when the
  status is null/empty, muted colour for an unknown status), and the
  panel fetches per-task PR status, re-fetches when the task id
  changes, and stays silent on a missing status, rejection, or a
  resolve after unmount. ([validated by `PRStatusBadge.test.tsx@925a8b51`](apps/web-ui/src/app/assembly-runs/PRStatusBadge.test.tsx#L7), [`PRStatusBadge.test.tsx@b57c784b`](apps/web-ui/src/app/assembly-runs/PRStatusBadge.test.tsx#L14), [`PRStatusBadge.test.tsx@85543642`](apps/web-ui/src/app/assembly-runs/PRStatusBadge.test.tsx#L20), [`PRStatusBadge.test.tsx@3c9b1958`](apps/web-ui/src/app/assembly-runs/PRStatusBadge.test.tsx#L47), [validated by `maps the %s status to its pill color` @c7b3f007](apps/web-ui/src/app/assembly-runs/PRStatusBadge.test.tsx#L37), [`PRStatusBadgePanel.test.tsx@e993062b`](apps/web-ui/src/app/assembly-runs/PRStatusBadgePanel.test.tsx#L40), [`PRStatusBadgePanel.test.tsx@ec6f2974`](apps/web-ui/src/app/assembly-runs/PRStatusBadgePanel.test.tsx#L48), [`PRStatusBadgePanel.test.tsx@9d57d87c`](apps/web-ui/src/app/assembly-runs/PRStatusBadgePanel.test.tsx#L62), [`PRStatusBadgePanel.test.tsx@a6f1f7e7`](apps/web-ui/src/app/assembly-runs/PRStatusBadgePanel.test.tsx#L71), [`PRStatusBadgePanel.test.tsx@11ba4636`](apps/web-ui/src/app/assembly-runs/PRStatusBadgePanel.test.tsx#L79), [`PRStatusBadgePanel.test.tsx@7c93dbb7`](apps/web-ui/src/app/assembly-runs/PRStatusBadgePanel.test.tsx#L90), [`PRStatusBadgePanel.test.tsx@5114a5bb`](apps/web-ui/src/app/assembly-runs/PRStatusBadgePanel.test.tsx#L110), [validated by renders PR state pills when a status is known and omits them when unknown @23c7f41d](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.acceptance.test.tsx#L53))
- FR-3.4: _(Rewritten 2026-10-23.)_ A repository has no runs tab:
  its runs are the global run list filtered to it (`specs/external-floor`
  FR17.11), linked from the overview's "All runs". The job-run detail page renders the job/status badges, all optional
  fields, the log output (or missing/unreadable/in-process messages),
  and a not-found state with a back link. ([validated by `JobRunView.test.tsx@f62ffdd7`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L40), [`JobRunView.test.tsx@4deab6f9`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L52), [`JobRunView.test.tsx@2a002ae8`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L70), [`JobRunView.test.tsx@fb53a760`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L78), [`JobRunView.test.tsx@11844b7f`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L89), [`JobRunView.test.tsx@3ebd798a`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L97), [`JobRunView.test.tsx@341fc813`](apps/web-ui/src/app/job-runs/[id]/JobRunView.test.tsx#L106))
- FR-3.5: Context tab shows CLAUDE.md, ADRs, runbooks for this repo. ([validated by `RepoContextView.test.tsx@411dd18a`](apps/web-ui/src/app/repos/[owner]/[repo]/context/RepoContextView.test.tsx#L49))
- FR-3.6: Specs tab shows .specify/ specs for this repo, with status
  pills and a filter-chip row (an All chip counting the true list
  length plus one chip per present status, aria-pressed on the active
  filter, a legend distinguishing status from coverage). ([validated by `SpecListView.test.tsx@ea60dfcf`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecListView.test.tsx#L7), [`SpecStatusChips.test.tsx@10079094`](apps/web-ui/src/components/SpecStatusChips.test.tsx#L7), [`SpecStatusChips.test.tsx@8f9c46c4`](apps/web-ui/src/components/SpecStatusChips.test.tsx#L15), [`SpecStatusChips.test.tsx@deb27d58`](apps/web-ui/src/components/SpecStatusChips.test.tsx#L31), [`SpecStatusChips.test.tsx@8196e049`](apps/web-ui/src/components/SpecStatusChips.test.tsx#L46), [`SpecStatusChips.test.tsx@37c420e1`](apps/web-ui/src/components/SpecStatusChips.test.tsx#L66), [`SpecStatusChips.test.tsx@37b5934f`](apps/web-ui/src/components/SpecStatusChips.test.tsx#L82), [`SpecStatusPill.test.tsx@54e8d563`](apps/web-ui/src/components/SpecStatusPill.test.tsx#L7), [`SpecStatusPill.test.tsx@488bd342`](apps/web-ui/src/components/SpecStatusPill.test.tsx#L13))
- FR-3.7: Agents tab shows agent definitions scoped to this repo. ([validated by `AgentList.test.tsx@c0448261`](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentList.test.tsx#L46))
- FR-3.8: Global search, audit, and shared pools remain as
  top-level nav items; a shared-pool detail page renders the pool
  heading/breadcrumb, a truncated creator, singular/plural entry and
  contributing-agent counts, an empty-entries state, and a card per
  entry with its key, readable agent id and version, with short values verbatim and long values
  truncated with an expand/collapse toggle. ([validated by `PoolDetailView.test.tsx@f8e02ba3`](apps/web-ui/src/app/pools/[name]/PoolDetailView.test.tsx#L26), [`PoolDetailView.test.tsx@20323c96`](apps/web-ui/src/app/pools/[name]/PoolDetailView.test.tsx#L49), [`PoolDetailView.test.tsx@e4fc900b`](apps/web-ui/src/app/pools/[name]/PoolDetailView.test.tsx#L72), [`PoolDetailView.test.tsx@f685a415`](apps/web-ui/src/app/pools/[name]/PoolDetailView.test.tsx#L91), [`PoolDetailView.test.tsx@2216ad39`](apps/web-ui/src/app/pools/[name]/PoolDetailView.test.tsx#L117), [`PoolDetailView.test.tsx@b3d8d449`](apps/web-ui/src/app/pools/[name]/PoolDetailView.test.tsx#L130), [`PoolValueCell.test.tsx@b99a5ace`](apps/web-ui/src/app/pools/[name]/PoolValueCell.test.tsx#L29), [`PoolValueCell.test.tsx@10fd1f5a`](apps/web-ui/src/app/pools/[name]/PoolValueCell.test.tsx#L37), [`PoolValueCell.test.tsx@29f072eb`](apps/web-ui/src/app/pools/[name]/PoolValueCell.test.tsx#L50), [`PoolValueCell.test.tsx@00705896`](apps/web-ui/src/app/pools/[name]/PoolValueCell.test.tsx#L68))
- FR-3.9: ADRs tab renders a card per ADR summary — title, lead-paragraph
  description, and a status pill parsed from the ADR's frontmatter — with
  a Details link to the encoded detail path, an adr-kind filter-chip row
  (frontmatter legend, no coverage clause) that narrows the cards and
  hides unstatused ADRs under a status filter, the shared search box and
  lifecycle sort, and empty-state/no-match hints. ([validated by `AdrListView@2c23fe23`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/AdrListView.test.tsx#L26), [`AdrListView@c18a8041`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/AdrListView.test.tsx#L42), [`AdrListView@ec261a31`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/AdrListView.test.tsx#L47), [`AdrListView@047c5c5f`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/AdrListView.test.tsx#L61), [`AdrListView@89953ee4`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/AdrListView.test.tsx#L77), [`AdrListView@ca16945c`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/AdrListView.test.tsx#L97), [`AdrListView@945d3436`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/AdrListView.test.tsx#L104), [`AdrListView@f758bc93`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/AdrListView.test.tsx#L114), [`AdrListView@0d2198ac`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/AdrListView.test.tsx#L123), [`SpecStatusChips@78d267d1`](apps/web-ui/src/components/SpecStatusChips.test.tsx#L95))
- FR-3.10: Assembled tab previews assembled context — a template
  selector (current option preselected), a backend selector (repo
  default, lore, utopia, both, lore-v2) whose choice the fetch sends as
  `backend` (lore-v2 greys out the template selector, and its result
  says whether the context builder wrote it or the template assembly
  answered instead), submit disabled until a
  non-blank query is entered, a fetch to the context-preview endpoint
  with encoded query + template, and rendering of the budget summary,
  source cards, the nested context/section/document prompt tree (with
  a rendered-markdown/raw toggle), or an HTTP/rejection error that is
  cleared on the next successful assemble. ([validated by `AssembledContextView.test.tsx@2d87bbe6`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L86), [`AssembledContextView.test.tsx@fcd2ec9f`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L96), [validated by says the context builder wrote the block when lore-v2 answered with its section @f61c5ad9](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L259), [validated by says lore-v2 fell back to the template assembly when the block carries a trace @02331460](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L278), [validated by disables the template select when lore-v2 is picked @617dcf9a](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L292), [validated by offers the repo default, lore, utopia, both and lore-v2 as backends @7d221732](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L104), [validated by fetches the context-preview endpoint with backend lore-v2 when lore-v2 is picked @12a75693](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextPanel.test.tsx#L105), [`AssembledContextView.test.tsx@fdc971e4`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L117), [`AssembledContextView.test.tsx@2b61cf21`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L136), [`AssembledContextView.test.tsx@d6ec808c`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L162), [`AssembledContextView.test.tsx@8da4e9a6`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L180), [`AssembledContextView.test.tsx@9686d8c3`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L206), [`AssembledContextView.test.tsx@9e88ab4b`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L216), [`AssembledContextPanel.test.tsx@5ce3b454`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextPanel.test.tsx#L79), [`AssembledContextPanel.test.tsx@ba0f32ee`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextPanel.test.tsx#L86), [`AssembledContextPanel.test.tsx@667e5233`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextPanel.test.tsx#L124), [`AssembledContextPanel.test.tsx@48ac0d35`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextPanel.test.tsx#L141), [`AssembledContextPanel.test.tsx@3fd1ea66`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextPanel.test.tsx#L154), [`AssembledContextPanel.test.tsx@179929bd`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextPanel.test.tsx#L170))
- FR-3.12: Events tab renders a row per repo event (name + status) or
  an empty state, filtering by the repo column, ordering newest-first,
  and paging one row past the page size from the given offset; the
  infinite-scroll pager shows a sentinel row while a further page exists
  and renders nothing once no page and no appended events remain. ([validated by `EventsView.test.tsx@7143482d`](apps/web-ui/src/app/repos/[owner]/[repo]/events/EventsView.test.tsx#L18), [`EventsView.test.tsx@ad363060`](apps/web-ui/src/app/repos/[owner]/[repo]/events/EventsView.test.tsx#L46), [`events-data.test.ts@81d09d45`](apps/web-ui/src/app/repos/[owner]/[repo]/events/events-data.test.ts#L20), [`events-data.test.ts@1b0312aa`](apps/web-ui/src/app/repos/[owner]/[repo]/events/events-data.test.ts#L32), [`events-data.test.ts@77b59f1f`](apps/web-ui/src/app/repos/[owner]/[repo]/events/events-data.test.ts#L44), [`events-data.test.ts@e34111ee`](apps/web-ui/src/app/repos/[owner]/[repo]/events/events-data.test.ts#L55), [`renders a pager sentinel row when a further page exists` @f81ec703](apps/web-ui/src/app/repos/[owner]/[repo]/events/InfiniteEvents.test.tsx#L16), [`renders nothing when there is no further page and no events loaded yet` @09e3e8f7](apps/web-ui/src/app/repos/[owner]/[repo]/events/InfiniteEvents.test.tsx#L33))
- FR-3.13: Settings tab renders the General section prefilled from
  settings and every onboarded repo as a cross-repo option, in four
  section cards a sub-navigation links to (no
  dark-factory/agent/approval-PR controls), and its save-result banner
  reports saved, unconfigured, and generic-error outcomes. ([validated by `SettingsView.test.tsx@1b927902`](apps/web-ui/src/app/repos/[owner]/[repo]/settings/SettingsView.test.tsx#L22), [`SettingsView.test.tsx@0a02d946`](apps/web-ui/src/app/repos/[owner]/[repo]/settings/SettingsView.test.tsx#L49), [`SettingsView.test.tsx@9d1646df`](apps/web-ui/src/app/repos/[owner]/[repo]/settings/SettingsView.test.tsx#L100), [`SaveResultBanner.test.tsx@d885f1a4`](apps/web-ui/src/app/repos/[owner]/[repo]/settings/SaveResultBanner.test.tsx#L7), [`SaveResultBanner.test.tsx@d2d4a45c`](apps/web-ui/src/app/repos/[owner]/[repo]/settings/SaveResultBanner.test.tsx#L15), [links the sub-navigation to the four section cards @177898d2](apps/web-ui/src/app/repos/[owner]/[repo]/settings/SettingsView.test.tsx#L86), [validated by surfaces the server's refusal message in state.error @25b97e10](apps/web-ui/src/app/repos/[owner]/[repo]/settings/page.test.tsx#L43), [validated by returns an unconfigured error when the API is not configured @44522c88](apps/web-ui/src/app/repos/[owner]/[repo]/settings/page.test.tsx#L63))
- FR-3.14: The app shell renders a collapsible sidebar (every nav link once in declared order, active highlighting on exact/sub-routes via the "/" boundary, pinned Settings/Add-Repo footer actions, grouped collapsible sections, and in-flight spinners) with a mobile hamburger/overlay drawer (focus management, aria-expanded, and Escape/overlay/route-change close semantics) and a user menu (name / avatar fallbacks and sign-out). ([validated by `SidebarNav.test.tsx@e77e449f`](apps/web-ui/src/app/SidebarNav.test.tsx#L64), [`SidebarNav.test.tsx@4801372c`](apps/web-ui/src/app/SidebarNav.test.tsx#L77), [`SidebarNav.test.tsx@4801372c`](apps/web-ui/src/app/SidebarNav.test.tsx#L89), [`SidebarNav.test.tsx@e77e449f`](apps/web-ui/src/app/SidebarNav.test.tsx#L101), [`SidebarNav.test.tsx@af2d35d4`](apps/web-ui/src/app/SidebarNav.test.tsx#L172), [`SidebarNav.test.tsx@2ffe4c86`](apps/web-ui/src/app/SidebarNav.test.tsx#L189), [`SidebarNav.test.tsx@2ffe4c86`](apps/web-ui/src/app/SidebarNav.test.tsx#L198), [`SidebarNav.test.tsx@ee2f0f42`](apps/web-ui/src/app/SidebarNav.test.tsx#L215), [`SidebarNav.test.tsx@483ae6f8`](apps/web-ui/src/app/SidebarNav.test.tsx#L228), [`SidebarNav.test.tsx@a65d8250`](apps/web-ui/src/app/SidebarNav.test.tsx#L235), [`SidebarNav.test.tsx@9c6a53f6`](apps/web-ui/src/app/SidebarNav.test.tsx#L251), [`SidebarNav.test.tsx@6e01ed56`](apps/web-ui/src/app/SidebarNav.test.tsx#L265), [`SidebarNav.test.tsx@7b7d494c`](apps/web-ui/src/app/SidebarNav.test.tsx#L274), [`SidebarNav.test.tsx@54093afc`](apps/web-ui/src/app/SidebarNav.test.tsx#L286), [`SidebarNav.test.tsx@88546866`](apps/web-ui/src/app/SidebarNav.test.tsx#L301), [`SidebarNav.test.tsx@1fa80a2e`](apps/web-ui/src/app/SidebarNav.test.tsx#L317), [`SidebarNav.test.tsx@af2d35d4`](apps/web-ui/src/app/SidebarNav.test.tsx#L325), [`SidebarNav.test.tsx@e77e449f`](apps/web-ui/src/app/SidebarNav.test.tsx#L338), [`SidebarNav.test.tsx@e77e449f`](apps/web-ui/src/app/SidebarNav.test.tsx#L349), [`SidebarNav.test.tsx@e77e449f`](apps/web-ui/src/app/SidebarNav.test.tsx#L358), [`SidebarNav.test.tsx@e77e449f`](apps/web-ui/src/app/SidebarNav.test.tsx#L375), [`AppShell.test.tsx@466760a6`](apps/web-ui/src/app/AppShell.test.tsx#L40), [`AppShell.test.tsx@d6fe4f4c`](apps/web-ui/src/app/AppShell.test.tsx#L44), [`AppShell.test.tsx@b19b9634`](apps/web-ui/src/app/AppShell.test.tsx#L67), [`AppShell.test.tsx@9766fe07`](apps/web-ui/src/app/AppShell.test.tsx#L73), [`AppShell.test.tsx@4af4b962`](apps/web-ui/src/app/AppShell.test.tsx#L78), [`AppShell.test.tsx@c71f313b`](apps/web-ui/src/app/AppShell.test.tsx#L83), [`AppShell.test.tsx@21ae3b14`](apps/web-ui/src/app/AppShell.test.tsx#L92), [`AppShell.test.tsx@a0516ea2`](apps/web-ui/src/app/AppShell.test.tsx#L100), [`AppShell.test.tsx@ea09259b`](apps/web-ui/src/app/AppShell.test.tsx#L108), [`AppShell.test.tsx@a50ab790`](apps/web-ui/src/app/AppShell.test.tsx#L117), [`AppShell.test.tsx@b4cbee04`](apps/web-ui/src/app/AppShell.test.tsx#L125), [`AppShell.test.tsx@30968386`](apps/web-ui/src/app/AppShell.test.tsx#L133), [`AppShell.test.tsx@2ee2cff6`](apps/web-ui/src/app/AppShell.test.tsx#L141), [`AppShell.test.tsx@c269d0c2`](apps/web-ui/src/app/AppShell.test.tsx#L153), [`AppShell.test.tsx@ad57ef68`](apps/web-ui/src/app/AppShell.test.tsx#L170), [`AppShell.test.tsx@9693af5c`](apps/web-ui/src/app/AppShell.test.tsx#L184), [renders no settings link (settings lives in the sidebar nav now) @a6a504b4](apps/web-ui/src/app/UserMenu.test.tsx#L91))

- FR-3.15: A top-level org Settings page exists — it renders the
  section headings, stat cards, the platform-config form
  (api_url/ingest_token, blank defaults), the regenerate-token danger
  form, the approval form, and the install command with the supplied
  token/api-url (or placeholders). Each section is a card that a
  sub-navigation beside the cards links to by id, titled at the heading
  level the page asks for, under a caption, title and lede header. The former global Tasks view (a
  legacy chunk-backed page predating the pipeline) was removed in
  #1057 (issue #1049) in favor of the per-repo Assembly Lines tab. ([validated by `SettingsView.test.tsx@9bd1e360`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L50), [`SettingsView.test.tsx@6217275e`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L69), [`SettingsView.test.tsx@1239fab4`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L82), [`SettingsView.test.tsx@6bdf7634`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L95), [`SettingsView.test.tsx@50aa0d4e`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L107), [`SettingsView.test.tsx@af42e150`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L116), [`SettingsView.test.tsx@d0f2bde9`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L146), [`SettingsView.test.tsx@78f61898`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L168), [`SettingsView.test.tsx@4a9e5521`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L180), [links each sub-navigation entry to the card with its id @ebfd2d65](apps/web-ui/src/components/SettingsLayout.test.tsx#L7), [names each card by its heading at the level the page asks for @f7406005](apps/web-ui/src/components/SettingsLayout.test.tsx#L26), [renders the header's caption, title and lede @067fe749](apps/web-ui/src/components/SettingsLayout.test.tsx#L42))
- FR-3.16: Every doc card list (specs, ADRs, the global browsers)
  shares one pure filter/sort helper — status counts and visibility
  (unstatused docs shown only under "All"), a case-insensitive text
  query over title/description that recounts the chips within the
  match, and a path-or-lifecycle sort ordering unstatused docs last
  without mutating the input — surfaced on both tabs through shared
  search/sort controls whose card lists narrow and reorder accordingly. ([validated by `doc-filter@a6c9a2b8`](apps/web-ui/src/lib/doc-filter.test.ts#L23), [`doc-filter@a2b0f4bd`](apps/web-ui/src/lib/doc-filter.test.ts#L30), [`doc-filter@89f6be12`](apps/web-ui/src/lib/doc-filter.test.ts#L34), [`doc-filter@6d2a3c5e`](apps/web-ui/src/lib/doc-filter.test.ts#L40), [`doc-filter@964d9ae3`](apps/web-ui/src/lib/doc-filter.test.ts#L49), [`doc-filter@bfce96b8`](apps/web-ui/src/lib/doc-filter.test.ts#L60), [`doc-filter@a7c9be87`](apps/web-ui/src/lib/doc-filter.test.ts#L68), [`doc-filter@121a55bd`](apps/web-ui/src/lib/doc-filter.test.ts#L72), [`doc-filter@d4f12e68`](apps/web-ui/src/lib/doc-filter.test.ts#L88), [`DocListControls@ebe9ce12`](apps/web-ui/src/components/DocListControls.test.tsx#L7), [`DocListControls@c732a147`](apps/web-ui/src/components/DocListControls.test.tsx#L18), [`DocListControls@76f18bb5`](apps/web-ui/src/components/DocListControls.test.tsx#L36), [`SpecListView@945d3436`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecListView.test.tsx#L94), [`SpecListView@0d2198ac`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecListView.test.tsx#L123))
- FR-3.17: Doc lifecycle statuses for the list pages ride the list API
  response itself — each doc's `{status, label}` pill is derived
  server-side by the canonical kind-aware `docStatusPill` parser (the
  `| Status |` header row for the spec kind, the frontmatter `status:`
  value for the adr kind), and entries whose status is missing or
  unparseable get no pill. ([validated by `spec-status@2850cd29`](libs/shared/src/domain/spec-status.test.ts#L361), [`spec-status@09707c37`](libs/shared/src/domain/spec-status.test.ts#L320), [`spec-status@7c781105`](libs/shared/src/domain/spec-status.test.ts#L351), [`spec-status@22420df1`](libs/shared/src/domain/spec-status.test.ts#L357))
- FR-3.18: The ADR detail page strips the leading YAML frontmatter from
  the rendered source (a minimal YAML-lite parser: scalars, quoted
  scalars, flow and block lists; a later `---` is a horizontal rule; the
  body starts right after the closing fence) and renders it as a
  metadata header — status pill, decision date, domain chips, and
  cross-links (`relates` → the owning spec's detail page, `amends` → the
  amended ADR's detail page) — omitting absent keys, skipping the pill
  for an unrecognized status, and rendering nothing for empty meta. ([validated by `frontmatter@6df686eb`](apps/web-ui/src/lib/frontmatter.test.ts#L19), [`frontmatter@29feebb0`](apps/web-ui/src/lib/frontmatter.test.ts#L31), [`frontmatter@f19bc59e`](apps/web-ui/src/lib/frontmatter.test.ts#L39), [`frontmatter@3cca556f`](apps/web-ui/src/lib/frontmatter.test.ts#L45), [`frontmatter@86ef71d3`](apps/web-ui/src/lib/frontmatter.test.ts#L51), [`frontmatter@6bc82591`](apps/web-ui/src/lib/frontmatter.test.ts#L57), [`frontmatter@cbfb6c88`](apps/web-ui/src/lib/frontmatter.test.ts#L63), [`AdrMetaView@d7beba5d`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/[...path]/AdrMetaView.test.tsx#L16), [`AdrMetaView@84647659`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/[...path]/AdrMetaView.test.tsx#L25), [`AdrMetaView@e17d6ac7`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/[...path]/AdrMetaView.test.tsx#L46), [`AdrMetaView@acc724b9`](apps/web-ui/src/app/repos/[owner]/[repo]/adrs/[...path]/AdrMetaView.test.tsx#L54))

- FR-3.19: The sidebar footer links to the cluster dashboard (Headlamp)
  only when the deployment names one, as an external anchor in a new tab
  that is never highlighted as the current route. The address is the sole
  signal that a dashboard exists — the browser cannot read the
  `enable_headlamp` Terraform gate — so an absent, empty, or
  whitespace-only `HEADLAMP_URL` renders no link at all; empty rather
  than missing is the disabled case, because the umbrella release is
  applied with `reuse_values = true` and a dropped key would be carried
  forward from the previous release. The value is read on the server and
  passed down as a prop, never through `NEXT_PUBLIC_`, which Next inlines
  at build time while the hostname is only known at deploy time. ([validated by `renders no Headlamp link when the deployment names no dashboard` @e77e449f](apps/web-ui/src/app/SidebarNav.test.tsx#L114), [`renders no Headlamp link when the dashboard address is empty` @eeb5570c](apps/web-ui/src/app/SidebarNav.test.tsx#L119), [`links to the named dashboard in a new tab without leaking the referrer` @c40c4720](apps/web-ui/src/app/SidebarNav.test.tsx#L124), [`marks the dashboard link as leaving the app rather than as a route` @39876b76](apps/web-ui/src/app/SidebarNav.test.tsx#L133), [`pins the dashboard link outside the scrollable nav, beside Settings` @39876b76](apps/web-ui/src/app/SidebarNav.test.tsx#L142), [`leaves the dashboard link inert while an in-app navigation is pending` @79b0ec4e](apps/web-ui/src/app/SidebarNav.test.tsx#L150), [`adds exactly one link to the sidebar and changes no other` @c40c4720](apps/web-ui/src/app/SidebarNav.test.tsx#L160), [`returns the dashboard address the deployment names` @48bd88ed](apps/web-ui/src/lib/headlamp-url.test.ts#L5), [`names no address when the variable is unset` @5c157b4a](apps/web-ui/src/lib/headlamp-url.test.ts#L11), [`names no address when the variable is set but empty` @32c593fa](apps/web-ui/src/lib/headlamp-url.test.ts#L15), [`names no address when the variable holds only whitespace` @e3513af2](apps/web-ui/src/lib/headlamp-url.test.ts#L19), [`trims surrounding whitespace off an address` @07b209ae](apps/web-ui/src/lib/headlamp-url.test.ts#L23))
- FR-3.20: The sidebar footer links to the metrics dashboards (Grafana,
  ADR-050) under the same rule: only when the deployment names one in
  `GRAFANA_URL`, as an external anchor in a new tab beside the Headlamp
  link, and no link at all for an absent or empty address. ([validated by `links to the named Grafana in a new tab beside the Headlamp link`](apps/web-ui/src/app/SidebarNav.test.tsx#L391), [`renders no Grafana link when the deployment names none` @e77e449f](apps/web-ui/src/app/SidebarNav.test.tsx#L411), [`returns the Grafana address the deployment names` @b8a53717](apps/web-ui/src/lib/headlamp-url.test.ts#L31), [`names no address when the variable is empty` @3cc7e230](apps/web-ui/src/lib/headlamp-url.test.ts#L37), [`names no address when the variable is unset or holds only whitespace` @6b263f59](apps/web-ui/src/lib/headlamp-url.test.ts#L41))
- FR-3.21: The sidebar footer links to Utopia under the same rule: only
  when the deployment names it in `UTOPIA_URL`, as an external anchor in
  a new tab after the Grafana link, and no link at all for an absent or
  empty address. ([validated by `links to the named Utopia in a new tab` @9737fbf5](apps/web-ui/src/app/SidebarNav.test.tsx#L420), [`renders no Utopia link when the deployment names none` @e77e449f](apps/web-ui/src/app/SidebarNav.test.tsx#L430), [`returns the Utopia address the deployment names` @1d6968ae](apps/web-ui/src/lib/headlamp-url.test.ts#L50), [`names no address when the variable is unset, empty or only whitespace` @ac615e70](apps/web-ui/src/lib/headlamp-url.test.ts#L56))
- FR-3.22: A command palette lists every nav destination (sidebar order,
  then Settings and Add repo) and, for a typed query, the destinations
  whose label holds it followed by a full-text "Search for" entry that
  opens `/search?q=`. It opens from the sidebar's "Search or jump to" pill,
  the mobile header's search pill, Cmd+K / Ctrl+K anywhere, and a bare `/`
  outside a field; the arrow keys move its highlight (wrapping at either
  end), Enter opens it, and Escape closes it. ([validated by `lists every nav destination, then settings and add repo, for an empty query` @ab0fcb91](apps/web-ui/src/components/command-palette/palette-items.test.ts#L5), [`keeps the destinations whose label holds the query, then offers a search for it` @0242e051](apps/web-ui/src/components/command-palette/palette-items.test.ts#L12), [`sends the search entry to /search with the query encoded` @7d6aebeb](apps/web-ui/src/components/command-palette/palette-items.test.ts#L18), [`wraps from the last entry to the first and back` @b11bfca2](apps/web-ui/src/components/command-palette/palette-items.test.ts#L26), [`toggles the palette on Cmd+K and Ctrl+K, even while typing` @9edecb73](apps/web-ui/src/components/shell/shortcut-keys.test.ts#L15), [`opens the palette on a bare slash outside a field` @074e49e1](apps/web-ui/src/components/shell/shortcut-keys.test.ts#L24), [`opens from the sidebar's search pill and closes on Escape` @d3cfe59b](apps/web-ui/src/components/shell/ShellProvider.test.tsx#L36), [`opens on Ctrl+K and on a bare slash` @07f6c467](apps/web-ui/src/components/shell/ShellProvider.test.tsx#L44), [`moves the highlight with the arrows and opens it on Enter` @95321aab](apps/web-ui/src/components/shell/ShellProvider.test.tsx#L53), [`searches for the typed query when nothing else matches` @7e15b3d7](apps/web-ui/src/components/shell/ShellProvider.test.tsx#L62), [`opens the command palette from the mobile header's search pill` @a34ecdab](apps/web-ui/src/app/AppShell.test.tsx#L196))
- FR-3.23: A keyboard-shortcuts dialog (a bare `?`, or the sidebar
  footer's Shortcuts button) lists only the keys the app answers, and a
  glossary dialog (the footer's Glossary button) defines Lore's own terms;
  at most one overlay is open at a time, and each closes on Escape or its
  close pill. ([validated by `toggles the shortcuts dialog on a bare question mark` @f890f62e](apps/web-ui/src/components/shell/shortcut-keys.test.ts#L32), [`closes on Escape only while an overlay is open` @6d6320b1](apps/web-ui/src/components/shell/shortcut-keys.test.ts#L40), [`closes a toggled overlay that is already open, and opens it otherwise` @8f9372c8](apps/web-ui/src/components/shell/shortcut-keys.test.ts#L49), [`opens the keyboard shortcuts on a bare question mark` @cb9550f6](apps/web-ui/src/components/shell/ShellProvider.test.tsx#L72), [`opens the glossary of Lore terms from the sidebar footer` @db9319aa](apps/web-ui/src/components/shell/ShellProvider.test.tsx#L80), [`closes a dialog from its close pill` @5609f20d](apps/web-ui/src/components/shell/ShellProvider.test.tsx#L89))
- FR-3.24: Beside the page the sidebar folds to an icon-only rail and
  back from a toggle that reports its state with `aria-pressed`; the
  choice is remembered per browser, and a browser whose storage refuses
  it keeps the choice for the visit. ([validated by `folds the layout to the rail when the toggle is pressed` @7ee7af14](apps/web-ui/src/app/AppShell.test.tsx#L215), [`remembers the rail across visits` @e8b38415](apps/web-ui/src/app/AppShell.test.tsx#L224), [`keeps this visit's choice when storage throws` @5e610c61](apps/web-ui/src/components/shell/ShellProvider.test.tsx#L98))
- FR-3.25: The sidebar's foot shows the signed-in person's avatar (their initials when the provider gave no picture), their name, the deployed build SHA in mono, and an icon sign-out button that posts to `/auth/signout`; with no one signed in it shows the build alone. ([validated by `shows only the deployed build when no one is signed in` @86951221](apps/web-ui/src/app/UserMenu.test.tsx#L21), [`shows the build SHA beside the signed-in name` @73b91c96](apps/web-ui/src/app/UserMenu.test.tsx#L29), [`draws the initials in place of a missing picture` @b2e4bda4](apps/web-ui/src/app/UserMenu.test.tsx#L59), [`renders an icon Sign out button titled for the pointer` @1fcf62fc](apps/web-ui/src/app/UserMenu.test.tsx#L72), [`takes the first and last word of a name` @a2099fcd](apps/web-ui/src/app/UserMenu.test.tsx#L98), [`takes an email's local part, split on dots` @42d9740f](apps/web-ui/src/app/UserMenu.test.tsx#L102), [`falls back to a question mark when there is no name` @8e732f54](apps/web-ui/src/app/UserMenu.test.tsx#L106), [shows the person's name @6d8a8bc3](apps/web-ui/src/app/UserMenu.test.tsx#L39), [renders the avatar img with src and alt when image is present @317498cb](apps/web-ui/src/app/UserMenu.test.tsx#L46), [renders no avatar img when image is an empty string @c93b86e0](apps/web-ui/src/app/UserMenu.test.tsx#L65), [posts the sign out form to /auth/signout @fc53cba4](apps/web-ui/src/app/UserMenu.test.tsx#L81))
- FR-3.26: On a narrow screen the page opens with a header of a menu pill
  that opens the nav drawer (whose own close button draws the close icon),
  the Lore mark and wordmark, and the palette's search pill. ([validated by `draws the menu icon inside the open-menu button` @adbb41ac](apps/web-ui/src/app/AppShell.test.tsx#L58), [`draws the drawer's close button as the close icon` @1fd2ec9f](apps/web-ui/src/app/AppShell.test.tsx#L51), [`opens the command palette from the mobile header's search pill` @a34ecdab](apps/web-ui/src/app/AppShell.test.tsx#L196))

### FR-4: Form and Input Styling

- FR-4.1: All form controls — every text input, textarea, select, and button —
  share one base rule in `globals.css` that opts them into the theme font, and
  native `<select>` option popups are pinned to theme surface tokens (no
  per-control hardcoding). ([validated by `globals-styling.test.ts@6b870ab4`](apps/web-ui/src/app/globals-styling.test.ts#L11), [`globals-styling.test.ts@0b9a0715`](apps/web-ui/src/app/globals-styling.test.ts#L15), [`globals-styling.test.ts@0b3e45ba`](apps/web-ui/src/app/globals-styling.test.ts#L23))
- FR-4.2: Repo selector is a dropdown populated from the registry,
  not free text. *(Removed 2026-10-02 with the form.)*
- FR-4.3: Task type selector shows descriptions, not just names —
  describing the first option by default, updating the description on
  change, and keeping the `task_type` field name for submission. *(Removed 2026-10-02 with the form.)*
- FR-4.4: Forms have proper labels, validation, and error states; the
  shared submit button shows its idle label while enabled and swaps to
  the pending label and disables while the form is pending (keeping its
  children as the label when no pendingLabel is given). ([validated by `SubmitButton.test.tsx@7885d4ae`](apps/web-ui/src/components/SubmitButton.test.tsx#L18), [`SubmitButton.test.tsx@4ac988c2`](apps/web-ui/src/components/SubmitButton.test.tsx#L27), [`SubmitButton.test.tsx@4dbedf74`](apps/web-ui/src/components/SubmitButton.test.tsx#L36), [validated by `setup-form.acceptance.test.tsx@c5baa93e`](apps/web-ui/src/components/setup-form.acceptance.test.tsx#L8), [validated by `setup-form.acceptance.test.tsx@a4977c43`](apps/web-ui/src/components/setup-form.acceptance.test.tsx#L53), [`actions.test.ts@7548be14`](apps/web-ui/src/app/repos/[owner]/[repo]/actions.test.ts#L72), [`actions.test.ts@5e6befe5`](apps/web-ui/src/app/repos/[owner]/[repo]/actions.test.ts#L81))

### FR-5: Onboarding PR Content

The onboarding PR carries deterministic files committed verbatim by the Floor plus repo-specific files the `onboard` line's agent authors from the ticket's fixed prompts, reading the repository itself, reviewed by the owner in the PR. ([validated by owes every LLM-drafted path with its prompt @e9329ace](libs/shared/src/work/onboard-content.test.ts#L127))

- FR-5.1: The context-ingest and advisory spec-impact workflows are committed
  verbatim — `.github/workflows/lore-ingest.yml` and
  `.github/workflows/lore-trace-impact.yml`. ([validated by targets the workflows path @bce50cd7](libs/shared/src/work/ingest-workflow.test.ts#L22), [validated by exposes FILES as a step-level env var, not inside the run block @1cb2d57c](libs/shared/src/work/ingest-workflow.test.ts#L34), [`trace-impact-workflow.test.ts@bce50cd7`](libs/shared/src/work/trace-impact-workflow.test.ts#L11), [`trace-impact-workflow.test.ts@1ee3d805`](libs/shared/src/work/trace-impact-workflow.test.ts#L25))
- FR-5.2: `.github/PULL_REQUEST_TEMPLATE.md` carries the canonical PR sections —
  Why, What Changed, Alternatives Considered, ADRs & Architecture, Testing. ([validated by `pr-template.test.ts@d8443f9a`](libs/shared/src/pr-template.test.ts#L11), [`pr-template.test.ts@ad2649ff`](libs/shared/src/pr-template.test.ts#L15), [`pr-template.test.ts@23257b79`](libs/shared/src/pr-template.test.ts#L19), [`pr-template.test.ts@0a0da2df`](libs/shared/src/pr-template.test.ts#L23), [`pr-template.test.ts@05afedc1`](libs/shared/src/pr-template.test.ts#L27), [`pr-template.test.ts@157df7ae`](libs/shared/src/pr-template.test.ts#L31))
- FR-5.3: `.github/workflows/pr-description-check.yml` enforces those PR sections
  in CI, treating a comment-only or blank section as empty. ([validated by `pr-section-check.test.ts@02acdc03`](libs/shared/src/work/pr-section-check.test.ts#L26), [`pr-section-check.test.ts@f10c7c56`](libs/shared/src/work/pr-section-check.test.ts#L44), [`pr-section-check.test.ts@91074177`](libs/shared/src/work/pr-section-check.test.ts#L67), [`pr-section-check.test.ts@043c8667`](libs/shared/src/work/pr-section-check.test.ts#L78))

- FR-5.4: The onboarding PR commits static scaffolding verbatim —
  `.claude/settings.json` carrying a `SessionStart` hook that tells every
  session to call `lore_assemble_context` first, and the
  four `.github/ISSUE_TEMPLATE/*.yml` task templates; a repo-owned file the repo already holds with different content is left as it is. ([validated by commits .claude/settings.json whose SessionStart hook tells the session to call lore_assemble_context first @82ba590c](libs/shared/src/work/onboard-content.test.ts#L23), [validated by commits the four .github/ISSUE_TEMPLATE task templates verbatim @1c17610e](libs/shared/src/work/onboard-content.test.ts#L45), [validated by returns false for a repo-owned file when it already exists @2c334e60](libs/shared/src/work/onboard/onboard-scaffold.test.ts#L29))
- FR-5.5: The ticket owes `AGENTS.md`, the PR template, the pr-description-check
  workflow, and `.specify/spec.md` from fixed prompts — the AGENTS.md prompt
  targets the repo's own stack and the PR-template prompt names the five
  canonical sections. The pr-description-check prompt passes the PR body to
  the script only through a step `env:` entry, bans `${{ }}` inside `run:`,
  and declares read-only permissions (#1567). ([validated by has the pr-description-check workflow read the PR body only through a step env entry, under read-only permissions (#1567) @4d7f0c93](libs/shared/src/work/onboard-content.test.ts#L81), [validated by LLM-drafts AGENTS.md from a non-empty prompt @b2128415](libs/shared/src/work/onboard-content.test.ts#L58), [validated by PR-template prompt names the five canonical sections @c2dd56aa](libs/shared/src/work/onboard-content.test.ts#L65), [validated by LLM-drafts the pr-description-check workflow and the .specify spec @7425fdd8](libs/shared/src/work/onboard-content.test.ts#L98))
- FR-5.6: The onboarding PR scaffolds no `CLAUDE.md` (requested in the onboarding
  issue for the owner to author) and no `spec-agent.yml` — spec and ingest
  triggering ride the ingest and spec-impact workflows above. ([validated by scaffolds no CLAUDE.md, requested in the onboarding issue instead @abf4dac5](libs/shared/src/work/onboard-content.test.ts#L109), [validated by scaffolds no spec-agent.yml @9169ba23](libs/shared/src/work/onboard-content.test.ts#L113))
- FR-5.8: The starter ADRs the agent writes are numbered sequentially, so a
  skipped topic leaves no gap. ([validated by numbers the starter ADRs it writes sequentially, so a skipped topic leaves no gap @c55e6675](libs/shared/src/work/onboard-content.test.ts#L146))
- FR-5.9: The suggested test-command manifest's `list` emits each test's real
  line range, and its `run` uses only coverage tooling the repo already
  declares. ([validated by demands real line ranges from list and coverage tooling the repo already has @16c817fe](libs/shared/src/work/onboard-content.test.ts#L190))

### FR-6: Top-Level Observability Pages

The top-level nav hosts org-wide observability pages that read across
every repo. ([validated by `AuditView.test.tsx@16d6ab19`](apps/web-ui/src/app/audit/AuditView.test.tsx#L35))

- FR-6.1: The Audit page (`/audit`) renders one row per audit-log entry
  with a truncated agent id and an operation badge, showing the key,
  pool and stringified-metadata cells (em-dashes when null) with full
  metadata expandable as pretty-printed JSON (nothing to open when there
  is none); it offers an agent search and one operation chip per
  operation plus All, seeded from the current agent/op query, distinguishes
  a first-run empty state from a no-matches state on an out-of-range
  page, and renders pagination links that disable at the ends and
  preserve the active filters in their hrefs. ([validated by `AuditView.test.tsx@16d6ab19`](apps/web-ui/src/app/audit/AuditView.test.tsx#L35), [`AuditView.test.tsx@d8869dda`](apps/web-ui/src/app/audit/AuditView.test.tsx#L69), [`AuditView.test.tsx@3b090248`](apps/web-ui/src/app/audit/AuditView.test.tsx#L95), [`AuditView.test.tsx@67e0c31b`](apps/web-ui/src/app/audit/AuditView.test.tsx#L112), [`AuditView.test.tsx@233d953c`](apps/web-ui/src/app/audit/AuditView.test.tsx#L133), [`AuditView.test.tsx@5ba57b64`](apps/web-ui/src/app/audit/AuditView.test.tsx#L150), [`AuditView.test.tsx@8272101d`](apps/web-ui/src/app/audit/AuditView.test.tsx#L172), [`AuditView.test.tsx@8fd02587`](apps/web-ui/src/app/audit/AuditView.test.tsx#L199), [`AuditView.test.tsx@1c560502`](apps/web-ui/src/app/audit/AuditView.test.tsx#L224), [`AuditView.test.tsx@a38152f6`](apps/web-ui/src/app/audit/AuditView.test.tsx#L243), [`AuditView.test.tsx@a0b3ef54`](apps/web-ui/src/app/audit/AuditView.test.tsx#L275))
- FR-6.2: The Episodes page (`/episodes`) renders a card per episode
  with a truncated agent id, a source pill, its ref (em-dash when
  null) and fact count, and a content preview that appends an ellipsis
  only when it hits the 300-char cap; it exposes a row of source filter
  chips, an empty state, and pagination that hides on a single page, carries
  the source into the page links, and disables Previous/Next at the
  first/last page. ([validated by `EpisodesView.test.tsx@c69c569d`](apps/web-ui/src/app/episodes/EpisodesView.test.tsx#L20), [`EpisodesView.test.tsx@03826cdc`](apps/web-ui/src/app/episodes/EpisodesView.test.tsx#L60), [`EpisodesView.test.tsx@e9c6bb7c`](apps/web-ui/src/app/episodes/EpisodesView.test.tsx#L73), [`EpisodesView.test.tsx@b611bc15`](apps/web-ui/src/app/episodes/EpisodesView.test.tsx#L88), [`EpisodesView.test.tsx@b6e9c32b`](apps/web-ui/src/app/episodes/EpisodesView.test.tsx#L102), [`EpisodesView.test.tsx@5ced638e`](apps/web-ui/src/app/episodes/EpisodesView.test.tsx#L131), [`EpisodesView.test.tsx@9c09af0d`](apps/web-ui/src/app/episodes/EpisodesView.test.tsx#L145), [`EpisodesView.test.tsx@764bdea4`](apps/web-ui/src/app/episodes/EpisodesView.test.tsx#L159), [`EpisodesView.test.tsx@9422c326`](apps/web-ui/src/app/episodes/EpisodesView.test.tsx#L180))
- FR-6.3: The Gaps page (`/gaps`) links to Repositories and to the
  context-gap draft PRs on GitHub, renders a card per gap-detection
  finding (its key and raw value) and a row per zero-result search query
  (the query the search recorded, how many times it was asked and when
  last), each with its own empty state. ([validated by `GapsView.test.tsx@b521994f`](apps/web-ui/src/app/gaps/GapsView.test.tsx#L33), [`GapsView.test.tsx@9798371b`](apps/web-ui/src/app/gaps/GapsView.test.tsx#L50), [`GapsView.test.tsx@63c3d2a9`](apps/web-ui/src/app/gaps/GapsView.test.tsx#L65), [`GapsView.test.tsx@29ce8c80`](apps/web-ui/src/app/gaps/GapsView.test.tsx#L72), [`GapsView.test.tsx@31eeb03e`](apps/web-ui/src/app/gaps/GapsView.test.tsx#L90))
- FR-6.4: The Graph explorer page (`/graph`) renders an entity-type
  filter row of chips with counts (an All chip active when no type is
  selected, the matching chip active when one is, hidden when there are no
  types), a row per entity with name, type pill, repo (em-dash when
  absent) and edge count, linking to explore it with the active type query
  only when set, and
  an entities empty state; selecting an entity reveals a relationships
  section with a Show/Hide-invalidated toggle and invalidated badges, or
  its own empty state when the entity has no edges. ([validated by `GraphView.test.tsx@b163cea0`](apps/web-ui/src/app/graph/GraphView.test.tsx#L52), [`GraphView.test.tsx@c7d46fb2`](apps/web-ui/src/app/graph/GraphView.test.tsx#L70), [`GraphView.test.tsx@2142eaa1`](apps/web-ui/src/app/graph/GraphView.test.tsx#L90), [`GraphView.test.tsx@3c0340f2`](apps/web-ui/src/app/graph/GraphView.test.tsx#L103), [`GraphView.test.tsx@9b65be24`](apps/web-ui/src/app/graph/GraphView.test.tsx#L122), [`GraphView.test.tsx@e6d0eee9`](apps/web-ui/src/app/graph/GraphView.test.tsx#L135), [`GraphView.test.tsx@b57f3afa`](apps/web-ui/src/app/graph/GraphView.test.tsx#L150), [`GraphView.test.tsx@419210d7`](apps/web-ui/src/app/graph/GraphView.test.tsx#L167), [`GraphView.test.tsx@eedab7b2`](apps/web-ui/src/app/graph/GraphView.test.tsx#L180), [`GraphView.test.tsx@3c74fe8f`](apps/web-ui/src/app/graph/GraphView.test.tsx#L203), [`GraphView.test.tsx@510c541d`](apps/web-ui/src/app/graph/GraphView.test.tsx#L220))
- FR-6.5: The shared-pools list page (`/pools`) renders the heading and
  a card per pool, its name a link to the encoded detail page, with
  labelled entry and agent counts, a localized created-at date, and a `created_by` that
  stays whole when readable but truncates an opaque hex value (full
  value in the title), with an empty state when there are no
  pools. ([validated by `PoolsView.test.tsx@a31ec53c`](apps/web-ui/src/app/pools/PoolsView.test.tsx#L17), [`PoolsView.test.tsx@c9ac48cf`](apps/web-ui/src/app/pools/PoolsView.test.tsx#L26), [`PoolsView.test.tsx@56ceb4b1`](apps/web-ui/src/app/pools/PoolsView.test.tsx#L31), [`PoolsView.test.tsx@74132532`](apps/web-ui/src/app/pools/PoolsView.test.tsx#L38), [`PoolsView.test.tsx@7f441c01`](apps/web-ui/src/app/pools/PoolsView.test.tsx#L46), [`PoolsView.test.tsx@4609c76f`](apps/web-ui/src/app/pools/PoolsView.test.tsx#L57), [`PoolsView.test.tsx@42402e44`](apps/web-ui/src/app/pools/PoolsView.test.tsx#L66), [`PoolsView.test.tsx@f0de62c8`](apps/web-ui/src/app/pools/PoolsView.test.tsx#L75))
- FR-6.6: The Spend page (`/spend`) is Lore-computed-first (no admin key
  required) and interval-scoped: every figure renders from the selected
  window's `/api/spend-window` fetch — there is no second, month-to-date
  data source. It renders the title and every section heading, headlines the
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
  non-zero. ([validated by [`SpendView.test.tsx@2991ffb1`](apps/web-ui/src/app/spend/SpendView.test.tsx#L179), [`SpendView.test.tsx@51d23855`](apps/web-ui/src/app/spend/SpendView.test.tsx#L293), [`SpendView.test.tsx@51d23855`](apps/web-ui/src/app/spend/SpendView.test.tsx#L304), [`SpendView.test.tsx@51d23855`](apps/web-ui/src/app/spend/SpendView.test.tsx#L316), [`SpendView.test.tsx@51d23855`](apps/web-ui/src/app/spend/SpendView.test.tsx#L325), [`SpendView.test.tsx@51d23855`](apps/web-ui/src/app/spend/SpendView.test.tsx#L336), [`SpendView.test.tsx@4425fe05`](apps/web-ui/src/app/spend/SpendView.test.tsx#L350), [`SpendView.test.tsx@1a7652ce`](apps/web-ui/src/app/spend/SpendView.test.tsx#L371), [`SpendView.test.tsx@0684b4f2`](apps/web-ui/src/app/spend/SpendView.test.tsx#L377), [`SpendView.test.tsx@1648b27c`](apps/web-ui/src/app/spend/SpendView.test.tsx#L386), [`SpendView.test.tsx@7ec31f45`](apps/web-ui/src/app/spend/SpendView.test.tsx#L398), [`SpendView.test.tsx@ee20c925`](apps/web-ui/src/app/spend/SpendView.test.tsx#L408), [`SpendView.test.tsx@ee74597c`](apps/web-ui/src/app/spend/SpendView.test.tsx#L418), [`SpendView.test.tsx@6ab7281e`](apps/web-ui/src/app/spend/SpendView.test.tsx#L203), [`SpendView.test.tsx@309f9ba9`](apps/web-ui/src/app/spend/SpendView.test.tsx#L392))
- FR-6.7: The knowledge-graph force layout (`lib/graph-layout`) seeds
  feature positions within a radius at distinct spots (larger features
  further out), partitions links into connected components, places
  component spots on a rim, scales a bounding radius by the square root
  of (vertices + edges) between a floor and a cap, clamps a node's
  velocity inside that border, floors/scales/caps the pre-warm settle
  ticks, lays a radial tree out ring-by-ring centred on each parent's
  children, separates small components past a margin, grows the feature
  ring so trees don't overlap, and counts edge crossings. ([validated by `graph-layout.test.ts@e1da25f8`](apps/web-ui/src/lib/graph-layout.test.ts#L20), [`graph-layout.test.ts@25dae688`](apps/web-ui/src/lib/graph-layout.test.ts#L37), [`graph-layout.test.ts@c45bee3d`](apps/web-ui/src/lib/graph-layout.test.ts#L58), [`graph-layout.test.ts@8c98aa59`](apps/web-ui/src/lib/graph-layout.test.ts#L64), [`graph-layout.test.ts@cbdaa961`](apps/web-ui/src/lib/graph-layout.test.ts#L83), [`graph-layout.test.ts@e159bd55`](apps/web-ui/src/lib/graph-layout.test.ts#L87), [`graph-layout.test.ts@0c142cdd`](apps/web-ui/src/lib/graph-layout.test.ts#L98), [`graph-layout.test.ts@17b98fea`](apps/web-ui/src/lib/graph-layout.test.ts#L109), [`graph-layout.test.ts@45468c66`](apps/web-ui/src/lib/graph-layout.test.ts#L119), [`graph-layout.test.ts@67ab8c2f`](apps/web-ui/src/lib/graph-layout.test.ts#L126), [`graph-layout.test.ts@c57a0a20`](apps/web-ui/src/lib/graph-layout.test.ts#L133), [`graph-layout.test.ts@37b3efa6`](apps/web-ui/src/lib/graph-layout.test.ts#L139), [`graph-layout.test.ts@dea8061a`](apps/web-ui/src/lib/graph-layout.test.ts#L145), [`graph-layout.test.ts@000b0791`](apps/web-ui/src/lib/graph-layout.test.ts#L151), [`graph-layout.test.ts@33bb496e`](apps/web-ui/src/lib/graph-layout.test.ts#L162), [`graph-layout.test.ts@df21d1e9`](apps/web-ui/src/lib/graph-layout.test.ts#L172), [`graph-layout.test.ts@d9f3a946`](apps/web-ui/src/lib/graph-layout.test.ts#L182), [`graph-layout.test.ts@2aaa7177`](apps/web-ui/src/lib/graph-layout.test.ts#L192), [`graph-layout.test.ts@51c5fc61`](apps/web-ui/src/lib/graph-layout.test.ts#L202), [`graph-layout.test.ts@3ea5f213`](apps/web-ui/src/lib/graph-layout.test.ts#L219), [`graph-layout.test.ts@07c9fe95`](apps/web-ui/src/lib/graph-layout.test.ts#L223), [`graph-layout.test.ts@240b0740`](apps/web-ui/src/lib/graph-layout.test.ts#L227), [`graph-layout.test.ts@c468a1b6`](apps/web-ui/src/lib/graph-layout.test.ts#L235), [`graph-layout.test.ts@2a0255de`](apps/web-ui/src/lib/graph-layout.test.ts#L239), [`graph-layout.test.ts@ee8afa4e`](apps/web-ui/src/lib/graph-layout.test.ts#L257), [`graph-layout.test.ts@ea2102b2`](apps/web-ui/src/lib/graph-layout.test.ts#L271), [`graph-layout.test.ts@93f682ed`](apps/web-ui/src/lib/graph-layout.test.ts#L285), [`graph-layout.test.ts@4ba63b29`](apps/web-ui/src/lib/graph-layout.test.ts#L294), [`graph-layout.test.ts@38a76940`](apps/web-ui/src/lib/graph-layout.test.ts#L320), [`graph-layout.test.ts@9111fe0a`](apps/web-ui/src/lib/graph-layout.test.ts#L332), [`graph-layout.test.ts@2615af92`](apps/web-ui/src/lib/graph-layout.test.ts#L346), [`graph-layout.test.ts@c1dea8da`](apps/web-ui/src/lib/graph-layout.test.ts#L352), [`graph-layout.test.ts@fcb9f91d`](apps/web-ui/src/lib/graph-layout.test.ts#L365), [`graph-layout.test.ts@2a1171c2`](apps/web-ui/src/lib/graph-layout.test.ts#L377), [`graph-layout.test.ts@c6e4b000`](apps/web-ui/src/lib/graph-layout.test.ts#L396), [`graph-layout.test.ts@35975aa3`](apps/web-ui/src/lib/graph-layout.test.ts#L408))
- FR-6.8: The graph crowding helpers (`lib/graph-crowding`) count node
  degrees across links, weaken a link's strength by its busier
  (higher-degree) endpoint down to a floor, scale node repulsion by the
  square root of degree (capped so a mega-hub cannot explode the
  layout), and grow a node's collide radius with degree up to a padding
  cap. ([validated by `graph-crowding.test.ts@4afc0e2b`](apps/web-ui/src/lib/graph-crowding.test.ts#L10), [`graph-crowding.test.ts@711da54d`](apps/web-ui/src/lib/graph-crowding.test.ts#L16), [`graph-crowding.test.ts@adb1569d`](apps/web-ui/src/lib/graph-crowding.test.ts#L26), [`graph-crowding.test.ts@c1448200`](apps/web-ui/src/lib/graph-crowding.test.ts#L32), [`graph-crowding.test.ts@6d7ef4cc`](apps/web-ui/src/lib/graph-crowding.test.ts#L36), [`graph-crowding.test.ts@380c6f0a`](apps/web-ui/src/lib/graph-crowding.test.ts#L40), [`graph-crowding.test.ts@c506a1ee`](apps/web-ui/src/lib/graph-crowding.test.ts#L44), [`graph-crowding.test.ts@61542ed0`](apps/web-ui/src/lib/graph-crowding.test.ts#L50), [`graph-crowding.test.ts@692a603f`](apps/web-ui/src/lib/graph-crowding.test.ts#L54), [`graph-crowding.test.ts@1699f8e8`](apps/web-ui/src/lib/graph-crowding.test.ts#L58), [`graph-crowding.test.ts@6f01ac47`](apps/web-ui/src/lib/graph-crowding.test.ts#L64), [`graph-crowding.test.ts@2abff960`](apps/web-ui/src/lib/graph-crowding.test.ts#L68), [`graph-crowding.test.ts@2cde710f`](apps/web-ui/src/lib/graph-crowding.test.ts#L72))
- FR-6.9: The edge-bundling helpers (`lib/edge-bundling`) build a
  containment forest from `in_feature`/`in_spec` parent edges (ignoring
  cross-cutting kinds), walk a node's ancestor chain to the root
  (stopping on a cycle), and route an edge through its endpoints' lowest
  common ancestor, ordering the control ids source → LCA → target. ([validated by `edge-bundling.test.ts@c5dfbcc8`](apps/web-ui/src/lib/edge-bundling.test.ts#L16), [`edge-bundling.test.ts@75a408f2`](apps/web-ui/src/lib/edge-bundling.test.ts#L25), [`edge-bundling.test.ts@54a0c83e`](apps/web-ui/src/lib/edge-bundling.test.ts#L34), [`edge-bundling.test.ts@ca93938e`](apps/web-ui/src/lib/edge-bundling.test.ts#L46), [`edge-bundling.test.ts@5a8fdeb9`](apps/web-ui/src/lib/edge-bundling.test.ts#L55), [`edge-bundling.test.ts@287209ad`](apps/web-ui/src/lib/edge-bundling.test.ts#L59), [`edge-bundling.test.ts@81d6a436`](apps/web-ui/src/lib/edge-bundling.test.ts#L77), [`edge-bundling.test.ts@05c6243c`](apps/web-ui/src/lib/edge-bundling.test.ts#L87), [`edge-bundling.test.ts@492f20e1`](apps/web-ui/src/lib/edge-bundling.test.ts#L95))
- FR-6.10: The assembly-line run presenters (`lib/assembly-run-presenter`)
  format a relative time (pluralised units, "just now" under a minute),
  format a duration in seconds/minutes (em-dash when null), and map a
  run's state and outcome to a visual tone — success for
  finished+completed, warning for iteration_max, muted for lease_held,
  danger for finished-but-failed, neutral for an unknown finished
  outcome, and muted/danger/running for queued/failed/running
  regardless of outcome. ([validated by `assembly-run-presenter.test.ts@8881f72c`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L13), [`assembly-run-presenter.test.ts@9681fc0a`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L23), [`assembly-run-presenter.test.ts@b488bb71`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L58), [`assembly-run-presenter.test.ts@03ac99ae`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L63), [`assembly-run-presenter.test.ts@19552956`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L96), [`assembly-run-presenter.test.ts@6f13ea36`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L103), [`assembly-run-presenter.test.ts@96bddff7`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L110), [`assembly-run-presenter.test.ts@58d56f8c`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L117), [`assembly-run-presenter.test.ts@3e4e2fd2`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L128), [`assembly-run-presenter.test.ts@e3c6f0d3`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L143), [`assembly-run-presenter.test.ts@89326634`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L150), [`assembly-run-presenter.test.ts@47cff214`](apps/web-ui/src/lib/assembly-run-presenter.test.ts#L161))
- FR-6.11: The run-row mapper (`lib/assembly-runs`) resolves a
  run's PR from its task join or from `args.pr_number` for a code-review
  run without a task PR, maps a run with no task and no PR to null
  pr/creator/cost, and computes node and run durations (left null while
  still running). ([validated by `assembly-runs.test.ts@d05ff037`](apps/web-ui/src/lib/assembly-runs.test.ts#L37), [`assembly-runs.test.ts@d3a81bde`](apps/web-ui/src/lib/assembly-runs.test.ts#L64), [`assembly-runs.test.ts@4bfb1575`](apps/web-ui/src/lib/assembly-runs.test.ts#L86), [`assembly-runs.test.ts@96a0b2da`](apps/web-ui/src/lib/assembly-runs.test.ts#L105), [`assembly-runs.test.ts@d7456aa7`](apps/web-ui/src/lib/assembly-runs.test.ts#L114), [`assembly-runs.test.ts@90a3fc8c`](apps/web-ui/src/lib/assembly-runs.test.ts#L155))

### FR-7: Shared UI Components

The app is built from a shared set of presentational components. ([validated by `EmptyState.test.tsx@ac8e2faf`](apps/web-ui/src/components/EmptyState.test.tsx#L7))

- FR-7.1: `CopyButton` shows the Copy label, writes the given text to
  the clipboard on click, swaps to Copied after a successful write and
  reverts to Copy 1500ms later, and keeps the Copy label when the
  clipboard write rejects. ([validated by `CopyButton.test.tsx@cc0cf6ac`](apps/web-ui/src/components/CopyButton.test.tsx#L26), [`CopyButton.test.tsx@f4e029fa`](apps/web-ui/src/components/CopyButton.test.tsx#L31), [`CopyButton.test.tsx@f64cd9bc`](apps/web-ui/src/components/CopyButton.test.tsx#L44), [`CopyButton.test.tsx@b7d96c7c`](apps/web-ui/src/components/CopyButton.test.tsx#L53), [`CopyButton.test.tsx@98c9c790`](apps/web-ui/src/components/CopyButton.test.tsx#L71))
- FR-7.2: `HelpPopover` renders a collapsed trigger (default label Help,
  a provided label applied to both the trigger and the opened dialog)
  that opens on click and toggles closed on a second click; while open
  it closes on an outside mousedown, on Escape and on unmount but stays
  open on an inside mousedown or a non-Escape keydown, registering its
  document listeners only while open and tearing them down on close and
  unmount. ([validated by `HelpPopover.test.tsx@15b7d4ea`](apps/web-ui/src/components/HelpPopover.test.tsx#L7), [`HelpPopover.test.tsx@accd4605`](apps/web-ui/src/components/HelpPopover.test.tsx#L18), [`HelpPopover.test.tsx@0d6726ab`](apps/web-ui/src/components/HelpPopover.test.tsx#L30), [`HelpPopover.test.tsx@34e81ca3`](apps/web-ui/src/components/HelpPopover.test.tsx#L45), [`HelpPopover.test.tsx@2433a23e`](apps/web-ui/src/components/HelpPopover.test.tsx#L57), [`HelpPopover.test.tsx@d9fc8d30`](apps/web-ui/src/components/HelpPopover.test.tsx#L73), [`HelpPopover.test.tsx@c909ee34`](apps/web-ui/src/components/HelpPopover.test.tsx#L84), [`HelpPopover.test.tsx@df267294`](apps/web-ui/src/components/HelpPopover.test.tsx#L95), [`HelpPopover.test.tsx@3a2e4234`](apps/web-ui/src/components/HelpPopover.test.tsx#L104), [`HelpPopover.test.tsx@ecf0364a`](apps/web-ui/src/components/HelpPopover.test.tsx#L114), [`HelpPopover.test.tsx@82d63b7d`](apps/web-ui/src/components/HelpPopover.test.tsx#L128))
- FR-7.3: `NavLink`/`NavLabel` apply the active class and `aria-current`
  when active (omitting both when inactive) and show a loading spinner
  while the link's navigation is pending. ([validated by `NavLink.test.tsx@a27b114c`](apps/web-ui/src/components/NavLink.test.tsx#L16), [`NavLink.test.tsx@9c1c9686`](apps/web-ui/src/components/NavLink.test.tsx#L22), [`NavLink.test.tsx@19625b81`](apps/web-ui/src/components/NavLink.test.tsx#L30), [`NavLink.test.tsx@8c62472b`](apps/web-ui/src/components/NavLink.test.tsx#L39), [`NavLink.test.tsx@999a6e7d`](apps/web-ui/src/components/NavLink.test.tsx#L47))
- FR-7.4: `EmptyState` renders its title alone, plus an optional
  description and an optional action link. ([validated by `EmptyState.test.tsx@ac8e2faf`](apps/web-ui/src/components/EmptyState.test.tsx#L7), [`EmptyState.test.tsx@b883fb6a`](apps/web-ui/src/components/EmptyState.test.tsx#L13), [`EmptyState.test.tsx@d0c0f2d2`](apps/web-ui/src/components/EmptyState.test.tsx#L25))
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
  ([validated by `InlineMarkdown.test.tsx@51c4abef`](apps/web-ui/src/components/InlineMarkdown.test.tsx#L7), [`InlineMarkdown.test.tsx@d32fd2ef`](apps/web-ui/src/components/InlineMarkdown.test.tsx#L14), [`InlineMarkdown.test.tsx@71052077`](apps/web-ui/src/components/InlineMarkdown.test.tsx#L20), [`InlineMarkdown.test.tsx@ed8d09a7`](apps/web-ui/src/components/InlineMarkdown.test.tsx#L26), [`Linkified.test.tsx@f3e8c7a6`](apps/web-ui/src/components/Linkified.test.tsx#L10), [`Linkified.test.tsx@be685ae8`](apps/web-ui/src/components/Linkified.test.tsx#L21), [`Linkified.test.tsx@d2aa4db2`](apps/web-ui/src/components/Linkified.test.tsx#L32), [`Linkified.test.tsx@b7500e0a`](apps/web-ui/src/components/Linkified.test.tsx#L40), [`Linkified.test.tsx@ccc23b33`](apps/web-ui/src/components/Linkified.test.tsx#L46), [`references.test.ts@e0084deb`](apps/web-ui/src/lib/references.test.ts#L8), [`references.test.ts@0eda6d52`](apps/web-ui/src/lib/references.test.ts#L18), [`references.test.ts@70712b0d`](apps/web-ui/src/lib/references.test.ts#L25), [`references.test.ts@efbb9164`](apps/web-ui/src/lib/references.test.ts#L32), [`references.test.ts@fc9886f7`](apps/web-ui/src/lib/references.test.ts#L41), [`references.test.ts@4c52711d`](apps/web-ui/src/lib/references.test.ts#L47), [`references.test.ts@5332fa5f`](apps/web-ui/src/lib/references.test.ts#L51), [`references.test.ts@dc8788ed`](apps/web-ui/src/lib/references.test.ts#L59), [`references-parity@212d0c75`](apps/web-ui/src/lib/references.parity.test.ts#L22), [`references-parity-delta@3032e6c1`](apps/web-ui/src/lib/references.parity.test.ts#L26))
- FR-7.6: `TimeAgo` keeps the absolute date/time visible alongside a
  relative label — "just now" under a minute, hours-ago within the day,
  days-ago within the week, and the full timestamp for old dates —
  renders the raw value for an unparseable date, and renders absolute
  and relative on one line when inline. ([validated by `TimeAgo.test.tsx@a945897d`](apps/web-ui/src/components/TimeAgo.test.tsx#L20), [`TimeAgo.test.tsx@a370f9ac`](apps/web-ui/src/components/TimeAgo.test.tsx#L26), [`TimeAgo.test.tsx@9003d990`](apps/web-ui/src/components/TimeAgo.test.tsx#L30), [`TimeAgo.test.tsx@3b231da8`](apps/web-ui/src/components/TimeAgo.test.tsx#L34), [`TimeAgo.test.tsx@88f598cf`](apps/web-ui/src/components/TimeAgo.test.tsx#L38), [`TimeAgo.test.tsx@6bbbc73c`](apps/web-ui/src/components/TimeAgo.test.tsx#L46), [`TimeAgo.test.tsx@5a7ccb29`](apps/web-ui/src/components/TimeAgo.test.tsx#L50))
- FR-7.7: The route error boundaries render the shared `RouteError`
  fallback — showing the error message (a generic fallback when it has
  none) and wiring the reset callback through to a Try-again button —
  for both the per-route and the global-error boundary. ([validated by `RouteError.test.tsx@806d3397`](apps/web-ui/src/components/RouteError.test.tsx#L7), [`RouteError.test.tsx@442cc4e5`](apps/web-ui/src/components/RouteError.test.tsx#L14), [`RouteError.test.tsx@86de6c60`](apps/web-ui/src/components/RouteError.test.tsx#L19), [`route-error-boundaries.test.tsx@9ee80286`](apps/web-ui/src/app/route-error-boundaries.test.tsx#L28), [`route-error-boundaries.test.tsx@e8ef5bd8`](apps/web-ui/src/app/route-error-boundaries.test.tsx#L37), [validated by `renders the RouteError fallback for the %s boundary` @eaeb12ba](apps/web-ui/src/app/route-error-boundaries.test.tsx#L18))
- FR-7.8: Navigating to the home, repo-overview, search and context
  routes shows an immediate route-level loading skeleton — a labeled
  status region of pulsing placeholder blocks mirroring each page's
  layout — instead of freezing on the previous page while the server
  component fetches. ([validated by `renders a labeled status region of skeleton blocks for the %s route` @6c76f1b9](apps/web-ui/src/app/route-loading-skeletons.test.tsx#L19))
- FR-7.9: *(Retired 2026-10-28.)* GitHub sign-in and its org check moved from this UI to lore-api; see FR-9.2.
- FR-7.10: *(Retired 2026-10-28.)* A session lasts as long as the eight hour lore-api token it carries and ends in a fresh sign-in; there is no refresh grant to keep (FR-9.4, FR-9.8).

- FR-7.11: A `/repos/{owner}/{repo}...` path whose casing doesn't match
  `lore.repos.full_name` — an old bookmark, a typed URL, or one surviving a
  repo rename — redirects to the canonically-cased path before any tab
  renders, since every `lore.repos`/`lore.plans` lookup compares `full_name`
  exactly and a case mismatch otherwise reads as "this repo has nothing"
  instead of 404ing.
  ([validated by redirects re-cinq/otto/plans to re-cinq/Otto/plans when full_name is re-cinq/Otto @4c8864c6](apps/web-ui/src/lib/canonical-repo-path.test.ts#L5), [validated by keeps the query string on the redirect @7318f2e7](apps/web-ui/src/lib/canonical-repo-path.test.ts#L11), [validated by returns null when the path already matches full_name's casing @73409200](apps/web-ui/src/lib/canonical-repo-path.test.ts#L21), [validated by returns null for the repo root with no trailing tab @70d3b2f4](apps/web-ui/src/lib/canonical-repo-path.test.ts#L27), [validated by returns null when lore-api names no repo (left to 404 downstream) @0f4404e0](apps/web-ui/src/lib/canonical-repo-path.test.ts#L33), [validated by returns null for a path outside /repos @eb21a5cc](apps/web-ui/src/lib/canonical-repo-path.test.ts#L39), [validated by finds re-cinq/lore for the wrong-case re-cinq/Lore @5f5b0f1d](libs/shared/src/outbound/project/settings/settings-record.test.ts#L61), [validated by matches full_name case-insensitively, so a wrong-case URL still finds the row @30a65b1c](libs/shared/src/outbound/project/settings/settings-record.test.ts#L107))

- FR-7.12: `Panel` is the titled card every repo tab draws its sections with: a heading above its children, a head link only when one is given, a heading id that names the section, a soft variant and the caller's class; `PanelTable` runs a table edge to edge inside it. ([validated by renders its title as a heading above its children @9fad49f5](apps/web-ui/src/components/Panel.test.tsx#L7), [validated by renders the head link when given a link @acb0ee92](apps/web-ui/src/components/Panel.test.tsx#L14), [validated by renders no link when none is given @ce2c7014](apps/web-ui/src/components/Panel.test.tsx#L27), [validated by names the section by its heading when given a headingId @17d6c54e](apps/web-ui/src/components/Panel.test.tsx#L33), [validated by adds the caller's className and the soft class to the section @d5c4ee1f](apps/web-ui/src/components/Panel.test.tsx#L47), [validated by carries only the panel class when no className and not soft @2952323b](apps/web-ui/src/components/Panel.test.tsx#L59), [validated by wraps its table @8a425026](apps/web-ui/src/components/Panel.test.tsx#L69))
- FR-7.13: `Kbd` draws a key cap as a `kbd` element, in the shortcuts list and the command palette alike. ([validated by renders its key inside a kbd element @c654ed4d](apps/web-ui/src/components/Kbd.test.tsx#L7))
- FR-7.14: `Switch` draws a boolean setting as a real checkbox, so a form posts it unchanged: named and labelled as given, checked or not by default, with the given value when on and a detail line only when one is given. ([validated by renders a checkbox named and labelled as given @1a4e7439](apps/web-ui/src/components/Switch.test.tsx#L7), [validated by starts checked when defaultChecked is true @9f43681c](apps/web-ui/src/components/Switch.test.tsx#L15), [validated by starts unchecked when defaultChecked is false @a233758f](apps/web-ui/src/components/Switch.test.tsx#L21), [validated by posts the given value when on @80a301b3](apps/web-ui/src/components/Switch.test.tsx#L27), [validated by renders the detail text when given @641222b7](apps/web-ui/src/components/Switch.test.tsx#L33), [validated by renders no detail when none is given @1a381eec](apps/web-ui/src/components/Switch.test.tsx#L41))
- FR-7.15: `SettingsCard` is one section of a settings page, named by its heading (an h2, or an h3 when asked), with an optional description and action and a danger tone only when set. ([validated by names the card by an h2 heading by default @8fa7bf34](apps/web-ui/src/components/SettingsCard.test.tsx#L7), [validated by uses an h3 heading when headingLevel is 3 @b2d7db0c](apps/web-ui/src/components/SettingsCard.test.tsx#L15), [validated by renders the description, the action and the children when given @35654c8b](apps/web-ui/src/components/SettingsCard.test.tsx#L23), [validated by renders no description paragraph when none is given @3a84dba0](apps/web-ui/src/components/SettingsCard.test.tsx#L40), [validated by adds the danger class only when danger is set @80a1754a](apps/web-ui/src/components/SettingsCard.test.tsx#L46))
- FR-7.16: `SettingsHeader` is the page title block: caption, title and a lede only when one is given. `SettingsLayout` puts its children beside the sub-navigation and marks only a danger entry as one. ([validated by renders the caption, the title and the lede @87fa9d63](apps/web-ui/src/components/SettingsHeader.test.tsx#L7), [validated by renders no lede paragraph when none is given @151bb5a8](apps/web-ui/src/components/SettingsHeader.test.tsx#L17), [validated by marks only the danger entry with the danger class @f7406005](apps/web-ui/src/components/SettingsLayout.test.tsx#L26), [validated by renders its children beside the navigation @067fe749](apps/web-ui/src/components/SettingsLayout.test.tsx#L42))
- FR-7.17: A search hit's score bar is the shared `Meter`, filled with the hit's share of the page's best score, empty when the best score is zero; the card prints the score to three decimals and the repository only when the hit has one. ([validated by fills the score meter with the share of the best score @9fbb25f7](apps/web-ui/src/app/search/SearchResultCard.test.tsx#L23), [validated by leaves the score meter empty when the best score is zero @4a00a1b8](apps/web-ui/src/app/search/SearchResultCard.test.tsx#L31), [validated by prints the score to three decimals @5fa300a1](apps/web-ui/src/app/search/SearchResultCard.test.tsx#L39), [validated by shows the repository when the hit has one @858ba458](apps/web-ui/src/app/search/SearchResultCard.test.tsx#L45), [validated by shows no repository when the hit has none @947d381e](apps/web-ui/src/app/search/SearchResultCard.test.tsx#L53))

### FR-8: Connect GitHub

Lore used to act on GitHub through one App installation fixed in the
environment (`GITHUB_APP_INSTALLATION_ID`), so it could only ever serve the
one org that installation covered. Connecting GitHub is now a flow in the UI:
an admin installs the GitHub App on any org, Lore records the installation,
and a repo is served by the installation of its owner.

- FR-8.1: Lore records each GitHub App installation — the account it covers,
  whether it covers all or only selected repos, and whether the account has
  suspended it — and finds the installation for an account whatever the case
  of the login, as GitHub logins are case-insensitive. ([validated by finds the re-cinq installation by its account login in any case @bcccedd4](libs/shared/src/outbound/project/github-installations/github-installations.test.ts#L116))
- FR-8.2: Recording an installation Lore already knows — the account widened
  it from selected repos to all of them, say — refreshes what it covers but
  keeps when it was first installed. ([validated by keeps when re-cinq was installed when the installation widens to all repos @ef0171b6](libs/shared/src/outbound/project/github-installations/github-installations.test.ts#L131))
- FR-8.3: When the App is uninstalled from an account, Lore forgets that
  installation, so it no longer claims to serve that account's repos.
  ([validated by forgets the re-cinq installation once the App is uninstalled there @3030f7e8](libs/shared/src/outbound/project/github-installations/github-installations.test.ts#L147))
- FR-8.4: Lore lists every account it is connected to, ordered by account
  login. ([validated by lists acme-corp before re-cinq, ordered by account login @d8a03d75](libs/shared/src/outbound/project/github-installations/github-installations.test.ts#L157))
- FR-8.5: Lore reads an installation as GitHub describes it — its id, the
  account and whether that is an organization or a user, and whether it
  covers all or only selected repos — refusing an account type or repository
  selection it does not know rather than storing it. ([validated by reads GitHub's re-cinq installation as the organization installation 81234567 on selected repos @1df3115e](libs/shared/src/domain/github-installation/installation-from-github.test.ts#L5))
- FR-8.6: An installation the account has suspended is recorded with the
  instant GitHub reports it was suspended. ([validated by reads a suspension GitHub reports at 2026-09-12T08:00:00Z as that instant @ba1b84cd](libs/shared/src/domain/github-installation/installation-from-github.test.ts#L22))
- FR-8.7: When GitHub sends an admin back from installing the App, Lore
  records that installation only after asking GitHub, as the App itself,
  whether the id really is one of its installations — an id in a redirect is
  not evidence on its own. ([validated by records installation 81234567 of re-cinq once GitHub confirms it belongs to this App @ec68f2d3](apps/lore-api/src/transport/routes/github-installations/record-installation.test.ts#L9))
- FR-8.8: An installation id GitHub does not know as one of the App's
  installations is answered with a 404 and nothing is recorded, so a forged
  or mistaken redirect cannot put an installation in the registry. ([validated by answers 404 for installation 99999999 that GitHub does not know as this App's, recording nothing @712961f3](apps/lore-api/src/transport/routes/github-installations/record-installation.test.ts#L42))
- FR-8.9: `POST /api/github/installations` is an admin act served over HTTP:
  a request without a bearer token is refused with a 401, and a malformed
  installation id with a 400 before GitHub is ever asked. ([validated by refuses a request that carries no bearer token with 401 @d9bf1faa](apps/lore-api/src/integration-tests/github-installations.test.ts#L34), [refuses an installation id of not-a-number with 400 before GitHub is asked @7dd6cf51](apps/lore-api/src/integration-tests/github-installations.test.ts#L44))
- FR-8.10: The Connect GitHub page lists every connected account in the same
  wire shape an installation is recorded in, ordered by account login.
  ([validated by lists the acme-corp and re-cinq installations in their wire shape, ordered by account login @7626940b](apps/lore-api/src/transport/routes/github-installations/list-installations.test.ts#L8))
- FR-8.11: `GET /api/github/installations` serves that list over HTTP to any
  bearer with read scope — a connected org's login is not a secret.
  ([validated by lists the connected accounts to a bearer with 200 and a JSON list @a17c19ce](apps/lore-api/src/integration-tests/github-installations.test.ts#L55))
- FR-8.12: The settings page's GitHub section names each connected account
  with whether it is an organization or a user and whether it covers all or
  only selected repos, and marks a suspended installation as suspended. ([validated by lists re-cinq as a connected organization on selected repos @779e5bca](apps/web-ui/src/app/settings/GithubConnectSection.test.tsx#L19), [marks a suspended installation as Suspended rather than Installed @bddd0e06](apps/web-ui/src/app/settings/GithubConnectSection.test.tsx#L32))
- FR-8.13: The GitHub section links an admin to installing the App on another
  account, and offers no link at all while the App's slug is not configured.
  ([validated by links to installing the App on another account at the lore-agent install URL @9c6d9ecc](apps/web-ui/src/app/settings/GithubConnectSection.test.tsx#L43), [offers no install link while the App's slug is not configured @5301c35b](apps/web-ui/src/app/settings/GithubConnectSection.test.tsx#L59))
- FR-8.14: Before any account is connected, the GitHub section says so in
  words rather than showing an empty list. ([validated by says Lore is not connected to any GitHub account yet when none is recorded @bd552538](apps/web-ui/src/app/settings/GithubConnectSection.test.tsx#L67))
- FR-8.15: The web UI reads the connected accounts from lore-api's
  `/api/github/installations`. ([validated by reads the connected accounts from lore-api's /api/github/installations @dc5306ed](apps/web-ui/src/lib/api/github-installations.test.ts#L23))
- FR-8.16: The settings page shows the GitHub section with the accounts
  Lore is connected to. ([validated by renders the GitHub section with the connected re-cinq organization @ff658af8](apps/web-ui/src/app/settings/SettingsView.test.tsx#L192))
- FR-8.17: The install link is built from the GitHub App's public slug, the
  one piece of the App the web UI needs; with no slug configured there is
  no link to build. ([validated by builds the lore-agent App's install URL from its slug @176bfb5c](apps/web-ui/src/app/settings/github-app-install-url.test.ts#L5), [builds no install URL while no slug is configured @532cd27b](apps/web-ui/src/app/settings/github-app-install-url.test.ts#L11))
- FR-8.18: The web UI records an installation by posting its id to lore-api's
  `/api/github/installations`. ([validated by posts installation 81234567 to lore-api's /api/github/installations @9150d460](apps/web-ui/src/lib/api/github-installations.test.ts#L33))
- FR-8.19: The callback GitHub sends an admin back to after installing the
  App reads the installation id from the redirect's query string; a redirect
  without one, or with anything but a number, names no installation. ([validated by reads installation 81234567 from GitHub's setup redirect @b105d07f](apps/web-ui/src/app/settings/github/callback/installation-id.test.ts#L5), [reads no installation from a redirect without an id or with not-a-number @4e0e0112](apps/web-ui/src/app/settings/github/callback/installation-id.test.ts#L14))
- FR-8.20: Once the installation is recorded, the callback sends the admin
  back to the settings page. ([validated by goes back to the settings page once re-cinq's installation is recorded @a790bdc4](apps/web-ui/src/app/settings/github/callback/callback-outcome.test.ts#L5))
- FR-8.21: When GitHub does not know the installation as one of the App's,
  the callback tells the admin so, and that nothing was recorded, instead of
  returning to settings as if it had worked. ([validated by explains that nothing was recorded when lore-api answers 404 not-an-installation-of-this-app @f653683b](apps/web-ui/src/app/settings/github/callback/callback-outcome.test.ts#L22))
- FR-8.22: Any other failure — a web UI that cannot reach lore-api, or an
  error from lore-api itself — is explained to the admin too, never hidden
  behind a return to settings. ([validated by explains an unconfigured web UI or a 500 upstream exploded instead of returning to settings @38f91b06](apps/web-ui/src/app/settings/github/callback/callback-outcome.test.ts#L35))

### FR-9: Sign-in through lore-api

- FR-9.1: lore-api begins the web UI's GitHub sign-in at
  `GET /api/auth/login`: it remembers which UI page asked behind a one-time
  state and sends the person to GitHub's consent page with the OAuth app's
  client id, lore-api's own callback address and the scopes
  `read:user read:org repo`. Only a page on the configured UI's origin, or a
  local UI over http, may be returned to; any other page is refused with 400,
  and while the OAuth app or lore-api's public address is not configured the
  route answers 503. ([validated by redirects to github with a state the callback can take once @c428501a](apps/lore-api/src/transport/routes/auth/login.test.ts#L10), [answers 400 when the return url is another host @994fa9a0](apps/lore-api/src/transport/routes/auth/login.test.ts#L33), [answers 503 when github oauth is not configured @9aa86b2d](apps/lore-api/src/transport/routes/auth/login.test.ts#L44), [answers 400 when no return url is given @74426808](apps/lore-api/src/transport/routes/auth/login.test.ts#L55), [allows a page on the configured UI origin @37e179a6](apps/lore-api/src/work/auth/login-grant.test.ts#L13), [allows a localhost page over http on any port @5533572c](apps/lore-api/src/work/auth/login-grant.test.ts#L19), [rejects another host @2080f119](apps/lore-api/src/work/auth/login-grant.test.ts#L25), [rejects a host that only starts with the UI hostname @0286ee5c](apps/lore-api/src/work/auth/login-grant.test.ts#L31), [rejects a non-http scheme @1540036c](apps/lore-api/src/work/auth/login-grant.test.ts#L37), [rejects text that is not a URL @fd20f52f](apps/lore-api/src/work/auth/login-grant.test.ts#L41), [rejects https localhost, which the local UI never uses @233bd764](apps/lore-api/src/work/auth/login-grant.test.ts#L45), [points at GitHub with the client, callback, scopes and state @71b6ac8f](apps/lore-api/src/work/auth/login-grant.test.ts#L63), [reads the OAuth app, the public API address, the UI and the org from the environment @b4ca07a4](apps/lore-api/src/transport/routes/auth/oauth-config.test.ts#L13), [returns null when the client id is missing @d0384d67](apps/lore-api/src/transport/routes/auth/oauth-config.test.ts#L23), [returns null when the client secret is empty @0f638b1d](apps/lore-api/src/transport/routes/auth/oauth-config.test.ts#L29), [returns null when the public API address is missing @a37477f0](apps/lore-api/src/transport/routes/auth/oauth-config.test.ts#L35), [leaves the org and the UI unset when the environment has none @3f0b660d](apps/lore-api/src/transport/routes/auth/oauth-config.test.ts#L39))
- FR-9.2: GitHub's callback, `GET /api/auth/callback`, trades the code for the
  person's GitHub token and reads who they are. With an org configured only an
  active member gets in; with no org configured every GitHub account is a
  member. Every member gets the `admin` scope for now, as the UI's shared
  admin token gave everyone, until Lore has roles of its own. Every repo
  GitHub shows the person is kept with the grant, since the org only decides
  who may sign in. A person who cancels on GitHub's consent screen comes back
  without a code and is sent back with `auth_error=github_denied`. The person
  is sent back to the UI page that asked, with a one-time code to redeem, or
  with `auth_error=not_in_org` or `github_denied` naming why not. The GitHub
  token lives inside that request and is never stored. ([validated by sends a member back with a redeem code that carries every repo GitHub shows them @7fade669](apps/lore-api/src/transport/routes/auth/callback.test.ts#L20), [gives an org admin the admin scope @34da1e53](apps/lore-api/src/transport/routes/auth/callback.test.ts#L59), [sends a person outside the org back with auth_error=not_in_org @acd0c0f5](apps/lore-api/src/transport/routes/auth/callback.test.ts#L70), [sends a person back with auth_error=github_denied when the code exchange fails @9fd92c77](apps/lore-api/src/transport/routes/auth/callback.test.ts#L78), [lets every GitHub account in as a member when no org is configured @c0d97d15](apps/lore-api/src/transport/routes/auth/callback.test.ts#L86), [adds the redeem code and keeps the existing query @e2104b53](apps/lore-api/src/work/auth/login-grant.test.ts#L73), [adds the failure reason @d2ffffd3](apps/lore-api/src/work/auth/login-grant.test.ts#L79), [returns the access token GitHub answers with @e0bb4650](apps/lore-api/src/outbound/github-user-client.test.ts#L25), [posts the client, secret, code and callback as json @b8711e2b](apps/lore-api/src/outbound/github-user-client.test.ts#L33), [returns null when GitHub answers with an error instead of a token @dd146ee6](apps/lore-api/src/outbound/github-user-client.test.ts#L55), [returns null when GitHub answers with a failure status @ece7e0c0](apps/lore-api/src/outbound/github-user-client.test.ts#L63), [returns the signed-in person's login, name and avatar @e2cdf374](apps/lore-api/src/outbound/github-user-client.test.ts#L73), [returns null when GitHub refuses the token @12023dd7](apps/lore-api/src/outbound/github-user-client.test.ts#L90), [returns admin for an active org admin @ebc1bd2b](apps/lore-api/src/outbound/github-user-client.test.ts#L100), [returns member for an active org member @72193dd4](apps/lore-api/src/outbound/github-user-client.test.ts#L111), [returns null for an invitation that is still pending @42a07bd5](apps/lore-api/src/outbound/github-user-client.test.ts#L119), [returns null for a person outside the org @be4547cd](apps/lore-api/src/outbound/github-user-client.test.ts#L127), [follows the next page link and stops after it @a5e5baa6](apps/lore-api/src/outbound/github-user-client.test.ts#L142), [stops after ten pages even when GitHub keeps offering a next one @a9fd4a35](apps/lore-api/src/outbound/github-user-client.test.ts#L160), [returns the repos read so far when a later page fails @4070306f](apps/lore-api/src/outbound/github-user-client.test.ts#L174), [sends a person who cancelled on GitHub back with auth_error=github_denied @79cc655a](apps/lore-api/src/transport/routes/auth/callback.test.ts#L108), [gives a plain org member the admin scope too, until Lore has roles of its own @2617fcb6](apps/lore-api/src/transport/routes/auth/callback.test.ts#L48))
- FR-9.3: Every one-time code of the sign-in works once. A state code is spent
  by the callback and a redeem code by `POST /api/auth/redeem`; a spent code,
  an expired code, a code that was never issued and a code of the other kind
  are all refused, with 400 at the callback and 401 at redeem. ([validated by returns the row once and nothing the second time @fc5d2735](apps/lore-api/src/work/auth/login-handoffs.test.ts#L19), [returns null for a code of the other phase @c7c8ec3d](apps/lore-api/src/work/auth/login-handoffs.test.ts#L33), [returns null after expiry @91a84fd6](apps/lore-api/src/work/auth/login-handoffs.test.ts#L43), [returns null for a code it never issued @3c9b667e](apps/lore-api/src/work/auth/login-handoffs.test.ts#L56), [takes a row with one DELETE that returns it @12ac899b](apps/lore-api/src/work/auth/login-handoffs.test.ts#L62), [returns null when the DELETE matched nothing @79a4d60e](apps/lore-api/src/work/auth/login-handoffs.test.ts#L78), [answers 400 for a state that was already used @07a0f3ee](apps/lore-api/src/transport/routes/auth/callback.test.ts#L127), [redeems a code once and answers 401 the second time @639e9826](apps/lore-api/src/transport/routes/auth/redeem.test.ts#L25), [answers 401 for a state code used as a redeem code @c4f6de07](apps/lore-api/src/transport/routes/auth/redeem.test.ts#L96))
- FR-9.4: `POST /api/auth/redeem` swaps a redeem code for the person's session
  token, which lasts eight hours. The token is a `user` token in
  `pipeline.api_tokens`: it carries the person's login, name, avatar and the
  repos they can open, and only its sha256 is stored, as for every token. ([validated by answers the session token and the person it belongs to @61182214](apps/lore-api/src/transport/routes/auth/redeem.test.ts#L46), [stores a user token that expires in eight hours with the person's repos @95cbf1de](apps/lore-api/src/transport/routes/auth/redeem.test.ts#L65), [stores the sha256 of the raw token it returns @6ae10147](apps/lore-api/src/work/tokens/mint-token.test.ts#L13), [stores a service token with no person on it @61b3c4bc](apps/lore-api/src/work/tokens/mint-token.test.ts#L34), [stores a user token with the person's login, name, avatar and repos @fdc64b75](apps/lore-api/src/work/tokens/mint-token.test.ts#L58), [returns the inserted row beside the raw token @0b2f3e20](apps/lore-api/src/work/tokens/mint-token.test.ts#L90), [revokes the live token with that hash @b35fbd32](apps/lore-api/src/work/tokens/mint-token.test.ts#L106), [adds the user token columns and kind check to pipeline.api_tokens @ecfb2ddb](apps/lore-api/src/migrations.test.ts#L83), [creates lore.login_handoffs for the one-time state and redeem codes @50486e49](apps/lore-api/src/migrations.test.ts#L96))
- FR-9.5: A bearer token resolves to the scopes it grants and, when it is a
  person's web session, to the person. The legacy ingest token and a service
  token speak for no person. ([validated by resolves the legacy ingest token to every scope and no person @0b54abdd](apps/lore-api/src/transport/http/resolve-principal.test.ts#L20), [resolves a user token to its scopes, the person and its hash @7d5620d7](apps/lore-api/src/transport/http/resolve-principal.test.ts#L26), [resolves a service token to its scopes and no person @c43a1189](apps/lore-api/src/transport/http/resolve-principal.test.ts#L54), [resolves no principal for a token that matches no active row @1b5306b4](apps/lore-api/src/transport/http/resolve-principal.test.ts#L68), [hands the route the person a user token belongs to @4656e1dc](apps/lore-api/src/transport/http/principal-of.test.ts#L37), [hands the route no person for the legacy token @7f6a12ce](apps/lore-api/src/transport/http/principal-of.test.ts#L64))
- FR-9.6: `GET /api/auth/me` answers the person behind a session token, and
  403 for any token that is not a person's session.
  `GET /api/auth/access?repo=` answers whether the token may open a repo: a
  person's session only the repos in the list from sign-in, whatever their
  case and whatever their scope, and a token that is no person's session every
  repo. `POST /api/auth/logout` revokes the session token at once and refuses
  a token that has no session to end. ([validated by answers the person behind a user token @311ac661](apps/lore-api/src/transport/routes/auth/session.test.ts#L16), [answers 403 for a token that is not a person's session @223375d4](apps/lore-api/src/transport/routes/auth/session.test.ts#L30), [answers allowed true for a repo in the person's list, whatever its case @ebaf7fc4](apps/lore-api/src/transport/routes/auth/session.test.ts#L47), [answers allowed false for a repo outside the person's list @1e2f1e42](apps/lore-api/src/transport/routes/auth/session.test.ts#L53), [answers allowed false for a repo outside the person's list even with the admin scope @4a056661](apps/lore-api/src/transport/routes/auth/session.test.ts#L59), [answers allowed true for a service token, which no person limits @0105c257](apps/lore-api/src/transport/routes/auth/session.test.ts#L65), [answers 400 when no repo is named @bf278341](apps/lore-api/src/transport/routes/auth/session.test.ts#L71), [revokes the session token by its hash @18707ef9](apps/lore-api/src/transport/routes/auth/session.test.ts#L79), [answers 400 for a token that has no session to end @65d41c85](apps/lore-api/src/transport/routes/auth/session.test.ts#L98), [allows a repo in the person's list, whatever its case @e1e1c9b8](apps/lore-api/src/work/auth/login-grant.test.ts#L89), [refuses a repo outside the person's list @a7ec15f7](apps/lore-api/src/work/auth/login-grant.test.ts#L93), [allows any repo to a token that is no person's session @c99d4aed](apps/lore-api/src/work/auth/login-grant.test.ts#L97))

- FR-9.7: The sign-in page offers one link, `/auth/start`, which sends the
  person to lore-api's `GET /api/auth/login`, told which page of the UI to
  return to. That page is built from the address the browser used, read from
  the ingress's forwarded protocol and host and never the pod's own; lore-api
  is reached at its public address, or at its API address when none is set.
  The page the person asked for before they were sent to sign in rides along
  and is where they land afterwards; only a path on this site qualifies, so an
  address elsewhere, a protocol-relative one and the sign-in's own pages fall
  back to the home page. ([validated by sends the person to lore-api's sign-in, told which page to come back to @b4d258b8](apps/web-ui/src/app/auth/start/route.test.ts#L26), [asks lore-api to bring the person back to the page they asked for @d67563e8](apps/web-ui/src/app/auth/start/route.test.ts#L35), [ignores a page on another site @9da239c2](apps/web-ui/src/app/auth/start/route.test.ts#L47), [answers 500 while no lore-api address is configured @86580dd9](apps/web-ui/src/app/auth/start/route.test.ts#L56), [rebuilds the public address from the proxy's forwarded headers @4133a6b5](apps/web-ui/src/lib/request-origin.test.ts#L7), [falls back to the host header over http when nothing is forwarded @b54e6791](apps/web-ui/src/lib/request-origin.test.ts#L19), [takes the first of several forwarded hosts, the one the client asked for @bf48061f](apps/web-ui/src/lib/request-origin.test.ts#L25), [prefers the public address when the in-cluster one differs @5bc5185d](apps/web-ui/src/lib/lore-api-public-url.test.ts#L5), [uses the API address when no public one is set, as on a laptop @2609f57d](apps/web-ui/src/lib/lore-api-public-url.test.ts#L14), [is undefined when neither is set @8504c7c1](apps/web-ui/src/lib/lore-api-public-url.test.ts#L20), [keeps a page of this site with its query @5b9fd1dc](apps/web-ui/src/lib/return-path.test.ts#L5), [falls back to the home page when no page was asked for @1bad3d81](apps/web-ui/src/lib/return-path.test.ts#L11), [falls back to the home page for %s](apps/web-ui/src/lib/return-path.test.ts#L15), [falls back to the home page for %s, which would loop through the sign-in @393f1227](apps/web-ui/src/lib/return-path.test.ts#L25), [carries the page that was asked for @0a86ab7e](apps/web-ui/src/lib/return-path.test.ts#L34), [carries nothing when the home page is all there is to return to @0109576d](apps/web-ui/src/lib/return-path.test.ts#L40))
- FR-9.8: The return trip, `GET /auth/callback`, swaps the code for the
  session token and keeps it in an `httpOnly` `lore_session` cookie that lives
  exactly as long as the token and is `Secure` on an https origin, then sends
  the person on to the page they asked for. A failed sign-in, a code that does
  not redeem and a callback with neither a code nor a reason end on the error
  page or a 400 that names why, and a reason the UI does not know reads as
  GitHub's refusal. The error page's retry link asks for the same page again. ([validated by keeps the session token in a cookie and sends the person home @5c298f1c](apps/web-ui/src/app/auth/callback/route.test.ts#L29), [sends the person on to the page they asked for @0f777ea2](apps/web-ui/src/app/auth/callback/route.test.ts#L44), [will not send the person to another site @bdae5480](apps/web-ui/src/app/auth/callback/route.test.ts#L52), [swaps the code lore-api sent back @fc0e3637](apps/web-ui/src/app/auth/callback/route.test.ts#L58), [leaves the cookie open to plain http for a local UI @3a7eae3e](apps/web-ui/src/app/auth/callback/route.test.ts#L64), [shows why a person outside the org was turned away @b7a61e33](apps/web-ui/src/app/auth/callback/route.test.ts#L70), [keeps the page they asked for on the error page of a failed sign-in @1f8c0ce0](apps/web-ui/src/app/auth/callback/route.test.ts#L82), [keeps the page they asked for when the code does not redeem @406d12ef](apps/web-ui/src/app/auth/callback/route.test.ts#L92), [tells the person to start again when the code does not redeem @90d796b2](apps/web-ui/src/app/auth/callback/route.test.ts#L101), [answers 400 to a callback with neither a code nor a reason @27a2db76](apps/web-ui/src/app/auth/callback/route.test.ts#L114), [redeems the code lore-api sent back @3ca6e744](apps/web-ui/src/lib/sign-in-callback.test.ts#L7), [reports the reason lore-api gave for a failed sign-in @67ea14b5](apps/web-ui/src/lib/sign-in-callback.test.ts#L14), [treats an unknown reason as a GitHub refusal @351293f9](apps/web-ui/src/lib/sign-in-callback.test.ts#L21), [rejects a callback that carries neither a code nor a reason @172cbd73](apps/web-ui/src/lib/sign-in-callback.test.ts#L28), [lets a failure reason win over a code @8ecdcbba](apps/web-ui/src/lib/sign-in-callback.test.ts#L32), [tells a person outside the org so @4db4d633](apps/web-ui/src/lib/sign-in-callback.test.ts#L41), [tells an expired sign-in to start again @bd45abfc](apps/web-ui/src/lib/sign-in-callback.test.ts#L47), [explains a GitHub refusal in general terms @665e1357](apps/web-ui/src/lib/sign-in-callback.test.ts#L53), [keeps the session token out of scripts, on this site only, until the token expires @bd98dc5f](apps/web-ui/src/lib/session-cookie-options.test.ts#L7), [allows the cookie over plain http for a local UI @51b0e955](apps/web-ui/src/lib/session-cookie-options.test.ts#L17), [names the cookie lore_session @64682274](apps/web-ui/src/lib/session-cookie-options.test.ts#L23))
- FR-9.9: Signing out posts to `/auth/signout`, which ends the session at
  lore-api, drops the cookie and returns to the sign-in page. ([validated by ends the session at lore-api, drops the cookie and returns to sign in @f0abb0ca](apps/web-ui/src/app/auth/signout/route.test.ts#L11))
- FR-9.10: Every call the UI makes to lore-api carries the signed-in person's
  session token, read from the cookie, and never a token of the deployment's
  own. lore-api's address and that token are resolved in one place, and a
  person without a session reaches lore-api with nothing. The question whether
  a person may open a repo has a deadline, so a hung lore-api cannot pin the
  proxy routes that ask it. ([validated by returns the URL and the person's session token when both are there @d152f7da](apps/web-ui/src/lib/lore-api-config.test.ts#L21), [returns null when LORE_API_URL is unset @05f22732](apps/web-ui/src/lib/lore-api-config.test.ts#L28), [returns null when there is no session @0ec267dd](apps/web-ui/src/lib/lore-api-config.test.ts#L34), [asks who the session token belongs to @c527482a](apps/web-ui/src/lib/api/auth.test.ts#L26), [asks whether the person may open a repo, naming it escaped @0c34a4d0](apps/web-ui/src/lib/api/auth.test.ts#L32), [gives the access question a deadline so a hung lore-api cannot pin the proxy routes @d48dc5e5](apps/web-ui/src/lib/api/auth.test.ts#L40), [swaps a code for a session token without sending any bearer @e13f7369](apps/web-ui/src/lib/api/auth.test.ts#L46), [ends the session with a post carrying the session token @851a7ca9](apps/web-ui/src/lib/api/auth.test.ts#L63))

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
