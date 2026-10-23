# Feature Specification: Inbox — everything waiting on a person

| Field    | Value                                         |
|----------|-----------------------------------------------|
| Feature  | Inbox                                         |
| Branch   | (unassigned)                                  |
| Status   | Draft                                         |
| Created  | 2026-10-20                                    |
| Owner    | Platform Engineering                          |

The Inbox is one cross-repo list of every item that is waiting on a person's
decision, and on nothing else: a plan to approve or refine, a spec pull request
to merge, an issue that triage parked for a human verdict, an onboarding pull
request nobody merged, and a run that failed and needs someone to choose
between retry and giving up. Each item says how long it has waited at the step
it waits on, opens where the decision is made, and can be acted on in place
where Lore already has the action. A person can mark an item handled or snooze
it, and that state is theirs alone. It is the "Inbox" screen of the Lore v2
design (Claude Design project "Lore v2", section INBOX).

## Problem Statement

Nothing in Lore answers "what is waiting on me?". The things that wait on a
person are spread over five places, and four of them can only be read one
repository at a time:

- Plans are listed per repo only: `GET /api/repos/{owner}/{repo}/plans`
  (`apps/lore-api/src/transport/routes/plans/plans.ts`) runs
  `listPlanMetas(db, repo)` (`apps/lore-api/src/outbound/plans/plan-store-pg.ts`),
  and the planning library's `/api/plans` routes have no list at all.
- Triage is per repo: `GET /api/repos/{owner}/{repo}/triage`
  (`apps/lore-api/src/transport/routes/triage/triage.ts`).
- Floor runs parked at a human station are visible only one run at a time:
  `GET /api/floor-runs` is cross-repo, but each pipeline node carries only
  `{node_id, state}` (`apps/lore-api/src/work/assembly-line-station/mini-pipeline.ts`),
  with no station kind and no time the run reached the station. The kind and
  the visit's `openedAt` exist only on `GET /api/assembly-runs/{id}/nodes`.
- Unmerged onboarding pull requests are known (`SettingsPort.pendingOnboardingRepos()`,
  `libs/shared/src/outbound/project/settings/settings-port.ts`) but served by
  no route.

A first attempt composed an inbox in the web tier from two pages of
`GET /api/floor-runs` (status `failed` and `running`). It was withdrawn
before merge (PR #2853) because it could not tell a person's move from a
build's (an open `await-ci` visit and an open `human-gate` visit look the
same), timed every wait from the run's start, silently dropped every run past
the first page, ignored plans, triage and onboarding entirely, and kept no
per-person state, so a handled item stayed on everyone's list forever.

## FR1 — One inbox read across every repository

lore-api serves `GET /api/inbox` (scope `read`). This change adds its route
folder, `apps/lore-api/src/transport/routes/inbox/`, registered in
`apps/lore-api/src/transport/route-list.ts` and categorized in
`apps/lore-api/src/transport/openapi/route-categories.ts`).

- FR1.1: The response is a page of items, newest wait last, with a cursor:
  `{items: InboxItem[], next_cursor: string | null}`, `limit` at most 100.
  Every source contributes to every page; no source is truncated to its own
  first page.
- FR1.2: An `InboxItem` carries `id` (stable per source object, e.g.
  `plan:<plan id>`, `visit:<floor visit id>`, `onboarding:<owner/repo>`,
  `run:<floor run id>`), `kind`, `repo`, `title`, `detail`, `waiting_since`
  (ISO time the item started waiting on a person), `open_url` (where the
  decision is made), `actions` (FR4) and `state` for the caller (FR3).
- FR1.3: `kind` is one of `plan_review`, `spec_pr`, `triage`, `onboarding_pr`,
  `failed_run`.
- FR1.4: The query takes `kind` (repeatable), `repo` (owner/name) and
  `include` (`snoozed`, `handled`) filters. By default handled and currently
  snoozed items are left out.
- FR1.5: The response also carries a count per kind for the caller, after the
  handled/snoozed default and before the `kind` filter, so the UI can label
  its chips.
- FR1.6: A source that cannot be read (the floor unreachable, GitHub refusing)
  does not fail the whole read: the response lists it in
  `unavailable: string[]` and serves the other sources.
- FR1.7: Every signed-in user sees the items of every onboarded repo; the
  inbox does not filter by the person's GitHub access, in line with "every
  member sees every item" under Out of Scope.

## FR2 — What waits on a person, and since when

Each kind has one source and one definition of "waiting since". Kinds are
decided by what the step waits on, never by a run being open.

- FR2.1 `plan_review`: a `draft` plan in `lore.plans` whose feature-planning
  run has an open `author` visit (`waiting_since` is that visit's `openedAt`),
  or a plan whose status is `in-review` (`waiting_since` is the plan's
  `updated_at`). This needs a cross-repo plan query; the store gains one
  beside `listPlanMetas`. `open_url` is `/repos/{owner}/{repo}/plans/{id}`.
- FR2.2 `spec_pr`: a feature-planning run with an open visit on its `merged`
  node (`spec-pr-merged` station). `waiting_since` is that visit's `openedAt`;
  `open_url` is resolved from the visit's `pr_url` need with `resolveRoute`
  (`apps/lore-api/src/work/floor/route-template.ts`).
- FR2.3 `triage`: an issue-triage run with an open visit on its `human-gate`
  node. `waiting_since` is the visit's `openedAt`; `open_url` is the run's
  `issue_url` start item, resolved with `resolveRoute` on `{args.issue_url}`.
- FR2.3a: `title` and `open_url` of a floor-backed item come from the run's
  start items and the visit's needs, which the reads in FR2.8 already return.
  Building an item makes no GitHub call.
- FR2.4 `onboarding_pr`: a repo with `onboarding_pr_url` set and
  `onboarding_pr_merged` false, read through
  `SettingsPort.pendingOnboardingRepos()`. `waiting_since` is the pull
  request's opening time when known, else when the URL was recorded.
- FR2.5 `failed_run`: a floor run whose outcome is `error` or `failed`
  (`FAILED_OUTCOMES` in `apps/lore-api/src/work/floor/floor-run-mapping.ts`
  also holds `cancelled`, which the inbox excludes: a person cancelled it),
  finished within the last 7 days, that no later run of the same `line_id`
  and `subject_key` has superseded. `waiting_since` is the run's `finishedAt`;
  `detail` is its `reason`. The node FR4.2 retries is the last visit that is
  not a terminal node (`!endsRun`) and whose report outcome is not `success`.
- FR2.6: A floor visit counts as waiting on a person only when its station's
  `kind` is `human` (the floor contract's `StationKind`) **and** the
  station is not answered by a sweep. The stations a sweep answers
  (`FLOOR_CI_WAIT_LINES`' `await-ci` and `await-pr`,
  `apps/stations/src/work/pr-ready-check/floor-ci-wait.ts`) are never inbox
  items, even though they are `human` stations. The rule lives in one shared
  predicate, so the run page and the inbox cannot disagree.
- FR2.7: The station kind is read from the station body the line version names
  (`readLineFacts`, `apps/lore-api/src/work/floor/floor-line-facts.ts`), not
  inferred from the node type. Today `factsOf` turns every `human` station
  that `produces` into `author` → `feature_review`, so an open `await-ci`
  (`loop-await-ci` produces `ci_feedback_sha`) is drawn as `running` rather
  than `waiting` on the run list. Fixing that
  classification is in scope, because FR2.6 depends on it.
- FR2.8: Reading the waiting visits must not cost one floor call per run per
  request. lore-api lists open runs of the lines that have person-waiting
  stations (`feature-planning`, `issue-triage`) with `runs.list({line,
  open: true})` and their open visits with `stationRuns.list({run, open:
  true})`, and caches the result briefly (seconds). If the floor contract
  offers a cross-run open-visit query, use it instead.

## FR3 — Per-person state: handled and snoozed

- FR3.1: State is kept per person and item in a new table
  `lore.inbox_item_state` (`person`, `item_id`, `handled_at`,
  `snoozed_until`, `updated_at`; primary key `(person, item_id)`), added by
  migration `0111_inbox_item_state.sql` (idempotent, `GRANT` to `lore`) in
  `infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/`,
  with its domain model (schema, type and `ColumnMap`, per the models
  convention) in a new file this change adds,
  `libs/shared/src/domain/models/inbox-item-state.ts`.
- FR3.2: `PUT /api/inbox/items/{item_id}/state` (scope `write`) sets
  `{handled: boolean}` or `{snoozed_until: ISO time | null}` for the caller.
- FR3.3: The caller is the signed-in person's GitHub login. The web tier
  passes it as it already passes identity for plans and runs (`approvedBy`,
  `requested_by`, from `planUserOf(session)`): as `person` in the request
  (query for the GET, body for the PUT). lore-api never takes a person from a
  request that carries only a `read`-scope token for the PUT.
- FR3.4: An item whose source object changes after it was marked handled
  comes back: a plan reopened, a run re-failed after a retry, a new visit on
  the same station. Handled state is keyed to the item's `id`, and a new
  visit or run is a new `id`.
- FR3.5: A snooze ends by itself at `snoozed_until`; the item returns with its
  original `waiting_since`.
- FR3.6: State rows for items that no longer exist are pruned after 30 days
  by the existing housekeeping sweep family
  (`libs/shared/src/work/housekeeping/`).

## FR4 — Acting from the inbox

An item lists only the actions Lore already serves for it; the inbox adds no
new way to change a run or a plan.

- FR4.1 `plan_review`: Approve (`POST /api/repos/{owner}/{repo}/plans/{id}/approve`,
  scope `write`) and Open plan. Refine stays on the plan page.
- FR4.2 `failed_run`: Retry — `POST /api/assembly-runs/{id}/nodes/{node}/run`
  (scope `task`) on the failed node, which the floor reopens — and Open run.
- FR4.3 `spec_pr`, `triage`, `onboarding_pr`: Open on GitHub only; the
  decision is made there and the stations sweep notices it.
- FR4.4: An action's outcome is reported on the item (accepted, refused with
  lore-api's reason). An accepted action marks the item handled for the
  caller.
- FR4.5: The plan lifecycle routes are registered outside `routeList`
  (`apps/lore-api/src/app/register-planning.ts`) and so are missing from
  `apps/lore-api/openapi.json`. The ones the inbox calls are added to the
  OpenAPI document so the web UI's generated types cover them.

## FR5 — The Inbox screen

- FR5.1: `/inbox` in the web UI, first link of the sidebar's top group
  (`apps/web-ui/src/app/SidebarNav.tsx`), with the count of open items as a
  badge.
- FR5.2: Filter chips per kind with their counts (FR1.5), a list ordered by
  `waiting_since` (longest wait first), and the selected item's detail beside
  the list on wide screens.
- FR5.3: Keyboard: `j`/`k` move the selection, `Enter` opens it, `e` marks it
  handled, `s` snoozes it until tomorrow 09:00 in the person's time zone.
  Keys typed into a field are left to the field.
- FR5.4: A "Handled this session" list holds what the person handled since
  the page loaded, each with Undo (FR3.2 with `handled: false`).
- FR5.5: An empty inbox says nothing is waiting. A source in `unavailable`
  is named on the page rather than hidden.
- FR5.6: The page reads through a typed client in `apps/web-ui/src/lib/api/`
  over the generated `schema.d.ts`, like every other page; it holds no data
  logic of its own.

## Success Criteria

- SC1 — A plan in review in any onboarded repo shows in every member's inbox
  within one minute, and leaves it when approved.
- SC2 — An implementation-loop run waiting at `await-ci` never appears; an
  issue-triage run at `human-gate` always does, with the time it reached the
  gate.
- SC3 — Marking an item handled removes it for that person only; another
  person still sees it.
- SC4 — With the floor unreachable, the inbox still lists plans and
  onboarding pull requests and names the floor as unavailable.
- SC5 — `GET /api/inbox` answers in under 500 ms at p95 for an org with 50
  repos and 200 open runs.

## Out of Scope

- Pending `dark-factory-approval` pull requests: nothing lists them today
  (`apps/lore-api/src/work/two-key/approval-pr.ts` checks one on demand), and
  finding them means a GitHub search per repo. A later item kind.
- Repos needing attention (missing or outdated workflows): computed in the web
  tier from GitHub files (`apps/web-ui/src/app/HomeView.tsx`); it is a
  repo health signal, not a decision waiting on a person.
- Notifications (Slack, email) for new inbox items.
- Cancelling a floor run from the inbox: lore-api has no route for it today.
- Assigning items to a person or a team; every member sees every item.
