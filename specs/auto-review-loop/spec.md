# Feature Specification: Autonomous Review Loop

> **Execution substrate moved (ADR-031, `specs/floor-on-ai-subsystem/`).** The review-loop
> behavior is unchanged, but it now runs as `github_action` + agent nodes in the Floor-side
> workflow graph rather than chained `LoreTask` CRs — read the `LoreTask`-specific mechanics
> here in the past tense.

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
> **choreography re-invoking the line per webhook**, not one long-lived line. Bot-authored
> PRs and bot comments are skipped (loop guard). Handlers: `libs/shared/src/work/review/floor-review-start.ts`
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

When an implementation task creates a PR via the LoreTask CRD, the PR
sits waiting for a human developer to review. The agent did the work
but the loop is open — no one validates the output against the spec,
conventions, or code quality until a human gets to it.

## Solution: Close the Loop via CRD

Every step runs as an ephemeral Job pod via the LoreTask CRD.
No in-process LLM calls in the agent.

```
                    ┌─────────────────────────────┐
                    │                             │
                    ▼                             │
Implementation → LoreTask CR → Job → PR created  │
                                        │        │
                                        ▼        │
                            auto_review enabled?  │
                              │           │       │
                             no          yes      │
                              │           │       │
                              ▼           ▼       │
                          hand to    Watcher creates│
                          human      review LoreTask│
                                     CR (Job pod)  │
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
                                    LoreTask CR with
                                    review feedback
```

### How the Review Job Works

The review task runs as a LoreTask CR with `taskType: review`.
The claude-runner Job pod:

1. Clones the repo (same branch as the PR)
2. Claude Code reads the spec file, PR diff, CLAUDE.md, ADRs
3. Claude Code posts review comments on the PR via `gh` CLI or
   the GitHub API
4. Claude Code writes a structured result:
   - `REVIEW_APPROVED` — code meets spec and conventions
   - `REVIEW_CHANGES_REQUESTED: <feedback>` — specific issues found

The entrypoint.sh detects `taskType=review` and runs a different
flow: no commit/push, just review and output the result.

### Review Entrypoint Flow

```bash
if [ "$TASK_TYPE" = "review" ]; then
  # Clone the PR branch
  git clone ... && cd repo && git checkout $BRANCH_NAME
  
  # Run Claude Code to review
  claude --print --dangerously-skip-permissions --model $MODEL \
    -- "Review PR #$PR_NUMBER on this branch. Read the spec at 
        specs/... and check the changes against conventions in 
        CLAUDE.md and adrs/. Post review comments on the PR using 
        gh pr review. Output REVIEW_APPROVED or 
        REVIEW_CHANGES_REQUESTED: <feedback>"
  
  # No git add/commit/push — review doesn't change files
  # Exit code based on review result
fi
```

### What Changes

**1. claude-runner entrypoint.sh — review mode**

When `TASK_TYPE=review`, the entrypoint:
- Clones the PR branch (not main)
- Installs `gh` CLI for posting review comments
- Runs Claude Code with review prompt
- Captures stdout, looks for `REVIEW_APPROVED` or `REVIEW_CHANGES_REQUESTED`
- Writes result to a known file for the controller to read
- Does NOT commit/push (no file changes expected)
- Exits 0 on approved, exits 0 on changes-requested (both are valid outcomes)

**2. claude-runner Dockerfile — add gh CLI**

Add GitHub CLI to the runner image for posting PR reviews.

**3. loretask-watcher.ts — trigger review after PR creation**

After creating a PR for a Succeeded implementation task:
```typescript
if (shouldAutoReview(targetRepo)) {
  const reviewCR = {
    spec: {
      taskId: newReviewTaskId,
      taskType: "review",
      targetRepo,
      branch: lt.spec.branch,
      prompt: `Review PR #${pr.number}. Read specs/ for the feature spec. 
               Check changes against CLAUDE.md and adrs/. Post review 
               comments via gh pr review. Output REVIEW_APPROVED or 
               REVIEW_CHANGES_REQUESTED: <specific feedback>`,
      model: "claude-sonnet-4-6",
      timeoutMinutes: 10,
    },
  };
  // Create review pipeline task + LoreTask CR
}
```

**4. Controller — handle review task completion**

When a review LoreTask succeeds, the controller:
- Reads Job pod stdout for `REVIEW_APPROVED` or `REVIEW_CHANGES_REQUESTED`
- Sets LoreTask status with `reviewResult: "approved" | "changes-requested"`
- Sets `output` to the full review text

**5. loretask-watcher.ts — handle review results**

When a review LoreTask has phase=Succeeded:
- If `reviewResult === "approved"`:
  - Update parent implementation task: status=`review`, review_result=`approved`
  - Comment on GitHub Issue: "Agent review passed"
  - If `auto_merge` enabled: merge the PR
- If `reviewResult === "changes-requested"`:
  - Check iteration count on parent task
  - If < 2: create new implementation LoreTask CR with feedback as prompt context, same branch
  - If >= 2: escalate — add `needs-human-review` label, comment on Issue

**6. Auto-review configuration**

Per-repo setting in `lore.repos.settings` JSONB:
```json
{ "auto_review": true, "auto_merge": false }
```

- `auto_review: true` — create review LoreTask after implementation PR
- `auto_merge: true` — merge PR after agent approval (Phase 2)

Default: `auto_review: false` (opt-in).

**7. LoreTask CRD — add review fields to status**

```yaml
status:
  # existing fields...
  reviewResult: ""        # "approved" | "changes-requested" | ""
  parentTaskId: ""        # links review back to implementation task
```

**8. task-types.yaml — review uses CRD**

```yaml
review:
  prompt_template: |
    Review PR #{pr_number} on this branch. Check the code against:
    1. The spec in specs/ directory
    2. Conventions in CLAUDE.md and ADRs in adrs/
    3. Code quality, type safety, security
    
    Post specific review comments on the PR using gh pr review.
    Then output exactly one of:
    - REVIEW_APPROVED (if code meets all criteria)
    - REVIEW_CHANGES_REQUESTED: <specific actionable feedback>
    
    PR: {description}
  timeout_minutes: 10
  review_required: false
  execution_mode: claude-code
```

## File Changes

| File | Change |
|------|--------|
| `docker/claude-runner/Dockerfile` | Add `gh` CLI |
| `docker/claude-runner/entrypoint.sh` | Add review mode: no commit/push, capture result |
| `agent/src/jobs/loretask-watcher.ts` | Trigger review LoreTask after implementation PR |
| `agent/src/jobs/loretask-watcher.ts` | Handle review LoreTask completion (approve/iterate/escalate) |
| `agent/src/loretask-controller.ts` | Parse review result from Job logs |
| `terraform/modules/gke-mcp/loretask-crd/crd.yaml` | Add reviewResult, parentTaskId to status |
| `scripts/task-types.yaml` | Update review type with execution_mode: claude-code |

## Out of Scope

1. **Auto-merge** — Phase 2. PR stays open after approval.
2. **Multi-reviewer** — Single agent review, no consensus.
3. **Security review** — Separate specialized review type.
4. **Test execution** — CI handles tests, not the review agent.
5. **Partial approval** — All or nothing.

## Acceptance Criteria

1. Implementation PR → review LoreTask CR created automatically (when auto_review enabled)
2. Review Job pod clones repo, reads spec + diff, posts PR comments
3. Approved: parent task marked as `review/approved`. _(Retired 2026-10-02 with criteria 4 and 5: the review-result handler that recorded a verdict on the task and queued a follow-up task had no caller left and is deleted. The `code-review` line reviews every pull request and `code-review-reply` answers a request for changes on it; see `specs/external-floor`.)_
4. Changes requested (iteration < 2): new task with the feedback, same branch. _(Retired.)_
5. Changes requested (iteration >= 2): escalate with `needs-human-review` label. _(Retired.)_
6. Review completes in <5 min
7. Review result visible in pipeline UI
8. Auto-review is opt-in per repo
9. All steps run as ephemeral Job pods — no in-process LLM calls

## Code-review assembly line — validated behavior

These statements pin the `code-review` choreography (`libs/shared/src/work/review/floor-review-start.ts`)
and the webhook/verdict plumbing it rides on.

1. `autoReviewEnabled` gates every automatic start on the per-repo `auto_review` setting (an `@lore review` asked for by hand passes it, as the run page's button does): `true` only for
   the boolean `true`, `false` when the flag is absent, `false`, or the settings are null, and it
   parses a JSON-string settings blob. ([validated by `auto-review-enabled.test.ts:5`](libs/shared/src/work/review/auto-review-enabled.test.ts#L5), [`auto-review-enabled.test.ts:9`](libs/shared/src/work/review/auto-review-enabled.test.ts#L9), [`auto-review-enabled.test.ts:15`](libs/shared/src/work/review/auto-review-enabled.test.ts#L15))

2. Bot loop guard: `isBotActor` is true only for `[bot]` logins; a bot-authored PR is skipped (Lore
   never double-reviews its own PRs) and the bot's own comment or review never starts a pass. ([validated by starts nothing when the lore bot comments @lore review](apps/stations/src/events/floor-review-handlers.test.ts#L146), [validated by starts no reply for a review the lore bot submitted](libs/shared/src/work/review/floor-review-start.test.ts#L474))

3. On PR open/reopen/ready: the stations service starts a `code-review` run on the external floor only
   for an open, non-draft PR with auto-review on (an automatic start skips a draft; a review asked for by hand does not), and posts a started-comment linking the
   run page; it does nothing when auto-review is off. ([validated by starts code-review when a pull request opens in a repository with auto_review on](apps/stations/src/events/floor-review-handlers.test.ts#L92), [validated by asks the floor nothing when auto_review is off](apps/stations/src/events/floor-review-handlers.test.ts#L100), [validated by announces run-new with a link to its run page](libs/shared/src/work/review/floor-review-start.test.ts#L155), [validated by starts nothing for a draft pull request](libs/shared/src/work/review/floor-review-start.test.ts#L173))

4. On a human review that requests changes: `startReply` starts a `code-review-reply` run carrying the
   review id and the `address` intent, only for a reviewer with write standing on an open, non-draft PR
   with auto-review on; an approval, a bot's review and a stranger's start nothing. ([validated by starts code-review-reply for review 99 with the repository, the pull request and the review, and no intent: the agent reads what each comment asks](libs/shared/src/work/review/floor-review-start.test.ts#L456), [validated by starts no reply for a review the lore bot submitted](libs/shared/src/work/review/floor-review-start.test.ts#L474), [validated by starts code-review-reply for a MEMBER's request-changes review 99](apps/stations/src/events/floor-review-handlers.test.ts#L157), [validated by starts nothing for a request-changes review from a stranger with association NONE](apps/stations/src/events/floor-review-handlers.test.ts#L172), [validated by starts nothing for an approving review](apps/stations/src/events/floor-review-handlers.test.ts#L185))

5. On PR close: `closeReviewsForPr` cancels any open code-review run for that PR with reason `pr_closed`. ([validated by cancels the open runs of pull request 412 as pr_closed and leaves the finished one](libs/shared/src/work/review/floor-review-start.test.ts#L502), [validated by cancels the open review of a closed pull request even with auto_review off](apps/stations/src/events/floor-review-handlers.test.ts#L198))

6. The GitHub webhook maps `pull_request.closed` to `github.pull_request.closed` carrying
   `merged`/`branch`/`merge_commit_sha`/`labels` — for both a merged and a closed-without-merge PR —
   so code-review can finish its line. ([validated by maps closed+merged to github.pull_request.closed carrying merged/branch/base_ref/sha/labels](libs/shared/src/outbound/project/events/github-map.test.ts#L24), [`github-map.test.ts:54`](libs/shared/src/outbound/project/events/github-map.test.ts#L56))

7. A human reply arrives as a created `pull_request_review_comment` mapped to
   `github.pull_request_review_comment.created` with author/id/body; a non-created review comment is
   ignored. ([validated by `github-map.test.ts:199`](libs/shared/src/outbound/project/events/github-map.test.ts#L199), [`github-map.test.ts:214`](libs/shared/src/outbound/project/events/github-map.test.ts#L232), [`github-map.test.ts:246`](libs/shared/src/outbound/project/events/github-map.test.ts#L265))

8. _(Retired 2026-10-01.)_ The Floor watcher no longer parses a review verdict from an agent's stdout: nothing acts on one since its fix loop was removed (#2328). A review node's verdict is still read by the station contract's `parseReviewVerdict`.



## Validated behavior — code-review line overhaul (2026-07)

The code-review assembly line is the sole reviewer (ADR-012 amendment): a **deep** first review on open / out-of-draft / first push, then a **fast `code-review-recheck`** on every later push (re-review on explicit `@lore review`); a comment starts a review only when it asks for one with `@lore review` (the Haiku triage station was removed on 2026-09-30); both reviews render structured findings as Conventional Comments and submit a **formal `APPROVE` / `REQUEST_CHANGES` verdict** (2026-08 amendment), the signal the dark-factory auto-merge gate reads; a fix is made only in answer to a request-changes review from a trusted reviewer; a completed `lore/code-review` check carries the verdict. Each behaviour below is pinned to its test.

### `apps/lore-api/src/transport/routes/floor/review-start.test.ts`

- starts a forced code-review for a draft pull request, since a click is forced past the gate. ([validated by starts code-review for draft pull request 412, since a click is forced past the gate](apps/lore-api/src/transport/routes/floor/review-start.test.ts#L39))
- answers `{started: null}` and starts nothing for a closed pull request. ([validated by answers null and starts nothing for a closed pull request](apps/lore-api/src/transport/routes/floor/review-start.test.ts#L52))

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

- A bot's `@lore review` comment starts nothing (loop guard: `isBotActor` is true only for `[bot]` logins). ([validated by starts nothing when the lore bot comments @lore review](apps/stations/src/events/floor-review-handlers.test.ts#L146))
- An `@lore review` comment from a person who may write to the repository starts a forced review, draft or not, whatever `auto_review` says, and a plain comment starts nothing. ([validated by starts a forced code-review when gedaiu comments @lore review on a draft pull request](apps/stations/src/events/floor-review-handlers.test.ts#L120), [validated by starts a forced code-review when gedaiu comments @lore review](apps/stations/src/events/floor-review-handlers.test.ts#L108), [validated by starts nothing for a plain comment](apps/stations/src/events/floor-review-handlers.test.ts#L134), [validated by starts a forced code-review when MEMBER gedaiu comments @lore review in a repository with auto_review off](apps/stations/src/events/floor-review-handlers.test.ts#L209))
- An `@lore review` from someone GitHub gives no write standing (association `NONE`) starts nothing: a review spends the model budget, and a public repository takes comments from anyone. ([validated by starts nothing when a stranger with association NONE comments @lore review](apps/stations/src/events/floor-review-handlers.test.ts#L221))
- A comment event carries GitHub's `author_association` for its author as `comment_author_association`. ([validated by maps a PR issue_comment.created carrying the comment author, its MEMBER standing, id and body](libs/shared/src/outbound/project/events/github-map.test.ts#L159), [validated by maps a created pull_request_review_comment carrying the comment author, its NONE standing, id and body](libs/shared/src/outbound/project/events/github-map.test.ts#L199))
- A submitted review that requests changes starts a `code-review-reply` run with the review's id and no intent: the agent reads what each comment asks. ([validated by starts code-review-reply for review 99 with the repository, the pull request and the review, and no intent: the agent reads what each comment asks](libs/shared/src/work/review/floor-review-start.test.ts#L456), [validated by starts code-review-reply for a MEMBER's request-changes review 99](apps/stations/src/events/floor-review-handlers.test.ts#L157))
- A request-changes review from a stranger with no write standing, an approving review and a bot's own submitted review start nothing (loop guard). ([validated by starts nothing for a request-changes review from a stranger with association NONE](apps/stations/src/events/floor-review-handlers.test.ts#L172), [validated by starts nothing for an approving review](apps/stations/src/events/floor-review-handlers.test.ts#L185), [validated by starts no reply for a review the lore bot submitted](libs/shared/src/work/review/floor-review-start.test.ts#L474))
- A push to a pull request no review has run on starts `code-review`, and a push to an already-reviewed one starts a `code-review-recheck` naming the sha the last verdict judged (the fast re-check replaces the old first-review-only skip). ([validated by starts code-review for a pull request no review has run on](libs/shared/src/work/review/floor-review-start.test.ts#L284), [validated by starts a re-check that names sha-old as the last judged commit](libs/shared/src/work/review/floor-review-start.test.ts#L294))
- skips a draft PR when the start is automatic. ([validated by starts nothing for a draft pull request](libs/shared/src/work/review/floor-review-start.test.ts#L173))
- The `read-review` station composes the review body with its inline comments into one feedback text. ([validated by joins body Please fix and inline comment 1 into one text](apps/stations/src/code-review/read-review/read-review.test.ts#L76), [validated by produces body plus inline comment 700 for review 55 on PR 412 of re-cinq/lore](apps/stations/src/code-review/read-review/station.test.ts#L69))
- A review with neither body nor comments yields a fixed fallback sentence. ([validated by returns the fallback when body is blank and there are no inline comments](apps/stations/src/code-review/read-review/read-review.test.ts#L82), [validated by produces the fallback text when review_id is empty](apps/stations/src/code-review/read-review/station.test.ts#L102))
- Closing a pull request cancels the open review-family runs as `pr_closed`, whatever `auto_review` says. ([validated by cancels the open runs of pull request 412 as pr_closed and leaves the finished one](libs/shared/src/work/review/floor-review-start.test.ts#L502), [validated by cancels the open review of a closed pull request even with auto_review off](apps/stations/src/events/floor-review-handlers.test.ts#L198))
- Starting a review on a pull request whose review is already open joins it, and a join announces nothing: `floor.lines.start` answers whether the run was joined, so the "Lore is reviewing this PR" comment is posted only when the run was actually started. Announcing unconditionally re-posted it, naming the very same run, on every `@lore review` and every press of the UI trigger while a review was open. ([validated by posts no announcement for a review it joined](libs/shared/src/work/review/floor-review-start.test.ts#L165), [validated by announces run-new with a link to its run page](libs/shared/src/work/review/floor-review-start.test.ts#L155))

### `apps/stations/src/code-review/post-review/post-review.test.ts`

- posts one REQUEST_CHANGES review (the formal verdict, always on) with a rendered comment per in-diff finding and a summary. ([validated by posts one REQUEST_CHANGES review with a rendered comment per commentable finding](apps/stations/src/code-review/post-review/post-review.test.ts#L94))
- partitions findings by diff hunk — a finding on a commentable line stays inline, one on an uninlineable line folds into overflow. ([validated by keeps findings on commentable lines inline and folds the rest into overflow](apps/stations/src/code-review/post-review/post-review.test.ts#L79))
- A finding on a line GitHub cannot inline (an unchanged line, or a file outside the diff) is folded into the review body, because one such inline comment 422s the whole atomic review. ([validated by folds the finding on line 99 into the body under the out-of-hunk heading and inlines only line 12](apps/stations/src/code-review/post-review/post-review.test.ts#L135))
- When GitHub rejects the atomic review post, the findings are rendered in the body of the same verdict review, and when every review shape is refused the review is delivered as one plain comment rather than silently dropped. ([validated by keeps REQUEST_CHANGES and renders the finding in the body when GitHub rejects the inline comment](apps/stations/src/code-review/post-review/post-review.test.ts#L157), [validated by posts one plain issue comment when every review shape is refused](apps/stations/src/code-review/post-review/post-review.test.ts#L195))
- posts when the output carries a REVIEW_FINDINGS block. ([validated by posts when the output carries a REVIEW_FINDINGS block](apps/stations/src/code-review/post-review/post-review.test.ts#L270))
- A bare `REVIEW_RESULT:APPROVED` with no findings block posts a visible formal `APPROVE` review rather than staying silent. ([validated by posts a visible APPROVE review for a bare REVIEW_RESULT:APPROVED with no findings block](apps/stations/src/code-review/post-review/post-review.test.ts#L282))
- A `CHANGES_REQUESTED` verdict with no findings block posts nothing, and the `post-review` station then fails its visit. ([validated by posts nothing for CHANGES_REQUESTED without a findings block](apps/stations/src/code-review/post-review/post-review.test.ts#L294))
- The review node's findings are carried inside the Agent output envelope; `post-review` unwraps the NDJSON result envelope first, and every finding is then posted as a review comment. ([validated by reads the review out of an NDJSON result envelope](apps/stations/src/code-review/post-review/station.test.ts#L122))
- Submits a formal `APPROVE` review carrying the inline findings when the verdict is approved. ([validated by submits an APPROVE review carrying the inline findings for an approved verdict](apps/stations/src/code-review/post-review/post-review.test.ts#L250))
- Submits a formal `REQUEST_CHANGES` review carrying the inline findings when the verdict requests changes. ([validated by posts one REQUEST_CHANGES review with a rendered comment per commentable finding](apps/stations/src/code-review/post-review/post-review.test.ts#L94))

### `libs/shared/src/work/review/diff-hunks.test.ts`

- Added and context lines are commentable on the right (new) side. ([validated by](libs/shared/src/work/review/diff-hunks.test.ts#L25))
- Removed and context lines are commentable on the left (old) side. ([validated by](libs/shared/src/work/review/diff-hunks.test.ts#L36))
- A line inside a hunk is commentable. ([validated by](libs/shared/src/work/review/diff-hunks.test.ts#L49))
- A line outside any hunk is not commentable. ([validated by](libs/shared/src/work/review/diff-hunks.test.ts#L53))
- A file not in the diff is not commentable. ([validated by](libs/shared/src/work/review/diff-hunks.test.ts#L57))
- A LEFT-side comment is checked against the left side, not the right. ([validated by](libs/shared/src/work/review/diff-hunks.test.ts#L61))
- A file deleted in the diff (`+++ /dev/null`) is uncommentable on either side. ([validated by](libs/shared/src/work/review/diff-hunks.test.ts#L78))

### `apps/stations/src/code-review/post-review/station.test.ts` and `post-reply/`

- The `post-review` station posts a review agent's findings as one review against the pull request its `pr_url` names. ([validated by creates the review, upserts the neutral check and reports success with the summary and url](apps/stations/src/code-review/post-review/station.test.ts#L72))
- A `pr_url` that is not a pull request fails the `post-review` visit. ([validated by throws when the pr_url is not a pull request](apps/stations/src/code-review/post-review/station.test.ts#L177))
- A verdict that reaches no parseable findings fails the `post-review` visit rather than passing silently — that state is indistinguishable from a clean review at the PR. ([validated by posts nothing for CHANGES_REQUESTED without a findings block](apps/stations/src/code-review/post-review/post-review.test.ts#L294), [validated by throws when the output has no verdict](apps/stations/src/code-review/post-review/station.test.ts#L167))
- A post that no route can deliver — every review shape and the plain comment refused — fails the `post-review` visit rather than being swallowed. ([validated by throws when every review shape and the plain comment are refused](apps/stations/src/code-review/post-review/station.test.ts#L159))
- A code-review-refine node emits its reply as a fenced `REVIEW_REPLY` block (the pod has no `gh`) and its answers to the review's line comments as a `REVIEW_THREAD_REPLIES` block; the `post-reply` station posts each answer under the comment it names. ([validated by replies under comment 88 when the run carries review_id 99, the review that comment belongs to](apps/stations/src/code-review/post-reply/station.test.ts#L76), [validated by replies under comments 88 and 89 of review 99 and resolves only T1, the thread of the reply marked resolved](apps/stations/src/code-review/post-reply/post-reply.test.ts#L137))
- A refine reply that answers no line comment is a plain PR comment. ([validated by comments on PR 412 and produces reply_url when the agent answered no line comment](apps/stations/src/code-review/post-reply/station.test.ts#L56), [validated by comments on PR 412 with the stamped reply when the agent answered no line comment](apps/stations/src/code-review/post-reply/post-reply.test.ts#L122))
- A refine node that emits no reply block fails the `post-reply` visit rather than passing silently. ([validated by throws when the output has no REVIEW_REPLY block](apps/stations/src/code-review/post-reply/post-reply.test.ts#L320), [validated by rejects when the agent output has no REVIEW_REPLY block](apps/stations/src/code-review/post-reply/station.test.ts#L99))
- A `code-review-recheck` run's changes-requested verdict is posted by the same station as a formal `REQUEST_CHANGES` review. ([validated by posts one REQUEST_CHANGES review with a rendered comment per commentable finding](apps/stations/src/code-review/post-review/post-review.test.ts#L94), [validated by creates the review, upserts the neutral check and reports success with the summary and url](apps/stations/src/code-review/post-review/station.test.ts#L72))
- A `code-review-recheck` run's approving verdict is posted by the same station as a formal `APPROVE` review. ([validated by submits an APPROVE review carrying the inline findings for an approved verdict](apps/stations/src/code-review/post-review/post-review.test.ts#L250), [validated by posts a visible APPROVE review for a bare REVIEW_RESULT:APPROVED with no findings block](apps/stations/src/code-review/post-review/post-review.test.ts#L282))

### `libs/shared/src/outbound/project/events/github-map.test.ts`

- returns nothing when the repository is missing. ([validated by](libs/shared/src/outbound/project/events/github-map.test.ts#L346))
- returns nothing for an unhandled event type. ([validated by](libs/shared/src/outbound/project/events/github-map.test.ts#L356))

### `apps/web-ui/src/app/assembly-runs/[id]/TriggerReviewButton.test.tsx`

- posts the repo and pr_number to the review-trigger proxy. ([validated by](apps/web-ui/src/app/assembly-runs/[id]/TriggerReviewButton.test.tsx#L7))

### `libs/assembly-lines/src/loader.test.ts`

- code-review is a `review → post-review → done` graph with no refine node. ([validated by walks code-review from review through post-review to done, with no refine node](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L589))
- gap-fill is a linear flow with retrospective + done as exit pair.
- assemblyLinesDir actually exists on disk (sanity check).
- code-review-recheck is a Gemini 3.1 Pro `recheck → post-review → done` graph routing every verdict to `post-review`. ([validated by walks code-review-recheck through recheck, post-review and done on gemini-3.1-pro-preview with edges for changes_requested, failed and success](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L628))

### `libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts`

- markRunning transitions the matching row to running with started_at. ([validated by](libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts#L525))
- throws on unknown ids for markRunning and returns false for finishNodeOnce. ([validated by](libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts#L635))
- getById returns the record and null for unknown ids. ([validated by](libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts#L649))
- listForTask and getById pass through to the port. ([validated by](libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts#L823))
- ensureNodeStart enforces exactly one returned row (invariant names itself). ([validated by](libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts#L997))
- finishNodeOnce CASes on a null outcome and reports whether it won. ([validated by](libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts#L1009))
- listOpen selects queued and running rows oldest-first. ([validated by](libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts#L1066))
- does not overwrite an already-terminal row (InMemory). ([validated by](libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts#L1077))
- guards the Pg UPDATE on a non-terminal status. ([validated by](libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts#L1092))

### `libs/shared/src/outbound/project/issues/issues.test.ts`

- returns the GitHubPort issues for the project's repo. ([validated by](libs/shared/src/outbound/project/issues/issues.test.ts#L63))
- creates an issue bound to the repo. ([validated by](libs/shared/src/outbound/project/issues/issues.test.ts#L107))
- comments, closes, and labels by number bound to the repo. ([validated by](libs/shared/src/outbound/project/issues/issues.test.ts#L120))

### `libs/shared/src/outbound/project/lib/platform-github.test.ts`

- exposes the github port name. ([validated by](libs/shared/src/outbound/project/lib/platform-github.test.ts#L203))
- createLabels swallows a 422 (already exists) and continues. ([validated by](libs/shared/src/outbound/project/lib/platform-github.test.ts#L668))
- createLabels rethrows a non-422 error. ([validated by](libs/shared/src/outbound/project/lib/platform-github.test.ts#L675))
- createReview posts one review with the mapped comments array. ([validated by](libs/shared/src/outbound/project/lib/platform-github.test.ts#L682))
- get exposes the PR head sha as headSha. ([validated by](libs/shared/src/outbound/project/lib/platform-github.test.ts#L705))
- listReviewThreads maps GraphQL thread nodes (id, resolution, outdated flag, comment databaseIds) and stitches pages past the first cursor. ([validated by](libs/shared/src/outbound/project/lib/platform-github.test.ts#L756))
- resolveReviewThread sends the GraphQL mutation carrying the thread node id. ([validated by](libs/shared/src/outbound/project/lib/platform-github.test.ts#L806))

### `libs/shared/src/outbound/project/pulls/pull-requests.test.ts`

- lists only the repo's pull requests. ([validated by](libs/shared/src/outbound/project/pulls/pull-requests.test.ts#L108))
- merges by number with the requested method bound to the repo. ([validated by](libs/shared/src/outbound/project/pulls/pull-requests.test.ts#L144))
- exposes PR reads bound to the repo and number. ([validated by](libs/shared/src/outbound/project/pulls/pull-requests.test.ts#L153))
- delegates listReviewThreads repo-bound and resolveReviewThread by node id. ([validated by](libs/shared/src/outbound/project/pulls/pull-requests.test.ts#L172))

### `libs/shared/src/work/review/review-reply.test.ts`

- A fenced `REVIEW_REPLY` block yields its trimmed markdown body. ([validated by](libs/shared/src/work/review/review-reply.test.ts#L8))
- Multi-line markdown inside the block is preserved. ([validated by](libs/shared/src/work/review/review-reply.test.ts#L14))
- An absent reply block yields null, so a formatting slip posts nothing rather than crashing the node. ([validated by](libs/shared/src/work/review/review-reply.test.ts#L20))
- An empty reply block also yields null. ([validated by](libs/shared/src/work/review/review-reply.test.ts#L24))

### `libs/shared/src/outbound/project/repo/repo-files.test.ts`

- reads a file from the repo at the given ref. ([validated by](libs/shared/src/outbound/project/repo/repo-files.test.ts#L55))
- returns null for a file the repo does not have. ([validated by](libs/shared/src/outbound/project/repo/repo-files.test.ts#L61))
- creates a branch and commits a file via the API, repo bound. ([validated by](libs/shared/src/outbound/project/repo/repo-files.test.ts#L67))

### `libs/shared/src/work/review/conventional-comment.test.ts`

- renders label and subject as a bold header. ([validated by](libs/shared/src/work/review/conventional-comment.test.ts#L5))
- renders the decoration in parentheses after the label. ([validated by](libs/shared/src/work/review/conventional-comment.test.ts#L14))
- appends a suggestion block after the header. ([validated by](libs/shared/src/work/review/conventional-comment.test.ts#L26))
- renders discussion between the header and the suggestion. ([validated by](libs/shared/src/work/review/conventional-comment.test.ts#L38))
- renders an empty suggestion block for a whole-line deletion. ([validated by](libs/shared/src/work/review/conventional-comment.test.ts#L51))

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
  ([validated by](libs/shared/src/work/review/review-findings.test.ts#L162), [validated by](libs/shared/src/work/review/review-findings.test.ts#L176), [validated by](libs/shared/src/work/review/review-findings.test.ts#L184), [validated by](libs/shared/src/work/review/review-findings.test.ts#L193), [validated by](libs/shared/src/work/review/review-findings.test.ts#L211))
- A `decoration` the contract does not name — a model writing `"none"` for "no decoration", as Gemini did on the first review the external floor ran (HALEngine#123, 2026-09-30), which lost four findings to that one word — is dropped and its finding kept; a named decoration is kept as written. ([validated by keeps the finding and drops the decoration none](libs/shared/src/work/review/review-findings.test.ts#L292), [validated by keeps the decoration non-blocking as written](libs/shared/src/work/review/review-findings.test.ts#L298))
- A finding written as one `message` — Gemini's shape on #2143's recheck
  (2026-09-23), which lost every finding and failed the run — reads its
  opening sentence as the `subject` (the whole first line when that sentence
  is too short to be one, and never empty) and the whole text as the
  discussion.
  ([validated by](libs/shared/src/work/review/review-findings.test.ts#L222), [validated by](libs/shared/src/work/review/review-findings.test.ts#L252))
- *(added 2026-09-25)* A review reaches the PR as a review, posted by the `post-review` station and giving up as little as GitHub
  forces: the whole review with its inline comments first; then, for a line GitHub will
  take no comment on, the same APPROVE or REQUEST_CHANGES with every finding rendered in
  the body; then a COMMENT review naming the `lore/code-review` check as where its verdict
  went, which is the only review GitHub accepts on a pull request the reviewer opened; and
  only with all three refused, one plain comment, which never drops it.
  ([validated by posts one REQUEST_CHANGES review with a rendered comment per commentable finding](apps/stations/src/code-review/post-review/post-review.test.ts#L94), [validated by keeps REQUEST_CHANGES and renders the finding in the body when GitHub rejects the inline comment](apps/stations/src/code-review/post-review/post-review.test.ts#L157), [validated by posts a COMMENT review when GitHub rejects an approval on the author's own pull request](apps/stations/src/code-review/post-review/post-review.test.ts#L175), [validated by posts one plain issue comment when every review shape is refused](apps/stations/src/code-review/post-review/post-review.test.ts#L195))
- *(added 2026-09-25)* A push earns a re-check of its own unless one of two things is true:
  a review-family run is already in flight for that exact head sha, or every commit pushed
  since the last verdict tells CI to skip it, which is the `style: prettier [skip ci]` the
  format job pushes onto the branch. Neither refusal can lose a verdict, and a push while
  a DIFFERENT sha is in flight still gets its own pass. Three verdicts inside four minutes
  on one PR is what this ends.
  ([validated by starts no re-check while an open run is judging sha-new](libs/shared/src/work/review/floor-review-start.test.ts#L420), [validated by ignores a review of another pull request in the same repository](libs/shared/src/work/review/floor-review-start.test.ts#L437))
- *(added 2026-09-25)* The re-check's brief names the sha the last verdict judged, so the
  pass reads the range since that sha rather than the whole pull request again; with no
  earlier verdict it reads `main...HEAD` as before. The sha and the range are resolved
  together, so a rebase that drops the judged commit names no sha at all rather than
  sending the pod to diff against history the branch no longer has.
  ([validated by starts a re-check that names sha-old as the last judged commit](libs/shared/src/work/review/floor-review-start.test.ts#L294), [validated by reads the range since the sha the last verdict judged, rather than the whole PR again](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1120))
- *(added 2026-09-25)* The re-check recipe carries the deep review's discipline at its own
  scope: context queried with the PR title and the surface the new commits change, the CI
  verdict read through `lore_get_ci_failures` rather than reasoned about or re-run, each
  diff read once in place, and a `question` when an added spec statement is not what a
  person using that surface would expect.
  ([validated by reads the range since the sha the last verdict judged, rather than the whole PR again](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1120), [validated by carries the same CI-verdict and read-once rules as the deep review, so a re-check runs no linter either](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1130), [validated by queries context with the PR title and the surface the new commits change](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1141))
- *(added 2026-09-25)* A review asked for by hand supersedes the fast pass a push started:
  the open re-check is finished `superseded` before the deep review starts, so one sha
  never collects two verdicts of different depths. ([validated by cancels the open re-check as superseded when a review is forced](libs/shared/src/work/review/floor-review-start.test.ts#L262))
- Every recipe that asks for a `REVIEW_FINDINGS` block shows a whole finding
  (`path`, `line`, `label`, `decoration`, `subject`) rather than pointing at
  another recipe's schema, so no model has to guess the shape.
  ([validated by shows a whole finding with path, line, label, decoration and subject in code-review and code-review-recheck, so no model guesses the shape (#2143's recheck lost every finding)](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1159))
- *(added 2026-09-24)* The deep review reads the change as its user before it reads
  it as its reviewer: for every spec statement the PR adds or changes, one line on
  what a person using that surface sees differently, compared with the statements
  beside it and the page or route that renders it, and a mismatch is a `question`
  finding rather than silence — a spec written in the same PR as its code proves
  nothing about intent (the #2130 replay approved a fresh-run design twice).
  ([validated by asks, for every spec statement the PR adds or changes, what a person using that surface sees differently, and files a mismatch as a question rather than silence](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1072))
- Lint, types, formatting and tests are CI's verdict, read through
  `lore_get_ci_failures`; the review runs no eslint, tsc, formatter, test runner or
  install. ([validated by names lint, types, formatting and tests as CI's verdict, read through lore_get_ci_failures, so the review spends no commands reproducing them](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1082))
- The diff is read once, in place, never dumped to a file and read back.
  ([validated by reads the diff once in place and never dumps it to a file to re-read](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1092))
- Context is queried with the PR title, the spec sections it touches and the surface
  it changes, never with a description of reviewing, which returns the platform
  overview. ([validated by queries context with the PR's subject, spec and surface, never with a description of reviewing](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1098))
- `changes_requested` is for a defect in the changed code or a mismatch between what
  the spec says and what a person would expect of its surface; a `question` alone
  never blocks. ([validated by reserves changes_requested for a defect in the changed code or a mismatch between the spec and what a person would expect, and says a question alone does not block](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1107))
- parses a valid findings block into a ReviewOutput. ([validated by](libs/shared/src/work/review/review-findings.test.ts#L8))
- returns null when no findings block is present. ([validated by](libs/shared/src/work/review/review-findings.test.ts#L42))
- returns null when the block is not valid JSON that a quote/newline repair
  pass can recover either. ([validated by](libs/shared/src/work/review/review-findings.test.ts#L46))
- recovers a finding whose narrative field carries a quote the model forgot to
  escape — #1401 reproduced verbatim: a well-formed block with one broken
  string killed `JSON.parse` outright and discarded every finding, including
  the blocking one. A quote is read as closing the string only when the next
  non-whitespace character is one JSON allows there (`,` `}` `]` `:` or end of
  input); anything else is escaped instead, which a single regex cannot do
  because whether a `"` closes the string depends on what comes after it.
  ([validated by](libs/shared/src/work/review/review-findings.test.ts#L50))
- recovers a finding whose narrative field carries a literal newline, escaping
  it the same way. ([validated by](libs/shared/src/work/review/review-findings.test.ts#L59))
- recovers a finding whose suggestion carries a literal tab the same way — a
  tabbed-indented code snippet is a raw control character JSON forbids
  unescaped in a string, exactly like a raw newline. ([validated by](libs/shared/src/work/review/review-findings.test.ts#L68))
- recovers every finding when several each carry an unescaped quote, not just
  the first. ([validated by](libs/shared/src/work/review/review-findings.test.ts#L77))
- does not let the repair pass turn genuinely broken JSON into a false
  positive — missing quotes around a key or value stay unparseable. ([validated by](libs/shared/src/work/review/review-findings.test.ts#L90))
- returns null when a finding has an unknown label. ([validated by](libs/shared/src/work/review/review-findings.test.ts#L96))
- returns null when the verdict is missing. ([validated by](libs/shared/src/work/review/review-findings.test.ts#L107))
- treats an optional field written as `null` as absent, because that is what a
  model means by it — read as a value, ONE null failed its type check and the
  ENTIRE block was discarded, so a review that found ten things posted none and
  its node failed with the findings lost. ([validated by](libs/shared/src/work/review/review-findings.test.ts#L124))
- keeps every other finding when one carries a null optional. ([validated by](libs/shared/src/work/review/review-findings.test.ts#L130))
- still rejects a wrong TYPE in an optional field: this widens what counts as
  absent, not what counts as valid. ([validated by](libs/shared/src/work/review/review-findings.test.ts#L138))

### `libs/shared/src/work/review/review-summary.test.ts`

- renders the Approved header and a zero tally for no findings. ([validated by](libs/shared/src/work/review/review-summary.test.ts#L10))
- counts blocking issues as must-fix, nits, and the rest as consider. ([validated by](libs/shared/src/work/review/review-summary.test.ts#L18))
- includes the agent summary line under the header when present. ([validated by](libs/shared/src/work/review/review-summary.test.ts#L41))

