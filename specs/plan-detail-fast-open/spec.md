# Feature Specification: A plan opens at once

| Field     | Value                                                            |
|-----------|------------------------------------------------------------------|
| Feature   | A plan opens at once                                             |
| Status    | Draft                                                            |
| Created   | 2026-11-04                                                       |
| Owner     | Platform Engineering                                             |
| Builds on | [specs/7-feature-planning](../7-feature-planning/spec.md)        |

Clicking a plan card on a repository's Plans tab can leave the list on screen for seconds, sometimes tens of seconds, before the plan opens. Nothing on the page shows the click was taken, so people click again.

There are two causes:

1. **No loading boundary.** The only `loading.tsx` near the plan page is the repository's (`apps/web-ui/src/app/repos/[owner]/[repo]/loading.tsx`). Next.js shows a loading boundary only when the segment directly under it changes. Going from `/plans` to `/plans/<id>` keeps that segment as `plans`, so Next keeps the old page on screen until the server render finishes.
2. **A slow server render.** `PlanDetailPage` waits for the plan, then for the planning run (`planRunFor`), which waits for the run list, then for the run's visits and the spec PR's status. Behind those calls, lore-api makes three floor round trips for the run list, one of them a cost read that sums every floor run in the org since the plan's oldest run (`apps/lore-api/src/work/floor/floor-costs.ts`). It makes about four floor calls for the visits, one of them twice. It makes at least four GitHub calls in sequence for the PR, starting with minting a new installation token on every call (`apps/lore-api/src/outbound/github-client.ts`). None of the web-ui calls has a deadline.

**Measured on 2026-11-04** with the plan `64e50ec3-2dfb-457a-ae4f-fd3859a7c227` of `re-cinq/Otto`, which has seven planning runs, from 2026-10-07 to 2026-10-12:

| Read | Time | Answer |
|---|---|---|
| `GET /api/plans/:id` | 0.46 s | 200 |
| `GET /api/assembly-runs?…&engine=lore` (Postgres only) | 0.47 s | 200 |
| `GET /api/assembly-runs?subject_key=plan:…&blueprint=feature-planning` | **30.5 s, twice** | **500** |
| `GET /api/assembly-lines/:id/nodes`, for each of three of its runs | 0.3–0.5 s | 200 |
| `GET /api/floor-runs?repo=re-cinq/Otto&line=feature-planning&limit=1` | 1.0 s | 200 |
| the same with `limit=2` | **28.4 s** | 200 |
| `GET /api/floor-runs?repo=re-cinq/Otto&line=code-review&limit=5` (recent runs) | 1.8 s | 200 |

The only difference between `limit=1` and `limit=2` is the cost read: one run is read as `{ run }`, two or more as `{ since: oldest }`. The floor's summary of every run since 2026-10-11 takes about 28 s. On `/api/floor-runs`, that failure is caught (`floor-run-rows.ts`), so it is only slow. On `/api/assembly-runs` it is not caught, so the call returns 500 after the floor client's 30 s timeout. web-ui's `readRuns` then reads the 500 as an empty list. So today this plan's page takes more than 30 s, then says "No planning run yet" and opens the editor for a run that is waiting at `author`. That is the very state SC-004 forbids.

This feature makes a click show its effect at once (FR1, FR2), renders the plan before its run arrives (FR3–FR5), and takes the waste out of the reads behind it (FR6–FR9).

## FR1: The plan page has its own loading skeleton

- `apps/web-ui/src/app/repos/[owner]/[repo]/plans/[id]/loading.tsx` renders a labeled status region (`role="status"`, `aria-label="Loading plan"`) of skeleton blocks shaped like the plan page: the header (a facts line, then the status badge and Delete button on the right), the run card, and the editor's outline beside its body.
- The skeleton is built from one shared component, `PlanDetailSkeleton`, whose parts (`header`, `run`, `body`) FR3 and FR5 reuse. The route skeleton and the in-page fallbacks therefore draw the same shapes, and the page doesn't jump when content replaces them.
- The route is added to `apps/web-ui/src/app/route-loading-skeletons.test.tsx`, beside the routes [specs/4-ux-repo-onboarding FR-7.8](../4-ux-repo-onboarding/spec.md) already covers.

## FR2: A clicked plan card says it is opening

- A plan card on the Plans tab shows a pending state from the click until the plan page (or its loading skeleton) replaces the list: the card shows a small spinner beside the status badge (`role="status"`, `aria-label="Opening plan"`), and the card dims.
- The pending state comes from Next's `useLinkStatus()`, read by a small client component rendered inside the card's `<Link>` in `PlanListView.tsx`, in the same way as the Loops tab's `LinkPending` and with the same global `chip-spinner` class. The list itself stays a server component. A child cannot set attributes on its `<Link>`, so the card dims through CSS (`.card:has([data-pending])`).
- Only the clicked card is pending. Clicking a second card moves the pending state to it.

## FR3: The plan renders before its run

- `PlanDetailPage` waits only for the plan (`readPlan`, which also decides the repository check and `notFound()`) and the session. It starts the planning run read and hands it down **unawaited**, as a promise, to the client view.
- The header's facts (type, version, author, approval), its status badge and its Delete button render at once. The run card and the body (the drafting notice, the sign-in notice, or the editor) render inside one `<Suspense>` boundary whose fallback is `PlanDetailSkeleton`'s `run` and `body` parts. They read the run with `use()`.
- The user-story link, and the story field shown when the run carries none, depend on the run. They render inside the suspended section as its first line, with no fallback of their own.
- The run, and so `usePlanRunLive`'s seed, is shared by everything inside the boundary. Nothing outside it reads the run.
- An action that ends in `router.refresh()` (Approve, Regenerate, Reopen, …) hands the page a new promise. Because `router.refresh()` runs in a transition, the boundary keeps showing the run it has until the new one resolves and never falls back to the skeleton again. A test asserts this.
- A run read that fails shows an error in place of the run card and body, with a Retry button that calls `router.refresh()`. It never shows the editor: reading a failure as "no run yet" would open the editor while a draft is still being written, and that draft would replace what the person types.

## FR4: The spec PR's facts arrive after the plan opens

- The render-time run read (`planRunFor` at render) reads the run and its visits only. The spec PR's title and unresolved thread count start as `null`, which the page already draws as the PR named by its number.
- Once the page is mounted, a run with a `prNumber` gets its PR facts through the existing `refreshRunFacts` server action, once. They merge in through the same path `usePlanRunLive` already uses after a node settles ([7-feature-planning](../7-feature-planning/spec.md), the plan page following its run).
- GitHub is therefore never on the path to the first paint of a plan.

## FR5: The editor's wait looks like the editor

- `PlanWorkspace`'s `loading` placeholder ("Opening the plan…") and `PlanEditorPanel`'s "Connecting…" are replaced by `PlanDetailSkeleton`'s `body` part, keeping a visually hidden text for screen readers.
- The editor's chunk (`PlanEditorPanel`, which pulls in BlockNote) starts downloading when the plan view mounts, while the run is still streaming, instead of when the body first renders after the run resolves.

## FR6: The run list asks the floor only for the runs it shows

- `costsByRunOf` reads the cost of each listed run with one `{ run }` filter per run, in parallel, when it lists at most 10 runs. A plan's planning runs are always that few.
- It keeps the single `{ since }` read for longer lists, such as the `/assembly-runs` page of 50 rows, where one org-wide read is cheaper than 50 per-run reads.
- A failed cost read leaves the run without a cost instead of failing the list. Today the failure is not caught, so a slow floor here becomes a 30-second wait and then a 500.

## FR7: lore-api reuses its GitHub installation token

- `getGitHubToken` creates its `createAppAuth` once per process, not on every call. `@octokit/auth-app` caches the installation token and renews it before it expires, so a PR-status read no longer starts with a token request to GitHub.
- The `GITHUB_TOKEN` fallback is unchanged.

## FR8: A run's visits are read once

- `FloorRunReader.listStationRuns` (`apps/lore-api/src/work/floor/floor-run-reader.ts`) lists the run's station runs once and passes the list to both places that need it. Today it fetches the same list twice in parallel.

## FR9: The plan page's reads have deadlines

- `fetchPlanRun`'s run-list read has a 15-second deadline. On a timeout or error it throws, so FR3's error state shows, rather than answering "no run".
- `fetchAssemblyRunNodes` has a 10-second deadline and keeps answering `[]` on failure, so the run card shows no visits.
- `fetchPrStatus` has a 10-second deadline and keeps answering `null` on failure, so the PR is named by its number.
- The deadlines use the `timeoutMs` option `apiFetch` already has (`apps/web-ui/src/lib/api/client.ts`).

## Success Criteria

- **SC-001:** After a click on a plan card, the card's pending state or the plan's loading skeleton is visible within 100 ms, on every click.
- **SC-002:** The plan's header renders without waiting for any floor or GitHub call. Measured in production, the time from click to header is the time of `GET /api/plans/:id` plus the session read, and under 1 s at p95.
- **SC-003:** The timings of `GET /api/assembly-runs?subject_key=plan:…`, `GET /api/assembly-lines/:id/nodes` and `GET /api/pr-status` are recorded for one plan with two or more runs before Phase 3 and again after it. The run-list read is faster, and the PR-status read makes one fewer GitHub call (no installation-token request).
- **SC-004:** No plan page opens its editor while its planning run is drafting, including when the run read fails or times out.

## Out of Scope

- **Minting the plan's collab token in parallel with the run read.** The token could be minted on the server and handed down as a second promise, but it only becomes useful once the editor chunk has loaded. FR5's early chunk download gets most of the gain for less change.
- **Throttling the `last_used` UPDATE that authenticates every lore-api request.** Parallel calls with one token queue on that row, but a page makes about five calls. Only revisit this if SC-003's measurements show it matters.
- **A deadline on the GraphQL review-thread read inside `pr-status`.** FR4 takes that read off the first paint, and FR9 bounds how long the page waits for it.
