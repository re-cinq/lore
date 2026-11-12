# Feature Specification: Autonomous Review Loop


> **Widened to all open PRs — the `code-review` assembly line ([ADR-012](../../adrs/ADR-012-autonomous-review-loop.md)).**
> The loop below closes on Lore's **own** implementation PRs. The `code-review` assembly
> line (`review → post-review → done` on the external floor, `libs/assembly-lines/src/floor-pipelines/code-review.yaml`, [ADR-049](../../adrs/ADR-049-external-floor.md))
> extends the same `auto_review` opt-in to **any open PR, including human-authored**, driven
> by PR-lifecycle webhooks on the event bus instead of the `pr-created` hook:
> - **PR opened / reopened / ready_for_review** → start a review pass + post a "review has
>   started" PR comment linking `${LORE_UI_URL}/assembly-runs/<id>`.
> - **Review pass** → the `review` node's findings are posted by the `post-review` station
>   as **line-level** inline comments in one review.
> - **A human's request-changes review** → a `code-review-reply` run that **decides per
>   comment**: commit and push a fix, or answer, each in the thread of the comment it answers
>   (`specs/external-floor` FR5.6).
> - **PR closed** → cancel any open code-review run for that PR.
>
> An assembly line runs once to completion, so "engaged as long as the PR is open" is the
> choreography re-invoking the line per webhook**, not one long-lived line. Bot-authored
> PRs (except Lore's own App login) and bot comments are skipped (loop guard). Handlers: `libs/shared/src/work/review/floor-review-start.ts`
> and `apps/stations/src/events/floor-review-handlers.ts`.

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | Autonomous Review Loop                   |
| Branch         | feat/auto-review-loop                    |
| Status         | In Progress                              |
| Created        | 2026-04-01                               |
| Owner          | Platform Engineering                     |
| Target         | 3-5 days                                 |

The Autonomous Review Loop closes the loop on agent-authored PRs: after an implementation PR is opened, a review agent clones the branch, checks it against the spec and conventions, posts inline comments, and either approves or requests changes for another iteration.

## Problem Statement

When an implementation task creates a PR via the external floor, the PR
sits waiting for a human developer to review. The agent did the work
but the loop is open — no one validates the output against the spec,
conventions, or code quality until a human gets to it.

## Solution: Close the Loop via Assembly Line

Every step runs on the external floor as an assembly line.
No in-process LLM calls in the agent.

```
                    ┌─────────────────────────────┐
                    │                             │
                    ▼                             │
Implementation → Assembly Line → PR created      │
                                        │        │
                                        ▼        │
                            auto_review enabled?  │
                              │           │       │
                             no          yes      │
                              │           │       │
                              ▼           ▼       │
                          hand to    Starts       │
                          human      review line  │
                                     (floor run)  │
                                        │         │
                                        ▼         │
                              Claude Code reviews  │
                              PR in cloned repo:   │
                              - reads spec         │
                              - reads diff         │
                              - checks conventions │
                              - posts PR comments  │
                              - writes APPROVED or │
                                CHANGES_REQUESTED  │
                                   to stdout       │
                                        │         │
                                   ┌────┴────┐    │
                                   │         │    │
                              approved  changes   │
                                   │    requested │
                                   ▼         │    │
                              mark task      │    │
                              reviewed       │    │
                              PR ready       │    │
                                        iteration < 2?
                                          │       │
                                         yes      no
                                          │       │
                                          │       ▼
                                          │   escalate to
                                          │   human review
                                          │
                                          └───────┘
                                    new implementation
                                    task with
                                    review feedback
```


These statements pin the `code-review` choreography (`libs/shared/src/work/review/floor-review-start.ts`)
and the webhook/verdict plumbing it rides on.

1. `autoReviewEnabled` gates every automatic start on the per-repo `auto_review` setting (an `@lore review` asked for by hand passes it, as the run page's button does): `true` only for
   the boolean `true`, `false` when the flag is absent, `false`, or the settings are null, and it
   parses a JSON-string settings blob. ([validated by `auto-review-enabled.test.ts@79259980`](libs/shared/src/domain/loops/auto-review-enabled.test.ts#L5), [`auto-review-enabled.test.ts@ca61abd4`](libs/shared/src/domain/loops/auto-review-enabled.test.ts#L9), [`auto-review-enabled.test.ts@e77e4009`](libs/shared/src/domain/loops/auto-review-enabled.test.ts#L15))

1a. **The code-review loop on the Loops tab** *(added 2026-10-23)*. Code review is the `review` entry of the loop registry (`libs/shared/src/domain/loops/loop-kinds.ts`, specs/implementation-loop FR7), with the top-level `auto_review` flag as its switch, so the repo's Loops tab (`/repos/{owner}/{repo}/loops?loop=review`) shows it beside the implementation loop and issue triage with the same pill and the same On/Off button; `PUT /api/repos/{owner}/{repo}/loops/review` flips the flag and the Settings tab no longer carries an auto-review switch. The page reads `GET /api/repos/{owner}/{repo}/code-review`, which lists the repo's open pull requests and the newest thirty runs of each review line (`code-review`, `code-review-recheck`, `code-review-reply`, read as the run list reads them through a `line` filter on the floor run pages, so each row carries its Stages); an open pull request none of those runs names is asked for by its review's subject, `pr_url:<url>`, so a review older than the window still places it *(amended 2026-10-27: on a busy repository the thirty newest reviews reach back a day, and every pull request reviewed before that read as unreviewed)* and answers the Loops tab's shared sections *(amended 2026-10-23; it answered Current, Open pull requests and Recently reviewed)*: **Current**, the pull requests a review run is working now; **Backlog**, open pull requests no review has looked at (`unreviewed`, or `draft` for a draft, which the gate skips); **Parked**, open pull requests whose newest review did not pass (changes requested, or the run failed); **Awaiting merge**, open pull requests whose newest review passed; **Recently addressed**, the newest ten settled runs, named by number when their pull request is no longer open. A repo that is not onboarded is a 404 before any GitHub read. ([validated by answers review from the top-level auto_review flag, off by default @b2658bfd](libs/shared/src/domain/loops/loop-enabled.test.ts#L37), [validated by lists implementation, review, merge, triage, upkeep, digest then tickets with their full names @d15715c2](libs/shared/src/domain/loops/loop-enabled.test.ts#L91), [validated by GET lists implementation, review, merge and digest off and triage, upkeep and tickets on for a repo with empty settings @edeff4cd](apps/lore-api/src/transport/routes/loops/loops.test.ts#L70), [validated by PUT review on writes the top-level auto_review flag @f38c8e8b](apps/lore-api/src/transport/routes/loops/loops.test.ts#L253), [validated by reads the open pull requests and thirty runs of each review line, and answers the queues @668285e9](apps/lore-api/src/transport/routes/code-review/code-review.test.ts#L67), [validated by answers 404 for a repo that is not onboarded without reading pull requests @3ae21882](apps/lore-api/src/transport/routes/code-review/code-review.test.ts#L141), [validated by puts #3449, reviewed before the thirty newest runs, under awaiting merge and keeps the never-reviewed #3279 in the backlog @5efb0370](apps/lore-api/src/transport/routes/code-review/code-review.test.ts#L121), [validated by parks open #8 whose newest review requested changes and open #9 whose review failed @3ac80e0d](apps/lore-api/src/transport/routes/code-review/review-queues.test.ts#L94), [validated by puts #7 with a running review under current and the unreviewed #8 and draft #9 in the backlog @e68d1ec5](apps/lore-api/src/transport/routes/code-review/review-queues.test.ts#L46), [validated by puts open #8 whose newest review passed under awaiting merge, and lists it under recent too @fd3f8706](apps/lore-api/src/transport/routes/code-review/review-queues.test.ts#L66), [validated by names a settled run's pull request from its number when it is no longer open, and keeps recent to ten @9d0cb5dc](apps/lore-api/src/transport/routes/code-review/review-queues.test.ts#L115), [validated by asks for the code-review runs of re-cinq/lore when the query names a line @f91e5007](apps/lore-api/src/transport/routes/floor/floor-runs.test.ts#L37), [validated by narrows a page to the code-review runs of github.com/re-cinq/lore, open ones for status running, one pull request's by subject @bb6ea4c7](apps/lore-api/src/work/floor/floor-run-query.test.ts#L120), [validated by ?loop=review shows the code-review switch and the board of code review alone @29868834](apps/web-ui/src/app/repos/[owner]/[repo]/loops/LoopsPage.test.tsx#L115), [validated by reads code review through its client and names it when lore-api answers HTTP 502 @a565aef0](apps/web-ui/src/app/repos/[owner]/[repo]/loops/board/read-loop.test.ts#L23), [validated by shows Parked and Awaiting merge only when a loop has a row there @65939989](apps/web-ui/src/app/repos/[owner]/[repo]/loops/board/board.test.ts#L107), [validated by says above the Backlog which shown loops are switched off, and what fills an empty backlog for each @9dedbeb0](apps/web-ui/src/app/repos/[owner]/[repo]/loops/board/board.test.ts#L153), [validated by reads /api/repos/re-cinq/lore/code-review from lore-api @1a888477](apps/web-ui/src/lib/api/code-review.test.ts#L22), [validated by draws a review row as its pull request, tagged with its review line, and a triage row as its issue with its label as the state @9b854598](apps/web-ui/src/app/repos/[owner]/[repo]/loops/board/board.test.ts#L168))

2. Bot loop guard: `isBotActor` is true only for `[bot]` logins; a bot-authored PR is skipped (except for Lore's own App login, which receives a review) and the bot's own comment or review never starts a pass. ([validated by starts nothing when the lore bot comments @lore review @e9774299](apps/stations/src/events/floor-review-handlers.test.ts#L159), [validated by starts no reply for a review the lore bot submitted @ba9bd0bc](libs/shared/src/work/review/floor-review-start.test.ts#L554))

3. On PR open/reopen/ready: the stations service starts a `code-review` run on the external floor only
   for an open, non-draft PR with auto-review on (an automatic start skips a draft; a review asked for by hand does not), and posts a started-comment linking the
   run page; it does nothing when auto-review is off. ([validated by starts code-review when a pull request opens in a repository with auto_review on @d7a570b7](apps/stations/src/events/floor-review-handlers.test.ts#L105), [validated by asks the floor nothing when auto_review is off @27926309](apps/stations/src/events/floor-review-handlers.test.ts#L113), [validated by announces run-new with a link to its run page @a76d18f4](libs/shared/src/work/review/floor-review-start.test.ts#L188), [validated by starts nothing for a draft pull request @b7f953c1](libs/shared/src/work/review/floor-review-start.test.ts#L206))

4. On a human review that requests changes: `startReply` starts a `code-review-reply` run carrying the
   review id and the `address` intent, only for a reviewer with write standing on an open, non-draft PR
   with auto-review on; an approval, a bot's review and a stranger's start nothing. ([validated by starts code-review-reply for review 99 with the repository, the pull request and the review, and no intent: the agent reads what each comment asks @9e2ce82e](libs/shared/src/work/review/floor-review-start.test.ts#L536), [validated by starts no reply for a review the lore bot submitted @ba9bd0bc](libs/shared/src/work/review/floor-review-start.test.ts#L554), [validated by starts code-review-reply for a MEMBER's request-changes review 99 @0cf497f4](apps/stations/src/events/floor-review-handlers.test.ts#L170), [validated by starts nothing for a request-changes review from a stranger with association NONE @54d52ff1](apps/stations/src/events/floor-review-handlers.test.ts#L185), [validated by starts nothing for an approving review @ebf675c3](apps/stations/src/events/floor-review-handlers.test.ts#L198))

5. On PR close: `closeReviewsForPr` cancels any open code-review run for that PR with reason `pr_closed`. ([validated by cancels the open runs of pull request 412 as pr_closed and leaves the finished one @0970d046](libs/shared/src/work/review/floor-review-start.test.ts#L582), [validated by cancels the open review of a closed pull request even with auto_review off @9fa36fa5](apps/stations/src/events/floor-review-handlers.test.ts#L211))

6. The GitHub webhook maps `pull_request.closed` to `github.pull_request.closed` carrying
   `merged`/`branch`/`merge_commit_sha`/`labels` — for both a merged and a closed-without-merge PR —
   so code-review can finish its line. ([validated by maps closed+merged to github.pull_request.closed carrying merged/branch/base_ref/sha/labels, and to github.tracker.changed under the delivery's utopia key @a1200b39](libs/shared/src/outbound/project/events/github-map.test.ts#L24), [`github-map.test.ts@e15c6e27`](libs/shared/src/outbound/project/events/github-map.test.ts#L62))

7. A human reply arrives as a created `pull_request_review_comment` mapped to
   `github.pull_request_review_comment.created` with author/id/body; a non-created review comment is
   ignored. ([validated by `github-map.test.ts@35a3a0a9`](libs/shared/src/outbound/project/events/github-map.test.ts#L231), [`github-map.test.ts@d852e2c0`](libs/shared/src/outbound/project/events/github-map.test.ts#L264), [`github-map.test.ts@10b14c4b`](libs/shared/src/outbound/project/events/github-map.test.ts#L297))

8. _(Retired 2026-10-01.)_ The Floor watcher no longer parses a review verdict from an agent's stdout: nothing acts on one since its fix loop was removed (#2328). A review node's verdict is still read by the station contract's `parseReviewVerdict`.



## Validated behavior — code-review line overhaul (2026-07)

The code-review assembly line is the sole reviewer (ADR-012 amendment): a **deep** first review on open / out-of-draft / first push, then a **fast `code-review-recheck`** on every later push (re-review on explicit `@lore review`); a comment starts a review only when it asks for one with `@lore review` (the Haiku triage station was removed on 2026-09-30); both reviews render structured findings as Conventional Comments and submit a **formal `APPROVE` / `REQUEST_CHANGES` verdict** (2026-08 amendment), the signal the dark-factory auto-merge gate reads; a fix is made only in answer to a request-changes review from a trusted reviewer; a completed `lore/code-review` check carries the verdict. Each behaviour below is pinned to its test.

### `apps/lore-api/src/transport/routes/floor/review-start.test.ts`

- starts a forced code-review for a draft pull request, since a click is forced past the gate. ([validated by starts code-review for draft pull request 412, since a click is forced past the gate @bec3be0d](apps/lore-api/src/transport/routes/floor/review-start.test.ts#L45))
- answers `{started: null}` and starts nothing for a closed pull request. ([validated by answers null and starts nothing for a closed pull request @b56ad6b4](apps/lore-api/src/transport/routes/floor/review-start.test.ts#L58))

### `apps/floor/src/work/assembly-run/pr-check.test.ts`

- returns null when the line carries no pr_number.
- returns null when the line carries no head_sha.
- maps a running line to an in_progress check named lore/<definition>.
- keeps a running line in_progress even when a node already recorded changes_requested.
- maps a changes_requested line outcome to a neutral conclusion.
- maps a completed line whose review node recorded changes_requested to a neutral conclusion — the walk routes `changes_requested → done`, so only the node walk row carries the verdict.
- reads the latest iteration of a node, so a re-reviewed success wins over an earlier changes_requested.
- maps a completed line to a success conclusion.
- maps a failed line to a failure conclusion.
- maps a failed line with a changes_requested node to a failure conclusion.
- maps a pr_closed outcome to a cancelled conclusion.
- maps a pr_closed line with a changes_requested node to a cancelled conclusion.
- adds a details_url to the Lore UI when a uiUrl is given.
- maps an iteration_max outcome to a failure conclusion.
- publishes a code-review-recheck line under the aliased `lore/code-review` check name so a required branch-protection check is refreshed on every push, not stranded under a separate name.

### `apps/floor/src/work/assembly-run/advance-line.test.ts`

- A code-review-recheck line opts out of the branch-overlap guard, so a push landing while a review or reply line still holds the PR branch is not silently dropped as `lease_held` (the verdict update always runs).

### `apps/floor/src/work/merge/auto-merge.test.ts`

- merges when all gates pass.
- deferred:dark_mode_off when not enabled (overrides everything).
- deferred:no_changes for an empty PR before path-allowlist check.
- deferred:review_in_flight while a code-review line is open.
- deferred:human_review when human changes requested.
- deferred:ci_failed when require_green_ci and CI red.
- deferred:bot_changes_requested when bot did not APPROVE.
- deferred:trust_too_low when repo has no trust set.
- reports CI status as failed when CI red.
- reports bot review as CHANGES_REQUESTED when not approved.

### `libs/shared/src/work/review/floor-review-start.test.ts` and `apps/stations/src/events/floor-review-handlers.test.ts`

- A bot's `@lore review` comment starts nothing (loop guard: `isBotActor` is true only for `[bot]` logins). ([validated by starts nothing when the lore bot comments @lore review @e9774299](apps/stations/src/events/floor-review-handlers.test.ts#L159))
- An `@lore review` comment from a person who may write to the repository starts a forced review, draft or not, whatever `auto_review` says, and a plain comment starts nothing. ([validated by starts a forced code-review when gedaiu comments @lore review on a draft pull request @133e230e](apps/stations/src/events/floor-review-handlers.test.ts#L133), [validated by starts a forced code-review when gedaiu comments @lore review @91c8083c](apps/stations/src/events/floor-review-handlers.test.ts#L121), [validated by starts nothing for a plain comment @c8ff2bb6](apps/stations/src/events/floor-review-handlers.test.ts#L147), [validated by starts a forced code-review when MEMBER gedaiu comments @lore review in a repository with auto_review off @28ab56e8](apps/stations/src/events/floor-review-handlers.test.ts#L222))
- An `@lore review` from someone GitHub gives no write standing (association `NONE`) starts nothing: a review spends the model budget, and a public repository takes comments from anyone. ([validated by starts nothing when a stranger with association NONE comments @lore review @a7559b83](apps/stations/src/events/floor-review-handlers.test.ts#L234))
- A comment event carries GitHub's `author_association` for its author as `comment_author_association`. ([validated by maps a PR issue_comment.created carrying the comment author, its MEMBER standing, id and body @11681bbe](libs/shared/src/outbound/project/events/github-map.test.ts#L191), [validated by maps a created pull_request_review_comment carrying the comment author, its NONE standing, id and body @35a3a0a9](libs/shared/src/outbound/project/events/github-map.test.ts#L231))
- A submitted review that requests changes starts a `code-review-reply` run with the review's id and no intent: the agent reads what each comment asks. ([validated by starts code-review-reply for review 99 with the repository, the pull request and the review, and no intent: the agent reads what each comment asks @9e2ce82e](libs/shared/src/work/review/floor-review-start.test.ts#L536), [validated by starts code-review-reply for a MEMBER's request-changes review 99 @0cf497f4](apps/stations/src/events/floor-review-handlers.test.ts#L170))
- A request-changes review from a stranger with no write standing, an approving review and a bot's own submitted review start nothing (loop guard). ([validated by starts nothing for a request-changes review from a stranger with association NONE @54d52ff1](apps/stations/src/events/floor-review-handlers.test.ts#L185), [validated by starts nothing for an approving review @ebf675c3](apps/stations/src/events/floor-review-handlers.test.ts#L198), [validated by starts no reply for a review the lore bot submitted @ba9bd0bc](libs/shared/src/work/review/floor-review-start.test.ts#L554))
- A push to a pull request no review has run on starts `code-review`, and a push to an already-reviewed one starts a `code-review-recheck` naming the sha the last verdict judged (the fast re-check replaces the old first-review-only skip), once CI is green on it *(amended 2026-10-26, #3601: until then a completed check suite starts it, `specs/external-floor` FR2.9b)*. Whether a review has run is read from the review line by the pull request's subject, and its re-checks and replies from their own lines, never from a window over every run of the repository: on a busy repository that window lost a review within hours, and a push to a reviewed pull request then started nothing *(amended 2026-10-24)*. ([validated by finds the code-review of #412 from yesterday morning though the repository's 200 newest runs are another line's @8c44669e](libs/shared/src/work/review/floor-review-runs.test.ts#L46), [validated by reads #412's re-checks and replies from their own lines, leaving another pull request's out @2e810a5f](libs/shared/src/work/review/floor-review-runs.test.ts#L54), [validated by starts code-review for a pull request no review has run on @7e10d821](libs/shared/src/work/review/floor-review-start.test.ts#L317), [validated by starts a re-check that names sha-old as the last judged commit @4db1f14e](libs/shared/src/work/review/floor-review-start.test.ts#L327))
- skips a draft PR when the start is automatic. ([validated by starts nothing for a draft pull request @b7f953c1](libs/shared/src/work/review/floor-review-start.test.ts#L206))
- The `read-review` station composes the review body with its inline comments into one feedback text. ([validated by joins body Please fix and inline comment 1 into one text @77ca5648](apps/stations/src/code-review/read-review/read-review.test.ts#L76), [validated by produces body plus inline comment 700 for review 55 on PR 412 of re-cinq/lore @9a94f95f](apps/stations/src/code-review/read-review/station.test.ts#L69))
- A review with neither body nor comments yields a fixed fallback sentence. ([validated by returns the fallback when body is blank and there are no inline comments @a2a3c5f4](apps/stations/src/code-review/read-review/read-review.test.ts#L82), [validated by produces the fallback text when review_id is empty @054075ce](apps/stations/src/code-review/read-review/station.test.ts#L102))
- Closing a pull request cancels the open review-family runs as `pr_closed`, whatever `auto_review` says. ([validated by cancels the open runs of pull request 412 as pr_closed and leaves the finished one @0970d046](libs/shared/src/work/review/floor-review-start.test.ts#L582), [validated by cancels the open review of a closed pull request even with auto_review off @9fa36fa5](apps/stations/src/events/floor-review-handlers.test.ts#L211))
- Starting a review on a pull request whose review is already open joins it, and a join announces nothing: `floor.lines.start` answers whether the run was joined, so the "Lore is reviewing this PR" comment is posted only when the run was actually started. Announcing unconditionally re-posted it, naming the very same run, on every `@lore review` and every press of the UI trigger while a review was open. ([validated by posts no announcement for a review it joined @5eca5c53](libs/shared/src/work/review/floor-review-start.test.ts#L198), [validated by announces run-new with a link to its run page @a76d18f4](libs/shared/src/work/review/floor-review-start.test.ts#L188))
- A review asked for by hand while an auto-merge run waits on the pull request starts and is announced, because `auto-merge` keys its runs on `merge_pr_url` and `code-review` alone holds `pr_url`. The floor holds one open run per repository and subject, whichever line it is on, so a shared subject would make the start join the auto-merge run, and a join announces nothing. ([validated by starts and announces code-review when MEMBER gedaiu comments @lore review @0982e7a1](apps/stations/src/events/floor-review-auto-merge.test.ts#L25), [validated by starts and announces code-review for pull request 412 while its auto-merge run waits @97ca49e2](apps/lore-api/src/transport/routes/floor/review-start-auto-merge.test.ts#L24), [validated by starts and announces a forced review of pull request 412 while its auto-merge run waits @269a5aa3](libs/assembly-lines/src/floor-pipelines/line-subjects.test.ts#L61))

### `apps/stations/src/code-review/post-review/post-review.test.ts`

- posts one REQUEST_CHANGES review (the formal verdict, always on) with a rendered comment per in-diff finding and a summary. ([validated by posts one REQUEST_CHANGES review with a rendered comment per commentable finding @03291bb6](apps/stations/src/code-review/post-review/post-review.test.ts#L94))
- partitions findings by diff hunk — a finding on a commentable line stays inline, one on an uninlineable line folds into overflow. ([validated by keeps findings on commentable lines inline and folds the rest into overflow @600df422](apps/stations/src/code-review/post-review/post-review.test.ts#L79))
- A finding on a line GitHub cannot inline (an unchanged line, or a file outside the diff) is folded into the review body, because one such inline comment 422s the whole atomic review. ([validated by folds the finding on line 99 into the body under the out-of-hunk heading and inlines only line 12 @e1930edd](apps/stations/src/code-review/post-review/post-review.test.ts#L135))
- When GitHub rejects the atomic review post, the findings are rendered in the body of the same verdict review, and when every review shape is refused the review is delivered as one plain comment rather than silently dropped. ([validated by keeps REQUEST_CHANGES and renders the finding in the body when GitHub rejects the inline comment @31a6ff79](apps/stations/src/code-review/post-review/post-review.test.ts#L157), [validated by posts one plain issue comment when every review shape is refused @a46344ba](apps/stations/src/code-review/post-review/post-review.test.ts#L195))
- posts when the output carries a REVIEW_FINDINGS block. ([validated by posts when the output carries a REVIEW_FINDINGS block @bfd544b2](apps/stations/src/code-review/post-review/post-review.test.ts#L270))
- A bare `REVIEW_RESULT:APPROVED` with no findings block posts a visible formal `APPROVE` review rather than staying silent. ([validated by posts a visible APPROVE review for a bare REVIEW_RESULT:APPROVED with no findings block @46441fd1](apps/stations/src/code-review/post-review/post-review.test.ts#L282))
- A `CHANGES_REQUESTED` verdict with no findings block posts nothing, and the `post-review` station then fails its visit. ([validated by posts nothing for CHANGES_REQUESTED without a findings block @c73498f6](apps/stations/src/code-review/post-review/post-review.test.ts#L294))
- The review node's findings are carried inside the Agent output envelope; `post-review` unwraps the NDJSON result envelope first, and every finding is then posted as a review comment. ([validated by reads the review out of an NDJSON result envelope @d74ac50f](apps/stations/src/code-review/post-review/station.test.ts#L174))
- Submits a formal `APPROVE` review carrying the inline findings when the verdict is approved. ([validated by submits an APPROVE review carrying the inline findings for an approved verdict @f23ff95d](apps/stations/src/code-review/post-review/post-review.test.ts#L250))
- Submits a formal `REQUEST_CHANGES` review carrying the inline findings when the verdict requests changes. ([validated by posts one REQUEST_CHANGES review with a rendered comment per commentable finding @03291bb6](apps/stations/src/code-review/post-review/post-review.test.ts#L94))

### `libs/shared/src/work/review/diff-hunks.test.ts`

- Added and context lines are commentable on the right (new) side. ([validated by @adb01c39](libs/shared/src/work/review/diff-hunks.test.ts#L25))
- Removed and context lines are commentable on the left (old) side. ([validated by @46174f2a](libs/shared/src/work/review/diff-hunks.test.ts#L36))
- A line inside a hunk is commentable. ([validated by @f711771e](libs/shared/src/work/review/diff-hunks.test.ts#L49))
- A line outside any hunk is not commentable. ([validated by @21141b82](libs/shared/src/work/review/diff-hunks.test.ts#L53))
- A file not in the diff is not commentable. ([validated by @0d7550b4](libs/shared/src/work/review/diff-hunks.test.ts#L57))
- A LEFT-side comment is checked against the left side, not the right. ([validated by @c29fdb98](libs/shared/src/work/review/diff-hunks.test.ts#L61))
- A file deleted in the diff (`+++ /dev/null`) is uncommentable on either side. ([validated by @cabfa129](libs/shared/src/work/review/diff-hunks.test.ts#L78))

### `apps/stations/src/code-review/post-review/station.test.ts` and `post-reply/`

- The `post-review` station posts a review agent's findings as one review against the pull request its `pr_url` names. ([validated by creates the review, upserts the neutral check and reports success with the summary and url @5a0850a1](apps/stations/src/code-review/post-review/station.test.ts#L124))
- A `pr_url` that is not a pull request fails the `post-review` visit. ([validated by throws when the pr_url is not a pull request @1f46baa6](apps/stations/src/code-review/post-review/station.test.ts#L229))
- A verdict that reaches no parseable findings fails the `post-review` visit rather than passing silently — that state is indistinguishable from a clean review at the PR. ([validated by posts nothing for CHANGES_REQUESTED without a findings block @c73498f6](apps/stations/src/code-review/post-review/post-review.test.ts#L294), [validated by throws when the output has no verdict @0e185464](apps/stations/src/code-review/post-review/station.test.ts#L219))
- A post that no route can deliver — every review shape and the plain comment refused — fails the `post-review` visit rather than being swallowed. ([validated by throws when every review shape and the plain comment are refused @604353d6](apps/stations/src/code-review/post-review/station.test.ts#L211))
- A code-review-refine node emits its reply as a fenced `REVIEW_REPLY` block (posting is handled by the `post-reply` station, not the agent) and its answers to the review's line comments as a `REVIEW_THREAD_REPLIES` block; the `post-reply` station posts each answer under the comment it names. ([validated by replies under comment 88 when the run carries review_id 99, the review that comment belongs to @ee355fa7](apps/stations/src/code-review/post-reply/station.test.ts#L76), [validated by replies under comments 88 and 89 of review 99 and resolves only T1, the thread of the reply marked resolved @2a8bafe6](apps/stations/src/code-review/post-reply/post-reply.test.ts#L137))
- A refine reply that answers no line comment is a plain PR comment. ([validated by comments on PR 412 and produces reply_url when the agent answered no line comment @280f6fd6](apps/stations/src/code-review/post-reply/station.test.ts#L56), [validated by comments on PR 412 with the stamped reply when the agent answered no line comment @61eb5e6c](apps/stations/src/code-review/post-reply/post-reply.test.ts#L122))
- A refine node that emits no reply block fails the `post-reply` visit rather than passing silently. ([validated by throws when the output has no REVIEW_REPLY block @86b592a2](apps/stations/src/code-review/post-reply/post-reply.test.ts#L320), [validated by rejects when the agent output has no REVIEW_REPLY block @dbcda3c9](apps/stations/src/code-review/post-reply/station.test.ts#L99))
- A `code-review-recheck` run's changes-requested verdict is posted by the same station as a formal `REQUEST_CHANGES` review. ([validated by posts one REQUEST_CHANGES review with a rendered comment per commentable finding @03291bb6](apps/stations/src/code-review/post-review/post-review.test.ts#L94), [validated by creates the review, upserts the neutral check and reports success with the summary and url @5a0850a1](apps/stations/src/code-review/post-review/station.test.ts#L124))
- A `code-review-recheck` run's approving verdict is posted by the same station as a formal `APPROVE` review. ([validated by submits an APPROVE review carrying the inline findings for an approved verdict @f23ff95d](apps/stations/src/code-review/post-review/post-review.test.ts#L250), [validated by posts a visible APPROVE review for a bare REVIEW_RESULT:APPROVED with no findings block @46441fd1](apps/stations/src/code-review/post-review/post-review.test.ts#L282))

### `libs/shared/src/outbound/project/events/github-map.test.ts`

- returns nothing when the repository is missing. ([validated by @f3d3c37e](libs/shared/src/outbound/project/events/github-map.test.ts#L515))
- returns nothing for an unhandled event type. ([validated by @8c2ea347](libs/shared/src/outbound/project/events/github-map.test.ts#L525))

### `apps/web-ui/src/app/assembly-runs/[id]/TriggerReviewButton.test.tsx`

- posts the repo and pr_number to the review-trigger proxy. ([validated by @e0de79d4](apps/web-ui/src/app/assembly-runs/[id]/TriggerReviewButton.test.tsx#L7))

### `libs/assembly-lines/src/loader.test.ts`

- code-review is a `review → post-review → done` graph with no refine node. ([validated by walks code-review from review through post-review to done, with no refine node @dd5fe29e](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L856))
- gap-fill is a linear flow with retrospective + done as exit pair.
- assemblyLinesDir actually exists on disk (sanity check).
- code-review-recheck is a Gemini 4 Argon `recheck → post-review → done` graph routing every verdict to `post-review`. ([validated by walks code-review-recheck through recheck, post-review and done on gemini-4-argon with edges for changes_requested, failed and success @1ff09a9f](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L895))

### `libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts`

- markRunning transitions the matching row to running with started_at. ([validated by @5b527dd8](libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts#L525))
- throws on unknown ids for markRunning and returns false for finishNodeOnce. ([validated by @aa97702e](libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts#L635))
- getById returns the record and null for unknown ids. ([validated by @791a41c9](libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts#L649))
- listForTask and getById pass through to the port. ([validated by @306da5ed](libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts#L823))
- ensureNodeStart enforces exactly one returned row (invariant names itself). ([validated by @6f7ff8cb](libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts#L998))
- finishNodeOnce CASes on a null outcome and reports whether it won. ([validated by @bfa6375b](libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts#L1010))
- listOpen selects queued and running rows oldest-first. ([validated by @529b0f7d](libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts#L1073))
- does not overwrite an already-terminal row (InMemory). ([validated by @f09d31f2](libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts#L1084))
- guards the Pg UPDATE on a non-terminal status. ([validated by @573ba86d](libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts#L1099))

### `libs/shared/src/outbound/project/issues/issues.test.ts`

- returns the GitHubPort issues for the project's repo. ([validated by @b52879bd](libs/shared/src/outbound/project/issues/issues.test.ts#L68))
- creates an issue bound to the repo. ([validated by @c1c72db5](libs/shared/src/outbound/project/issues/issues.test.ts#L112))
- comments, closes, and labels by number bound to the repo. ([validated by @ab836276](libs/shared/src/outbound/project/issues/issues.test.ts#L125))

### `libs/shared/src/outbound/project/lib/platform-github.test.ts`

- exposes the github port name. ([validated by @b48e7e88](libs/shared/src/outbound/project/lib/platform-github.test.ts#L249))
- createLabels swallows a 422 (already exists) and continues. ([validated by @42e7c22f](libs/shared/src/outbound/project/lib/platform-github.test.ts#L708))
- createLabels rethrows a non-422 error. ([validated by @4fa81056](libs/shared/src/outbound/project/lib/platform-github.test.ts#L715))
- createReview posts one review with the mapped comments array. ([validated by @f61b5225](libs/shared/src/outbound/project/lib/platform-github.test.ts#L722))
- get exposes the PR head sha as headSha. ([validated by @26a864e3](libs/shared/src/outbound/project/lib/platform-github.test.ts#L745))
- listReviewThreads maps GraphQL thread nodes (id, resolution, outdated flag, comment databaseIds) and stitches pages past the first cursor. ([validated by @6466a937](libs/shared/src/outbound/project/lib/platform-github.test.ts#L839))
- resolveReviewThread sends the GraphQL mutation carrying the thread node id. ([validated by @61dc5862](libs/shared/src/outbound/project/lib/platform-github.test.ts#L889))

### `libs/shared/src/outbound/project/pulls/pull-requests.test.ts`

- lists only the repo's pull requests. ([validated by @dd2a274a](libs/shared/src/outbound/project/pulls/pull-requests.test.ts#L121))
- merges by number with the requested method bound to the repo. ([validated by @b5fdf3b5](libs/shared/src/outbound/project/pulls/pull-requests.test.ts#L157))
- exposes PR reads bound to the repo and number. ([validated by @4a83fe6a](libs/shared/src/outbound/project/pulls/pull-requests.test.ts#L166))
- delegates listReviewThreads repo-bound and resolveReviewThread by node id. ([validated by @e212d0a7](libs/shared/src/outbound/project/pulls/pull-requests.test.ts#L185))

### `libs/shared/src/work/review/review-reply.test.ts`

- A fenced `REVIEW_REPLY` block yields its trimmed markdown body. ([validated by @85f2fe90](libs/shared/src/work/review/review-reply.test.ts#L8))
- Multi-line markdown inside the block is preserved. ([validated by @e0192d2e](libs/shared/src/work/review/review-reply.test.ts#L14))
- An absent reply block yields null, so a formatting slip posts nothing rather than crashing the node. ([validated by @43408cbc](libs/shared/src/work/review/review-reply.test.ts#L20))
- An empty reply block also yields null. ([validated by @a21f8e33](libs/shared/src/work/review/review-reply.test.ts#L24))

### `libs/shared/src/outbound/project/repo/repo-files.test.ts`

- reads a file from the repo at the given ref. ([validated by @e08d7a2c](libs/shared/src/outbound/project/repo/repo-files.test.ts#L60))
- returns null for a file the repo does not have. ([validated by @19fcda3d](libs/shared/src/outbound/project/repo/repo-files.test.ts#L72))
- creates a branch and commits a file via the API, repo bound. ([validated by @56bebb65](libs/shared/src/outbound/project/repo/repo-files.test.ts#L78))

### `libs/shared/src/work/review/conventional-comment.test.ts`

- renders label and subject as a bold header. ([validated by @00e433d9](libs/shared/src/work/review/conventional-comment.test.ts#L5))
- renders the decoration in parentheses after the label. ([validated by @a945e26e](libs/shared/src/work/review/conventional-comment.test.ts#L14))
- appends a suggestion block after the header. ([validated by @4f955a75](libs/shared/src/work/review/conventional-comment.test.ts#L26))
- renders discussion between the header and the suggestion. ([validated by @0a534923](libs/shared/src/work/review/conventional-comment.test.ts#L38))
- renders an empty suggestion block for a whole-line deletion. ([validated by @2ba41c6b](libs/shared/src/work/review/conventional-comment.test.ts#L51))

### `libs/shared/src/work/review/review-findings.test.ts`

- accepts the OTHER findings schema this repo defines — the `/code-review`
  skill's and `ReportFindings`' `file`/`category`/`short_summary`/`summary`/
  `failure_scenario` — because the reviewer reads this codebase and reliably
  emits that shape when reviewing it. Three PRs on 2026-09-01 (#1698, #1699,
  #1703) each produced a well-formed block of VALID JSON whose every finding
  failed the shape check, so the node reported the findings lost and a real
  `changes_requested` review reached nobody. `file` reads as `path`,
  `short_summary` as `subject`, and `summary` + `failure_scenario` carry into
  the discussion so nothing is dropped. A finding already written the recipe's
  way is untouched, a PRESENT-but-unknown label is still rejected (that
  strictness is the point), and a finding carrying neither spelling of a
  required field still yields null.
  ([validated by @2bfb49d4](libs/shared/src/work/review/review-findings.test.ts#L162), [validated by @09a3b970](libs/shared/src/work/review/review-findings.test.ts#L176), [validated by @35d6ea80](libs/shared/src/work/review/review-findings.test.ts#L184), [validated by @0365a4f8](libs/shared/src/work/review/review-findings.test.ts#L193), [validated by @2c1a6991](libs/shared/src/work/review/review-findings.test.ts#L211))
- A `decoration` the contract does not name — a model writing `"none"` for "no decoration", as Gemini did on the first review the external floor ran (HALEngine#123, 2026-09-30), which lost four findings to that one word — is dropped and its finding kept; a named decoration is kept as written. ([validated by keeps the finding and drops the decoration none @e59fce56](libs/shared/src/work/review/review-findings.test.ts#L292), [validated by keeps the decoration non-blocking as written @4cd04da3](libs/shared/src/work/review/review-findings.test.ts#L298))
- A finding written as one `message` — Gemini's shape on #2143's recheck
  (2026-09-23), which lost every finding and failed the run — reads its
  opening sentence as the `subject` (the whole first line when that sentence
  is too short to be one, and never empty) and the whole text as the
  discussion.
  ([validated by @3d9a192d](libs/shared/src/work/review/review-findings.test.ts#L222), [validated by @41460490](libs/shared/src/work/review/review-findings.test.ts#L252))
- *(added 2026-09-25)* A review reaches the PR as a review, posted by the `post-review` station and giving up as little as GitHub
  forces: the whole review with its inline comments first; then, for a line GitHub will
  take no comment on, the same APPROVE or REQUEST_CHANGES with every finding rendered in
  the body; then a COMMENT review naming the `lore/code-review` check as where its verdict
  went, which is the only review GitHub accepts on a pull request the reviewer opened; and
  only with all three refused, one plain comment, which never drops it.
  ([validated by posts one REQUEST_CHANGES review with a rendered comment per commentable finding @03291bb6](apps/stations/src/code-review/post-review/post-review.test.ts#L94), [validated by keeps REQUEST_CHANGES and renders the finding in the body when GitHub rejects the inline comment @31a6ff79](apps/stations/src/code-review/post-review/post-review.test.ts#L157), [validated by posts a COMMENT review when GitHub rejects an approval on the author's own pull request @d0d0d145](apps/stations/src/code-review/post-review/post-review.test.ts#L175), [validated by posts one plain issue comment when every review shape is refused @a46344ba](apps/stations/src/code-review/post-review/post-review.test.ts#L195))
- *(added 2026-09-25)* A push earns a re-check of its own unless one of two things is true:
  a review-family run is already in flight for that exact head sha, or every commit pushed
  since the last verdict tells CI to skip it, which is the `style: prettier [skip ci]` the
  format job pushes onto the branch. Neither refusal can lose a verdict, and a push while
  a DIFFERENT sha is in flight still gets its own pass. Three verdicts inside four minutes
  on one PR is what this ends.
  ([validated by starts no re-check while an open run is judging sha-new @62c267dc](libs/shared/src/work/review/floor-review-start.test.ts#L500), [validated by ignores a review of another pull request in the same repository @4fcc1142](libs/shared/src/work/review/floor-review-start.test.ts#L517))
- *(added 2026-09-25)* The re-check's brief names the sha the last verdict judged, so the
  pass reads the range since that sha rather than the whole pull request again; with no
  earlier verdict it reads `main...HEAD` as before. The sha and the range are resolved
  together, so a rebase that drops the judged commit names no sha at all rather than
  sending the pod to diff against history the branch no longer has.
  ([validated by starts a re-check that names sha-old as the last judged commit @4db1f14e](libs/shared/src/work/review/floor-review-start.test.ts#L327), [validated by reads the range since the sha the last verdict judged, rather than the whole PR again @47393c57](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1607))
- *(added 2026-09-25)* The re-check recipe carries the deep review's discipline at its own
  scope: context queried with the PR title and the surface the new commits change, the CI
  verdict read through `lore_get_ci_failures` rather than reasoned about or re-run, each
  diff read once in place, and a `question` when an added spec statement is not what a
  person using that surface would expect.
  ([validated by reads the range since the sha the last verdict judged, rather than the whole PR again @47393c57](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1607), [validated by carries the same CI-verdict and read-once rules as the deep review, so a re-check lints only to confirm a finding, never with --fix @cc234d58](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1617), [validated by queries context with the PR title and the surface the new commits change @75a8f8f3](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1628))
- *(added 2026-09-25)* A review asked for by hand supersedes the fast pass a push started:
  the open re-check is finished `superseded` before the deep review starts, so one sha
  never collects two verdicts of different depths. ([validated by cancels the open re-check as superseded when a review is forced @66df17bd](libs/shared/src/work/review/floor-review-start.test.ts#L295))
- Every recipe that asks for a `REVIEW_FINDINGS` block shows a whole finding
  (`path`, `line`, `label`, `decoration`, `subject`) rather than pointing at
  another recipe's schema, so no model has to guess the shape.
  ([validated by shows a whole finding with path, line, label, decoration and subject in code-review and code-review-recheck, so no model guesses the shape (#2143's recheck lost every finding) @c00e7141](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1646))
- *(added 2026-09-24)* The deep review reads the change as its user before it reads
  it as its reviewer: for every spec statement the PR adds or changes, one line on
  what a person using that surface sees differently, compared with the statements
  beside it and the page or route that renders it, and a mismatch is a `question`
  finding rather than silence — a spec written in the same PR as its code proves
  nothing about intent (the #2130 replay approved a fresh-run design twice).
  ([validated by asks, for every spec statement the PR adds or changes, what a person using that surface sees differently, and files a mismatch as a question rather than silence @bba4e8b4](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1556))
- Lint, types, formatting and tests are CI's verdict, read through
  `lore_get_ci_failures` first. *(amended 2026-10-26)* The review may lint the changed
  files, one package per call and never with `--fix`, to confirm a finding before it
  reports one; it runs no tsc, formatter, test runner or install other than the
  `npm ci` the linter needs. ([validated by names lint, types, formatting and tests as CI's verdict, read through lore_get_ci_failures first, and lets the review lint only to confirm a finding, never with --fix @89581539](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1566), [validated by lets the reviewers lint the changed files without --fix to confirm a finding, after reading CI's verdict @886f534f](libs/shared/src/outbound/project/agents/agent-defaults-content.test.ts#L1073))
- The diff is read once, in place, never dumped to a file and read back.
  ([validated by reads the diff once in place and never dumps it to a file to re-read @0a47da87](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1579))
- Context is queried with the PR title, the spec sections it touches and the surface
  it changes, never with a description of reviewing, which returns the platform
  overview. ([validated by queries context with the PR's subject, spec and surface, never with a description of reviewing @fd18b7ed](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1585))
- `changes_requested` is for a defect in the changed code or a mismatch between what
  the spec says and what a person would expect of its surface; a `question` alone
  never blocks. ([validated by reserves changes_requested for a defect in the changed code or a mismatch between the spec and what a person would expect, and says a question alone does not block @6a3c11b1](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1594))
- parses a valid findings block into a ReviewOutput. ([validated by @f328584f](libs/shared/src/work/review/review-findings.test.ts#L8))
- returns null when no findings block is present. ([validated by @eb291cfb](libs/shared/src/work/review/review-findings.test.ts#L42))
- returns null when the block is not valid JSON that a quote/newline repair
  pass can recover either. ([validated by @90962e04](libs/shared/src/work/review/review-findings.test.ts#L46))
- recovers a finding whose narrative field carries a quote the model forgot to
  escape — #1401 reproduced verbatim: a well-formed block with one broken
  string killed `JSON.parse` outright and discarded every finding, including
  the blocking one. A quote is read as closing the string only when the next
  non-whitespace character is one JSON allows there (`,` `}` `]` `:` or end of
  input); anything else is escaped instead, which a single regex cannot do
  because whether a `"` closes the string depends on what comes after it.
  ([validated by @c209a056](libs/shared/src/work/review/review-findings.test.ts#L50))
- recovers a finding whose narrative field carries a literal newline, escaping
  it the same way. ([validated by @eaebe033](libs/shared/src/work/review/review-findings.test.ts#L59))
- recovers a finding whose suggestion carries a literal tab the same way — a
  tabbed-indented code snippet is a raw control character JSON forbids
  unescaped in a string, exactly like a raw newline. ([validated by @3e9847e9](libs/shared/src/work/review/review-findings.test.ts#L68))
- recovers every finding when several each carry an unescaped quote, not just
  the first. ([validated by @48148ffd](libs/shared/src/work/review/review-findings.test.ts#L77))
- does not let the repair pass turn genuinely broken JSON into a false
  positive — missing quotes around a key or value stay unparseable. ([validated by @1f65277b](libs/shared/src/work/review/review-findings.test.ts#L90))
- returns null when a finding has an unknown label. ([validated by @dadb67a7](libs/shared/src/work/review/review-findings.test.ts#L96))
- returns null when the verdict is missing. ([validated by @8e362446](libs/shared/src/work/review/review-findings.test.ts#L107))
- treats an optional field written as `null` as absent, because that is what a
  model means by it — read as a value, ONE null failed its type check and the
  ENTIRE block was discarded, so a review that found ten things posted none and
  its node failed with the findings lost. ([validated by @72186a13](libs/shared/src/work/review/review-findings.test.ts#L124))
- keeps every other finding when one carries a null optional. ([validated by @dc8f8cb3](libs/shared/src/work/review/review-findings.test.ts#L130))
- still rejects a wrong TYPE in an optional field: this widens what counts as
  absent, not what counts as valid. ([validated by @1f4c5211](libs/shared/src/work/review/review-findings.test.ts#L138))

### `libs/shared/src/work/review/review-summary.test.ts`

- renders the Approved header and a zero tally for no findings. ([validated by @24cee48f](libs/shared/src/work/review/review-summary.test.ts#L10))
- counts blocking issues as must-fix, nits, and the rest as consider. ([validated by @1135b79b](libs/shared/src/work/review/review-summary.test.ts#L18))
- includes the agent summary line under the header when present. ([validated by @48ef32a8](libs/shared/src/work/review/review-summary.test.ts#L41))

### `apps/agent-image/agent-image.acceptance.test.ts`

- The agent image includes the GitHub CLI (`gh`) so review-mode entrypoints can post PR comments with `gh pr review`. ([validated by agent-image has gh CLI installed](apps/agent-image/agent-image.acceptance.test.ts#L5))
