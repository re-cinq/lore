# Feature Specification: Autonomous Review Loop

> **Execution substrate moved (ADR-031, `specs/floor-on-ai-subsystem/`).** The review-loop
> behavior is unchanged, but it now runs as `github_action` + agent nodes in the Floor-side
> workflow graph rather than chained `LoreTask` CRs — read the `LoreTask`-specific mechanics
> here in the past tense.

> **Widened to all open PRs — the `code-review` assembly line ([ADR-012](../../adrs/ADR-012-autonomous-review-loop.md)).**
> The loop below closes on Lore's **own** implementation PRs. The `code-review` assembly
> line (`review → refine → done`, `libs/assembly-lines/src/assembly-lines/code-review.yaml`)
> extends the same `auto_review` opt-in to **any open PR, including human-authored**, driven
> by PR-lifecycle webhooks on the event bus instead of the `pr-created` hook:
> - **PR opened / reopened / ready_for_review** → start a review pass + post a "review has
>   started" PR comment linking `${LORE_UI_URL}/assembly-runs/<id>`.
> - **Review pass** → the `review` node posts **line-level** inline comments; a
>   `changes_requested` verdict routes to `refine`, which acts on it.
> - **Human reply** (`issue_comment.created` / `pull_request_review_comment.created`) →
>   a fresh `mode: reply` pass that **decides per reply**: answer in-thread, or commit a fix.
> - **PR closed** → finish any open code-review line for that PR.
>
> An assembly line runs once to completion, so "engaged as long as the PR is open" is the
> **choreography re-invoking the line per webhook**, not one long-lived line. Bot-authored
> PRs and bot comments are skipped (loop guard). Handlers: `apps/floor/src/jobs/review/code-review.ts`.

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
3. Approved: parent task marked as `review/approved`
4. Changes requested (iteration < 2): new implementation LoreTask with feedback, same branch ([validated by `review-feedback.test.ts`](libs/shared/src/review-feedback.test.ts))

5. Changes requested (iteration >= 2): escalate with `needs-human-review` label
6. Review completes in <5 min
7. Review result visible in pipeline UI
8. Auto-review is opt-in per repo
9. All steps run as ephemeral Job pods — no in-process LLM calls

## Code-review assembly line — validated behavior

These statements pin the `code-review` choreography (`apps/floor/src/jobs/review/code-review.ts`)
and the webhook/verdict plumbing it rides on.

1. `autoReviewEnabled` gates the whole loop on the per-repo `auto_review` setting: `true` only for
   the boolean `true`, `false` when the flag is absent, `false`, or the settings are null, and it
   parses a JSON-string settings blob. ([validated by `should-auto-review.test.ts:5`](apps/floor/src/jobs/review/should-auto-review.test.ts#L5), [`should-auto-review.test.ts:9`](apps/floor/src/jobs/review/should-auto-review.test.ts#L9), [`should-auto-review.test.ts:15`](apps/floor/src/jobs/review/should-auto-review.test.ts#L15))

2. Bot loop guard: `isBotActor` is true only for `[bot]` logins; a bot-authored PR is skipped (Lore
   never double-reviews its own PRs) and the bot's own comment never starts a reply pass. ([validated by `code-review.test.ts:79`](apps/floor/src/jobs/review/code-review.test.ts#L79), [`code-review.test.ts:91`](apps/floor/src/jobs/review/code-review.test.ts#L91), [`code-review.test.ts:242`](apps/floor/src/jobs/review/code-review.test.ts#L242))

3. On PR open/reopen/ready: `decideReviewOnOpen` starts a `code-review` line in `review` mode only
   for an open, non-draft, human PR with auto-review on, and posts a started-comment linking the
   assembly line; it does nothing when auto-review is off. ([validated by `code-review.test.ts:91`](apps/floor/src/jobs/review/code-review.test.ts#L91), [`code-review.test.ts:164`](apps/floor/src/jobs/review/code-review.test.ts#L164), [`code-review.test.ts:196`](apps/floor/src/jobs/review/code-review.test.ts#L196))

4. On a human reply: `decideReviewOnReply` starts a `reply`-mode line carrying the comment id/body
   only for a human comment on an open, non-draft PR with auto-review on; a reply on a closed PR is
   ignored. ([validated by `code-review.test.ts:113`](apps/floor/src/jobs/review/code-review.test.ts#L113), [`code-review.test.ts:222`](apps/floor/src/jobs/review/code-review.test.ts#L222), [`code-review.test.ts:206`](apps/floor/src/jobs/review/code-review.test.ts#L206))

5. On PR close: `onClose` finishes any open code-review line for that PR with outcome `pr_closed`. ([validated by `code-review.test.ts:418`](apps/floor/src/jobs/review/code-review.test.ts#L418))

6. The GitHub webhook maps `pull_request.closed` to `github.pull_request.closed` carrying
   `merged`/`branch`/`merge_commit_sha`/`labels` — for both a merged and a closed-without-merge PR —
   so code-review can finish its line. ([validated by `github-map.test.ts:24`](libs/shared/src/project/events/github-map.test.ts#L24), [`github-map.test.ts:54`](libs/shared/src/project/events/github-map.test.ts#L54))

7. A human reply arrives as a created `pull_request_review_comment` mapped to
   `github.pull_request_review_comment.created` with author/id/body; a non-created review comment is
   ignored. ([validated by `github-map.test.ts:187`](libs/shared/src/project/events/github-map.test.ts#L187), [`github-map.test.ts:214`](libs/shared/src/project/events/github-map.test.ts#L214), [`github-map.test.ts:246`](libs/shared/src/project/events/github-map.test.ts#L246))

8. The watcher parses the agent's review verdict from stdout: `REVIEW_RESULT:APPROVED` → `approved`,
   `CHANGES_REQUESTED` (with trailing feedback) → `changes_requested`, and no marker or absent output
   → undefined. ([validated by `agent-watcher-logic.test.ts:34`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L34), [`agent-watcher-logic.test.ts:39`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L39), [`agent-watcher-logic.test.ts:44`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L44))



## Validated behavior — code-review line overhaul (2026-07)

The code-review assembly line is the sole reviewer (ADR-012 amendment): a **deep** first review on open / out-of-draft / first push, then a **fast `code-review-recheck`** on every later push (re-review on explicit `@lore review`); comments are triaged by a Haiku station (review / address / answer / ignore); both reviews render structured findings as Conventional Comments and submit a **formal `APPROVE` / `REQUEST_CHANGES` verdict** (2026-08 amendment), the signal the dark-factory auto-merge gate reads; fixes are human-gated; a PR check surfaces state and blocks merge while the review runs. Each behaviour below is pinned to its test.

### `apps/floor/src/delivery/http/routes/review-start.test.ts`

- returns 401 on a wrong bearer token. ([validated by](apps/floor/src/delivery/http/routes/review-start.test.ts#L34))
- returns 400 when repo or pr_number is missing. ([validated by](apps/floor/src/delivery/http/routes/review-start.test.ts#L40))
- starts a forced review and returns 202 with the line id. ([validated by](apps/floor/src/delivery/http/routes/review-start.test.ts#L48))

### `apps/floor/src/jobs/assembly-run/pr-check.test.ts`

- returns null when the line carries no pr_number. ([validated by](apps/floor/src/jobs/assembly-run/pr-check.test.ts#L52))
- returns null when the line carries no head_sha. ([validated by](apps/floor/src/jobs/assembly-run/pr-check.test.ts#L58))
- maps a running line to an in_progress check named lore/<definition>. ([validated by](apps/floor/src/jobs/assembly-run/pr-check.test.ts#L62))
- keeps a running line in_progress even when a node already recorded changes_requested. ([validated by](apps/floor/src/jobs/assembly-run/pr-check.test.ts#L70))
- maps a changes_requested line outcome to a neutral conclusion. ([validated by](apps/floor/src/jobs/assembly-run/pr-check.test.ts#L78))
- maps a completed line whose review node recorded changes_requested to a neutral conclusion — the walk routes `changes_requested → done`, so only the node walk row carries the verdict. ([validated by](apps/floor/src/jobs/assembly-run/pr-check.test.ts#L87))
- reads the latest iteration of a node, so a re-reviewed success wins over an earlier changes_requested. ([validated by](apps/floor/src/jobs/assembly-run/pr-check.test.ts#L99))
- maps a completed line to a success conclusion. ([validated by](apps/floor/src/jobs/assembly-run/pr-check.test.ts#L108))
- maps a failed line to a failure conclusion. ([validated by](apps/floor/src/jobs/assembly-run/pr-check.test.ts#L114))
- maps a failed line with a changes_requested node to a failure conclusion. ([validated by](apps/floor/src/jobs/assembly-run/pr-check.test.ts#L120))
- maps a pr_closed outcome to a cancelled conclusion. ([validated by](apps/floor/src/jobs/assembly-run/pr-check.test.ts#L154))
- maps a pr_closed line with a changes_requested node to a cancelled conclusion. ([validated by](apps/floor/src/jobs/assembly-run/pr-check.test.ts#L160))
- adds a details_url to the Lore UI when a uiUrl is given. ([validated by](apps/floor/src/jobs/assembly-run/pr-check.test.ts#L168))
- maps an iteration_max outcome to a failure conclusion. ([validated by](apps/floor/src/jobs/assembly-run/pr-check.test.ts#L176))
- publishes a code-review-recheck line under the aliased `lore/code-review` check name so a required branch-protection check is refreshed on every push, not stranded under a separate name. ([validated by](apps/floor/src/jobs/assembly-run/pr-check.test.ts#L187))

### `apps/floor/src/jobs/assembly-run/advance.test.ts`

- A code-review-recheck line opts out of the branch-overlap guard, so a push landing while a review or reply line still holds the PR branch is not silently dropped as `lease_held` (the verdict update always runs). ([validated by](apps/floor/src/jobs/assembly-run/advance.test.ts#L974))

### `apps/floor/src/jobs/merge/auto-merge.test.ts`

- merges when all gates pass. ([validated by](apps/floor/src/jobs/merge/auto-merge.test.ts#L32))
- deferred:dark_mode_off when not enabled (overrides everything). ([validated by](apps/floor/src/jobs/merge/auto-merge.test.ts#L41))
- deferred:no_changes for an empty PR before path-allowlist check. ([validated by](apps/floor/src/jobs/merge/auto-merge.test.ts#L47))
- deferred:review_in_flight while a code-review line is open. ([validated by](apps/floor/src/jobs/merge/auto-merge.test.ts#L53))
- deferred:human_review when human changes requested. ([validated by](apps/floor/src/jobs/merge/auto-merge.test.ts#L59))
- deferred:ci_failed when require_green_ci and CI red. ([validated by](apps/floor/src/jobs/merge/auto-merge.test.ts#L65))
- deferred:bot_changes_requested when bot did not APPROVE. ([validated by](apps/floor/src/jobs/merge/auto-merge.test.ts#L82))
- deferred:trust_too_low when repo has no trust set. ([validated by](apps/floor/src/jobs/merge/auto-merge.test.ts#L107))
- reports CI status as failed when CI red. ([validated by](apps/floor/src/jobs/merge/auto-merge.test.ts#L139))
- reports bot review as CHANGES_REQUESTED when not approved. ([validated by](apps/floor/src/jobs/merge/auto-merge.test.ts#L145))

### `apps/floor/src/jobs/review/code-review.test.ts`

- isBotActor is true only for [bot] logins. ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L79))
- isReviewRequest matches an @lore review keyword, not arbitrary chatter. ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L84))
- decideReviewOnReply starts only for an open, non-draft PR with a human comment. ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L113))
- routes address to a code-review-reply line with the address intent + thread. ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L139))
- routes ignore to nothing. ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L158))
- starts a code-review-recheck line on a push to an already-reviewed PR (the fast re-check replaces the old first-review-only skip). ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L184))
- skips a draft PR. ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L196))
- ignores the bot's own comment (loop guard). ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L242))
- starts the routed follow-up line for the action. ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L258))
- does nothing on an ignore action. ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L268))
- routes review to a code-review line. ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L132))
- routes answer to a code-review-reply line with the answer intent. ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L151))
- composes the review body with inline comments carrying ids and locations. ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L278))
- returns an empty string for a review with neither body nor comments. ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L307))
- keeps the inline-comments header when the review has no body. ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L311))
- starts a code-review-reply line carrying the review body and its inline comments. ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L340))
- falls back to a generic description when the review carried no text. ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L377))
- ignores an approved review. ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L394))
- ignores the bot's own submitted review (loop guard). ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L405))
- finishes any open code-review lines for the PR. ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L418))
- re-checks with the head sha and recheck mode on a push to an already-reviewed PR, and posts no per-push comment. ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L453))
- skips the re-check on a bot-authored PR under the same loop guard as the first review. ([validated by](apps/floor/src/jobs/review/code-review.test.ts#L469))

### `apps/floor/src/jobs/review/post-review.test.ts`

- posts one REQUEST_CHANGES review (the formal verdict, always on) with a rendered comment per in-diff finding and a summary. ([validated by](apps/floor/src/jobs/review/post-review.test.ts#L78))
- partitions findings by diff hunk — a finding on a commentable line stays inline, one on an uninlineable line folds into overflow. ([validated by](apps/floor/src/jobs/review/post-review.test.ts#L63))
- A finding on a line GitHub cannot inline (an unchanged line, or a file outside the diff) is folded into the review body, because one such inline comment 422s the whole atomic review. ([validated by](apps/floor/src/jobs/review/post-review.test.ts#L119))
- When the atomic review post is rejected, the whole review is delivered as one top-level comment rather than silently dropped. ([validated by](apps/floor/src/jobs/review/post-review.test.ts#L139))
- posts when the output carries a REVIEW_FINDINGS block. ([validated by](apps/floor/src/jobs/review/post-review.test.ts#L165))
- A bare `REVIEW_RESULT:APPROVED` with no findings block posts a visible formal `APPROVE` review rather than staying silent. ([validated by](apps/floor/src/jobs/review/post-review.test.ts#L178))
- does nothing when there is no findings block and no approval verdict. ([validated by](apps/floor/src/jobs/review/post-review.test.ts#L190))
- The review node's findings are carried inside the Agent output envelope, so the raw stream parses to no findings and posts nothing — the review reaches a verdict while the PR receives silence. ([validated by](apps/floor/src/jobs/review/post-review.test.ts#L244))
- Unwrapping the envelope first restores the agent text, and every finding is then posted as a review comment. ([validated by](apps/floor/src/jobs/review/post-review.test.ts#L253))
- Submits a formal `APPROVE` review carrying the inline findings when the verdict is approved. ([validated by](apps/floor/src/jobs/review/post-review.test.ts#L432))
- Submits a formal `REQUEST_CHANGES` review carrying the inline findings when the verdict requests changes. ([validated by](apps/floor/src/jobs/review/post-review.test.ts#L447))

### `libs/shared/src/review/diff-hunks.test.ts`

- Added and context lines are commentable on the right (new) side. ([validated by](libs/shared/src/review/diff-hunks.test.ts#L25))
- Removed and context lines are commentable on the left (old) side. ([validated by](libs/shared/src/review/diff-hunks.test.ts#L37))
- A line inside a hunk is commentable. ([validated by](libs/shared/src/review/diff-hunks.test.ts#L51))
- A line outside any hunk is not commentable. ([validated by](libs/shared/src/review/diff-hunks.test.ts#L55))
- A file not in the diff is not commentable. ([validated by](libs/shared/src/review/diff-hunks.test.ts#L59))
- A LEFT-side comment is checked against the left side, not the right. ([validated by](libs/shared/src/review/diff-hunks.test.ts#L63))
- A file deleted in the diff (`+++ /dev/null`) is uncommentable on either side. ([validated by](libs/shared/src/review/diff-hunks.test.ts#L80))

### `apps/floor/src/jobs/assembly-run/node-terminal.test.ts`

- A code-review node's findings are posted as one review against the line's PR. ([validated by](apps/floor/src/jobs/assembly-run/node-terminal.test.ts#L181))
- A node that is not a code review posts nothing. ([validated by](apps/floor/src/jobs/assembly-run/node-terminal.test.ts#L196))
- A line carrying no `pr_number` posts nothing. ([validated by](apps/floor/src/jobs/assembly-run/node-terminal.test.ts#L205))
- A verdict that reaches no parseable findings MUST be audited as `review_findings_unparsed` rather than passing silently — that state is indistinguishable from a clean review at the PR. ([validated by](apps/floor/src/jobs/assembly-run/node-terminal.test.ts#L213))
- An inline post that GitHub rejects and that is delivered as the top-level-comment fallback MUST be audited as `review_post_degraded` while the node still reports posted — a silent downgrade is invisible at the PR. ([validated by](apps/floor/src/jobs/assembly-run/node-terminal.test.ts#L233))
- A post that throws MUST be audited as `review_post_failed` rather than swallowed, and never fails the line. ([validated by](apps/floor/src/jobs/assembly-run/node-terminal.test.ts#L269))
- A code-review-refine node emits its reply as a fenced `REVIEW_REPLY` block (the pod has no `gh`); the Floor posts it in-thread when the line carries an `in_reply_to_id`. ([validated by](apps/floor/src/jobs/assembly-run/node-terminal.test.ts#L329))
- A refine reply with no thread id falls back to a plain PR comment. ([validated by](apps/floor/src/jobs/assembly-run/node-terminal.test.ts#L346))
- A node that is not a refine node posts no reply. ([validated by](apps/floor/src/jobs/assembly-run/node-terminal.test.ts#L360))
- A refine node that emits no reply block MUST be audited as `review_reply_unparsed` rather than passing silently. ([validated by](apps/floor/src/jobs/assembly-run/node-terminal.test.ts#L375))
- A reply post that throws MUST be audited as `review_reply_post_failed` rather than swallowed, and never fails the line. ([validated by](apps/floor/src/jobs/assembly-run/node-terminal.test.ts#L396))
- A `code-review-recheck` node's changes-requested verdict is posted as a formal `REQUEST_CHANGES` review. ([validated by](apps/floor/src/jobs/assembly-run/node-terminal.test.ts#L848))
- A `code-review-recheck` node's approving verdict is posted as a formal `APPROVE` review. ([validated by](apps/floor/src/jobs/assembly-run/node-terminal.test.ts#L862))

### `libs/shared/src/project/events/github-map.test.ts`

- returns nothing for a check with no backing PRs. ([validated by](libs/shared/src/project/events/github-map.test.ts#L286))
- returns nothing when the repository is missing. ([validated by](libs/shared/src/project/events/github-map.test.ts#L334))
- returns nothing for an unhandled event type. ([validated by](libs/shared/src/project/events/github-map.test.ts#L344))

### `apps/stations/src/stations/comment-triage/comment-triage.test.ts`

- emits the classified action in LORE_NODE_RESULT extras. ([validated by](apps/stations/src/stations/comment-triage/comment-triage.test.ts#L22))
- defaults to ignore when classification fails. ([validated by](apps/stations/src/stations/comment-triage/comment-triage.test.ts#L41))
- reports the classification call's usage on the node result, so the cost sink records the triage spend. ([validated by](apps/stations/src/stations/comment-triage/comment-triage.test.ts#L51))

### `apps/web-ui/src/app/assembly-runs/[id]/TriggerReviewButton.test.tsx`

- posts the repo and pr_number to the review-trigger proxy. ([validated by](apps/web-ui/src/app/assembly-runs/[id]/TriggerReviewButton.test.tsx#L7))

### `libs/assembly-lines/src/loader.test.ts`

- code-review is a suggestion-only review→done graph (no refine/auto-commit). ([validated by](libs/assembly-lines/src/loader.test.ts#L655))
- gap-fill is a linear flow with retrospective + done as exit pair. ([validated by](libs/assembly-lines/src/loader.test.ts#L703))
- assemblyLinesDir actually exists on disk (sanity check). ([validated by](libs/assembly-lines/src/loader.test.ts#L736))
- code-review-recheck is a fast Haiku recheck→done graph routing every verdict to done. ([validated by](libs/assembly-lines/src/loader.test.ts#L938))

### `libs/shared/src/project/assembly-runs/assembly-runs.test.ts`

- markRunning transitions the matching row to running with started_at. ([validated by](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L527))
- throws on unknown ids for markRunning and returns false for finishNodeOnce. ([validated by](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L637))
- getById returns the record and null for unknown ids. ([validated by](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L651))
- listForTask and getById pass through to the port. ([validated by](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L828))
- ensureNodeStart enforces exactly one returned row (invariant names itself). ([validated by](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1004))
- finishNodeOnce CASes on a null outcome and reports whether it won. ([validated by](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1016))
- listOpen selects queued and running rows oldest-first. ([validated by](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1070))
- does not overwrite an already-terminal row (InMemory). ([validated by](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1081))
- guards the Pg UPDATE on a non-terminal status. ([validated by](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1096))

### `libs/shared/src/project/issues/issues.test.ts`

- returns the GitHubPort issues for the project's repo. ([validated by](libs/shared/src/project/issues/issues.test.ts#L59))
- creates an issue bound to the repo. ([validated by](libs/shared/src/project/issues/issues.test.ts#L103))
- comments, closes, and labels by number bound to the repo. ([validated by](libs/shared/src/project/issues/issues.test.ts#L116))

### `libs/shared/src/project/lib/platform-github.test.ts`

- exposes the github port name. ([validated by](libs/shared/src/project/lib/platform-github.test.ts#L79))
- createLabels swallows a 422 (already exists) and continues. ([validated by](libs/shared/src/project/lib/platform-github.test.ts#L168))
- createLabels rethrows a non-422 error. ([validated by](libs/shared/src/project/lib/platform-github.test.ts#L175))
- createReview posts one review with the mapped comments array. ([validated by](libs/shared/src/project/lib/platform-github.test.ts#L182))
- get exposes the PR head sha as headSha. ([validated by](libs/shared/src/project/lib/platform-github.test.ts#L205))
- listReviewThreads maps GraphQL thread nodes (id, resolution, outdated flag, comment databaseIds) and stitches pages past the first cursor. ([validated by](libs/shared/src/project/lib/platform-github.test.ts#L256))
- resolveReviewThread sends the GraphQL mutation carrying the thread node id. ([validated by](libs/shared/src/project/lib/platform-github.test.ts#L306))

### `libs/shared/src/project/pulls/pull-requests.test.ts`

- lists only the repo's pull requests. ([validated by](libs/shared/src/project/pulls/pull-requests.test.ts#L81))
- merges by number with the requested method bound to the repo. ([validated by](libs/shared/src/project/pulls/pull-requests.test.ts#L117))
- exposes PR reads bound to the repo and number. ([validated by](libs/shared/src/project/pulls/pull-requests.test.ts#L126))
- delegates listReviewThreads repo-bound and resolveReviewThread by node id. ([validated by](libs/shared/src/project/pulls/pull-requests.test.ts#L145))

### `libs/shared/src/review/review-reply.test.ts`

- A fenced `REVIEW_REPLY` block yields its trimmed markdown body. ([validated by](libs/shared/src/review/review-reply.test.ts#L8))
- Multi-line markdown inside the block is preserved. ([validated by](libs/shared/src/review/review-reply.test.ts#L14))
- An absent reply block yields null, so a formatting slip posts nothing rather than crashing the node. ([validated by](libs/shared/src/review/review-reply.test.ts#L20))
- An empty reply block also yields null. ([validated by](libs/shared/src/review/review-reply.test.ts#L24))

### `libs/shared/src/project/repo/repo-files.test.ts`

- reads a file from the repo at the given ref. ([validated by](libs/shared/src/project/repo/repo-files.test.ts#L55))
- returns null for a file the repo does not have. ([validated by](libs/shared/src/project/repo/repo-files.test.ts#L61))
- creates a branch and commits a file via the API, repo bound. ([validated by](libs/shared/src/project/repo/repo-files.test.ts#L67))

### `libs/shared/src/review/comment-triage.test.ts`

- returns the action the model chose. ([validated by](libs/shared/src/review/comment-triage.test.ts#L9))
- defaults to ignore when the model returns an unknown action. ([validated by](libs/shared/src/review/comment-triage.test.ts#L24))
- passes the replied-to comment into the prompt for a reply. ([validated by](libs/shared/src/review/comment-triage.test.ts#L32))
- returns the classification call's usage for the station cost report. ([validated by](libs/shared/src/review/comment-triage.test.ts#L49))
- returns no usage when the model call throws. ([validated by](libs/shared/src/review/comment-triage.test.ts#L71))

### `libs/shared/src/review/conventional-comment.test.ts`

- renders label and subject as a bold header. ([validated by](libs/shared/src/review/conventional-comment.test.ts#L5))
- renders the decoration in parentheses after the label. ([validated by](libs/shared/src/review/conventional-comment.test.ts#L14))
- appends a suggestion block after the header. ([validated by](libs/shared/src/review/conventional-comment.test.ts#L26))
- renders discussion between the header and the suggestion. ([validated by](libs/shared/src/review/conventional-comment.test.ts#L38))
- renders an empty suggestion block for a whole-line deletion. ([validated by](libs/shared/src/review/conventional-comment.test.ts#L51))

### `libs/shared/src/review/review-findings.test.ts`

- parses a valid findings block into a ReviewOutput. ([validated by](libs/shared/src/review/review-findings.test.ts#L8))
- returns null when no findings block is present. ([validated by](libs/shared/src/review/review-findings.test.ts#L42))
- returns null when the block is not valid JSON. ([validated by](libs/shared/src/review/review-findings.test.ts#L46))
- returns null when a finding has an unknown label. ([validated by](libs/shared/src/review/review-findings.test.ts#L50))
- returns null when the verdict is missing. ([validated by](libs/shared/src/review/review-findings.test.ts#L61))
- treats an optional field written as `null` as absent, because that is what a
  model means by it — read as a value, ONE null failed its type check and the
  ENTIRE block was discarded, so a review that found ten things posted none and
  its node failed with the findings lost. ([validated by](libs/shared/src/review/review-findings.test.ts#L83))
- keeps every other finding when one carries a null optional. ([validated by](libs/shared/src/review/review-findings.test.ts#L89))
- still rejects a wrong TYPE in an optional field: this widens what counts as
  absent, not what counts as valid. ([validated by](libs/shared/src/review/review-findings.test.ts#L97))

### `libs/shared/src/review/review-summary.test.ts`

- renders the Approved header and a zero tally for no findings. ([validated by](libs/shared/src/review/review-summary.test.ts#L6))
- counts blocking issues as must-fix, nits, and the rest as consider. ([validated by](libs/shared/src/review/review-summary.test.ts#L14))
- includes the agent summary line under the header when present. ([validated by](libs/shared/src/review/review-summary.test.ts#L37))

