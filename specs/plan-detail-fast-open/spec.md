# Feature Specification: A plan opens at once

| Field     | Value                                                            |
|-----------|------------------------------------------------------------------|
| Feature   | A plan opens at once                                             |
| Status    | In Progress                                                      |
| Created   | 2026-11-04                                                       |
| Owner     | Platform Engineering                                             |
| Builds on | [specs/7-feature-planning](../7-feature-planning/spec.md)        |

Clicking a plan card on a repository's Plans tab can leave the list on screen for seconds, sometimes tens of seconds, before the plan opens. Nothing on the page shows the click was taken, so people click again.

There are two causes:

1. **No loading boundary.** The only `loading.tsx` near the plan page is the repository's (`apps/web-ui/src/app/repos/[owner]/[repo]/loading.tsx`). Next.js shows a loading boundary only when the segment directly under it changes. Going from `/plans` to `/plans/<id>` keeps that segment as `plans`, so Next keeps the old page on screen until the server render finishes.
2. **A slow server render.** `PlanDetailPage` waits for the plan, then for the planning run (`planRunFor`), which waits for the run list, then for the run's visits and the spec PR's status. Behind those calls, lore-api makes three floor round trips for the run list, one of them a cost read that sums every floor run in the org since the plan's oldest run (`apps/lore-api/src/work/floor/floor-costs.ts`). It makes about four floor calls for the visits, one of them twice. It makes at least four GitHub calls in sequence for the PR, starting with minting a new installation token on every call (`apps/lore-api/src/outbound/github-client.ts`). None of the web-ui calls has a deadline.

**Measured on 2026-11-04** on a production plan with seven planning runs, from 2026-10-07 to 2026-10-12:

| Read | Time | Answer |
|---|---|---|
| `GET /api/plans/:id` | 0.46 s | 200 |
| `GET /api/assembly-runs?…&engine=lore` (Postgres only) | 0.47 s | 200 |
| `GET /api/assembly-runs?subject_key=plan:…&blueprint=feature-planning` | **30.5 s, twice** | **500** |
| `GET /api/assembly-lines/:id/nodes`, for each of three of its runs | 0.3–0.5 s | 200 |
| `GET /api/floor-runs?repo=<repo>&line=feature-planning&limit=1` | 1.0 s | 200 |
| the same with `limit=2` | **28.4 s** | 200 |
| `GET /api/floor-runs?repo=<repo>&line=code-review&limit=5` (recent runs) | 1.8 s | 200 |

The only difference between `limit=1` and `limit=2` is the cost read: one run is read as `{ run }`, two or more as `{ since: oldest }`. The floor's summary of every run since 2026-10-11 takes about 28 s. On `/api/floor-runs`, that failure is caught (`floor-run-rows.ts`), so it is only slow. On `/api/assembly-runs` it is not caught, so the call returns 500 after the floor client's 30 s timeout. web-ui's `readRuns` then reads the 500 as an empty list. So today this plan's page takes more than 30 s, then says "No planning run yet" and opens the editor for a run that is waiting at `author`. That is the very state SC-004 forbids.

This feature makes a click show its effect at once (FR1, FR2). It renders the plan from the smallest possible server read and lets everything else arrive over the tab's live socket ([ADR-048](../../adrs/ADR-048-one-websocket-for-live-channels.md)), drawing each part of the page as its data comes in (FR3–FR5, FR10). It also takes the waste out of the reads that remain (FR6–FR9).

The page already gets the plan document (the `plan` channel) and its run's status and visits (the `run` channel) over that socket. What it cannot get there is **which run belongs to the plan**, so today it finds that out on the server before it can render anything. FR4 adds a `plan-run` channel that answers this question, and the plan page then reads no run, visit or PR over HTTP at all.

## FR1: The plan page has its own loading skeleton

- `apps/web-ui/src/app/repos/[owner]/[repo]/plans/[id]/loading.tsx` renders a labeled status region (`role="status"`, `aria-label="Loading plan"`) of skeleton blocks in two parts shaped like the plan page (the shapes are layout, which jsdom does not apply, so T023 checks them by hand): the toolbar (the status badge and a facts line, then the run's text, the outlined "Open the run" link, the Regenerate plan button and the actions menu on the right), and the editor's body with its outline on the right (stacked, outline first, below 48rem, as the editor itself lays out). ([validated by draws the route skeleton from the toolbar and body parts, each hidden from assistive technology @1624915a](apps/web-ui/src/app/repos/[owner]/[repo]/plans/[id]/PlanDetailSkeleton.test.tsx#L18), [validated by renders a labeled status region of skeleton blocks for the %s route @6c76f1b9](apps/web-ui/src/app/route-loading-skeletons.test.tsx#L19))
- The skeleton is built from one shared component, `PlanDetailSkeleton`, whose parts (`toolbar`, `body`) FR5 reuses. The route skeleton and the in-page fallbacks therefore draw the same shapes, and the toolbar keeps its place when content replaces it. The body still changes shape once the page arrives until FR5 puts the body part where the editor shows its own text fallbacks ("Opening the plan…", "Connecting…"). ([validated by draws the route skeleton from the toolbar and body parts, each hidden from assistive technology @1624915a](apps/web-ui/src/app/repos/[owner]/[repo]/plans/[id]/PlanDetailSkeleton.test.tsx#L18))
- The route is added to `apps/web-ui/src/app/route-loading-skeletons.test.tsx`, beside the routes [specs/4-ux-repo-onboarding FR-7.8](../4-ux-repo-onboarding/spec.md) already covers. ([validated by renders a labeled status region of skeleton blocks for the %s route @6c76f1b9](apps/web-ui/src/app/route-loading-skeletons.test.tsx#L19))

## FR2: A clicked plan card says it is opening

- A plan card on the Plans tab shows a pending state from the click until the plan page (or its loading skeleton) replaces the list: the card shows a small spinner beside the status badge (`role="status"`, `aria-label="Opening plan"`), and the card dims (CSS, which jsdom does not apply; T023 checks the dimming by hand). ([validated by marks Faster checkout as Opening plan while its page loads @d1ce7ed9](apps/web-ui/src/app/repos/[owner]/[repo]/plans/PlanListView.test.tsx#L49), [validated by shows no Opening plan mark on a card nobody clicked @bd9cae6a](apps/web-ui/src/app/repos/[owner]/[repo]/plans/PlanListView.test.tsx#L58))
- The pending state comes from Next's `useLinkStatus()`, read by the shared `LinkPending` client component (`apps/web-ui/src/components/LinkPending.tsx`, which the Loops tab's pills also use) rendered inside the card's `<Link>` in `PlanListView.tsx`, with the global `chip-spinner` class. The list itself stays a server component. A child cannot set attributes on its `<Link>`, so the card dims through CSS (`.card:has([data-pending])`). ([validated by marks Faster checkout as Opening plan while its page loads @d1ce7ed9](apps/web-ui/src/app/repos/[owner]/[repo]/plans/PlanListView.test.tsx#L49))
- The mark is rendered inside each card's own `<Link>`, and `useLinkStatus()` reads the Link it sits in, so only the clicked card is pending; clicking a second card moves the pending state to it. ([validated by puts each card's Opening plan mark inside that card's own link @46cc0ff9](apps/web-ui/src/app/repos/[owner]/[repo]/plans/PlanListView.test.tsx#L64))

### Rationale

Once Next has prefetched the plan page down to its `loading.tsx`, a click shows the skeleton at once and Next skips the pending state, so the spinner is the feedback for a click made before that prefetch finishes (a card just scrolled into view, a slow network, or `next dev`). Either one meets SC-001.

## FR3: The server render reads the plan, the session and two tokens, nothing else

- `PlanDetailPage` reads the plan (`readPlan`, which also decides the repository check and `notFound()`) and the session. **It reads no run, visit or PR.** `planRunFor`, `fetchPlanRun` and `refreshPlanRunFactsAction` are no longer used by the plan page.
- Once the plan is known to belong to the repo, it mints, in parallel, the plan's collab token (as `openPlanSocketAction` does today) and a `plan-run` token (FR4). It hands both to the client, so the first connect needs no server-action round trip. A token is valid for ten minutes. A reconnect after that mints new ones through server actions, as the editor already does (`openSocket`).
- The toolbar's facts (type, version, author, approval), its status badge and its Delete plan action come from the plan, so they render in the first paint.
- An action that ends in `router.refresh()` (Approve, Reopen, …) re-renders only this small read, because the plan's status lives in the plan. The new tokens it brings are kept for the next reconnect. A changed token prop never closes and reopens a channel that is open.

## FR4: A `plan-run` channel follows the plan's current run (lore-api)

- The live socket's protocol (`apps/lore-api/src/work/assembly-line-station/protocol.ts`) gains an `open` of `kind: "plan-run"` whose `subject` is the plan id and whose `token` is a live token of kind `plan-run` for that plan. A migration widens `lore.live_tokens`' kind check to admit it, as `0100_live_tokens_runs_kind.sql` did for `runs`.
- `POST /api/repos/{owner}/{repo}/plans/{id}/run-stream-token` (scope `read`) mints the token. It answers 404 for a plan that doesn't belong to the repository and 403 for a person the repository is hidden from, using the same checks the run stream token uses.
- On open, the channel finds the plan's current run with the rule the page uses today: its open run, else its newest that was not cancelled, else its newest. That rule moves into `libs/shared` (`pickPlanRun`) so there is one copy of it. The lookup reads the run list **without cost enrichment**, so the floor's cost summary is never on this path.
- The channel sends a `plan_run` frame first: the run's id, status, outcome, reason, user-story issue (URL and number), spec PR (URL, number, title and unresolved thread count) and spec plan summary, or `run: null` when no run has started. It then joins that run's feed, and forwards its `run_status`, `node_status` and `task_event` frames on the same channel.
- A `plan-run` member of a feed gets **no agent events**: no replay on joining and none live. Today the plan page opens its run channel from cursor `0` and receives the whole transcript, only to throw it away. It also gets no `ci_check` frame. The feed reads the PR number from the run record it held when the viewer joined, so a spec PR opened later would never get one. The channel owns the PR facts instead (next item).
- The channel reads the run's facts again when a visit settles or the run's status changes, and sends a new `plan_run` frame when anything in it changed. The re-read happens at most once per 300 ms burst, as the page's own refresh of these facts does today. It reads the spec PR (`fetchPrStatus`) when the PR first appears and on every such re-read.
- **Switching runs.** When a run starts for the plan (Draft again, Refine, a spec pass), the channel leaves the old run's feed, sends a `plan_run` frame for the new run and joins the new feed. lore-api keeps **one** subscription to the floor-wide watch for every open `plan-run` channel (beside the one `floor-runs-feed.ts` keeps). It looks each started run up once and passes it only to the channels watching that run's plan.
- A failed lookup closes the channel with `closed` reason `server`. A token that doesn't verify closes it with `unauthorized`, a plan that is gone with `not_found`. The channel never sends `run: null` in place of a failure.

## FR5: The page draws itself as the frames arrive (web-ui)

- A new hook, `usePlanRunChannel(planId, token, mintToken)`, replaces `usePlanRunLive`'s server-rendered seed and its `refreshRunFacts` re-reads. It opens the `plan-run` channel on the tab's one socket and folds the frames: `plan_run` resets the run's facts (and its visits, when the run id changed), and `run_status` and `node_status` go through the existing `plan-run-live-reducer`. It answers `unknown` until the first `plan_run` frame arrives, then the run or `null`.
- While the run is `unknown`, the toolbar's run text and the body show placeholders, the body `PlanDetailSkeleton`'s `body` part. The toolbar's facts are already drawn (FR3). The user-story link, and the story field shown when the run carries none, appear with the first `plan_run` frame.
- `planPageState` is given the run only once it is known. **An unknown run never yields the editor**, and neither does a closed channel or an error. The editor only renders once the page knows no draft is being written.
- `PlanWorkspace`'s `loading` placeholder ("Opening the plan…") and `PlanEditorPanel`'s "Connecting…" become `PlanDetailSkeleton`'s `body` part, keeping a visually hidden text for screen readers.
- The editor's chunk (`PlanEditorPanel`, which pulls in BlockNote) starts downloading when the plan view mounts, while the channel is still opening, instead of when the body first renders.
- An action that starts a run no longer needs `router.refresh()` to show it: the channel switches runs by itself (FR4). The actions keep their refresh for the plan's own status (FR3).

## FR6: The run list asks the floor only for the runs it shows

- `costsByRunOf` reads the cost of each listed run with one `{ run }` filter per run, in parallel, when it lists at most 10 runs. A plan's planning runs are always that few. ([validated by reads 2 runs with one { run } read each @b3501d12](apps/lore-api/src/work/floor/floor-costs.test.ts#L38))
- It keeps the single `{ since }` read for longer lists, such as the `/assembly-runs` page of 50 rows, where one org-wide read is cheaper than 50 per-run reads. ([validated by reads 11 runs with one { since } read from the oldest @a7d886bb](apps/lore-api/src/work/floor/floor-costs.test.ts#L52))
- A failed cost read leaves the run without a cost instead of failing the list. Today the failure is not caught, so a slow floor here becomes a 30-second wait and then a 500. ([validated by drops only run-2's cost when its read fails, and warns once naming the floor error @32bc1b18](apps/lore-api/src/work/floor/floor-costs.test.ts#L68))

## FR7: lore-api reuses its GitHub installation token

- `getGitHubToken` creates its `createAppAuth` once per process, not on every call. `@octokit/auth-app` caches the installation token and renews it before it expires, so a PR-status read no longer starts with a token request to GitHub. ([validated by builds one App auth for two token reads @81eb2b3c](apps/lore-api/src/outbound/github-client-app-auth.test.ts#L35))
- The `GITHUB_TOKEN` fallback is unchanged. ([validated by answers GITHUB_TOKEN when the App auth fails, and asks the App again next time @2120b9d1](apps/lore-api/src/outbound/github-client-app-auth.test.ts#L43))

## FR8: A run's visits are read once

- `FloorRunReader.listStationRuns` (`apps/lore-api/src/work/floor/floor-run-reader.ts`) lists the run's station runs once and passes the list to both places that need it. Today it fetches the same list twice in parallel. ([validated by lists run-1's visits from the floor once @5b289d6a](apps/lore-api/src/work/floor/floor-run-reader-visits.test.ts#L149))

## FR9: The run has a deadline, and a failure says so

- If no `plan_run` frame arrives within 15 s of opening the channel, the page shows an error ("Couldn't load the planning run.") in place of the run card and body, with a Retry button that opens the channel again. The page shows the same error when the channel closes with `server`, `not_found` or `capacity`, and when the socket is not configured (`LORE_WS_URL`).
- A channel that closes with `unauthorized` mints a new token once (`mintToken`) and reopens. A second refusal shows the error.
- While the error shows, the editor is not rendered (SC-004).
- A channel that drops after its first frame keeps showing the run it has. It reopens through the socket's own reconnect (ADR-048's `connection-machine.ts`), and the `plan_run` frame it gets on reopening replaces what it showed.

## FR10: ADR-048 records the `plan-run` channel

- `adrs/ADR-048-one-websocket-for-live-channels.md` gains an amendment naming the `plan-run` kind: what its subject and token are, that it follows a plan's current run across runs, and that its members get no agent events and no `ci_check`.

## Success Criteria

- **SC-001:** After a click on a plan card, the card's pending state or the plan's loading skeleton is visible within 100 ms, on every click.
- **SC-002:** The plan's header renders without waiting for any floor or GitHub call. The server render of the plan page makes exactly four lore-api calls (plan, session, two tokens) and no floor or GitHub call. In production, the time from click to header is under 1 s at p95.
- **SC-003:** For the plan measured above, the run card is drawn within 3 s of the header, where today the page renders after more than 30 s with no run at all. The timings of `GET /api/assembly-runs?subject_key=plan:…` (still used by the run list pages) and `GET /api/pr-status` are recorded again after Phase 3. The run-list read is faster, and the PR-status read makes one fewer GitHub call (no installation-token request).
- **SC-004:** No plan page opens its editor while its planning run is drafting, including when the run is not known yet, when the channel fails, and when it times out.
- **SC-005:** Opening the plan page streams no agent events to the browser.

## Out of Scope

- **Delivering the plan's metadata (title, status, approval) over the socket.** It costs one fast Postgres read (0.46 s measured), decides the 404, and draws the header in the first paint, so it stays in the server render.
- **Moving other pages to socket-first rendering.** The run page and the run list keep their server reads. Once the `plan-run` channel has proven the pattern, it can be applied to them too.
- **Throttling the `last_used` UPDATE that authenticates every lore-api request.** Parallel calls with one token queue on that row, but the server render now makes four calls. Only revisit this if the SC-002 measurements show it matters.
- **A deadline on the GraphQL review-thread read inside `fetchPrStatus`.** The channel reads it off the first paint, and a slow read only delays the PR title.
