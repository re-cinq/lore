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
>   started" PR comment linking `${LORE_UI_URL}/assembly-lines/<id>`.
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
| Status         | Shipped                                  |
| Created        | 2026-04-01                               |
| Owner          | Platform Engineering                     |
| Target         | 3-5 days                                 |

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
   never double-reviews its own PRs) and the bot's own comment never starts a reply pass. ([validated by `code-review.test.ts:53`](apps/floor/src/jobs/review/code-review.test.ts#L53), [`code-review.test.ts:149`](apps/floor/src/jobs/review/code-review.test.ts#L149), [`code-review.test.ts:183`](apps/floor/src/jobs/review/code-review.test.ts#L183))

3. On PR open/reopen/ready: `decideReviewOnOpen` starts a `code-review` line in `review` mode only
   for an open, non-draft, human PR with auto-review on, and posts a started-comment linking the
   assembly line; it does nothing when auto-review is off. ([validated by `code-review.test.ts:59`](apps/floor/src/jobs/review/code-review.test.ts#L59), [`code-review.test.ts:125`](apps/floor/src/jobs/review/code-review.test.ts#L125), [`code-review.test.ts:140`](apps/floor/src/jobs/review/code-review.test.ts#L140))

4. On a human reply: `decideReviewOnReply` starts a `reply`-mode line carrying the comment id/body
   only for a human comment on an open, non-draft PR with auto-review on; a reply on a closed PR is
   ignored. ([validated by `code-review.test.ts:85`](apps/floor/src/jobs/review/code-review.test.ts#L85), [`code-review.test.ts:159`](apps/floor/src/jobs/review/code-review.test.ts#L159), [`code-review.test.ts:197`](apps/floor/src/jobs/review/code-review.test.ts#L197))

5. On PR close: `onClose` finishes any open code-review line for that PR with outcome `pr_closed`. ([validated by `code-review.test.ts:213`](apps/floor/src/jobs/review/code-review.test.ts#L213))

6. The GitHub webhook maps `pull_request.closed` to `github.pull_request.closed` carrying
   `merged`/`branch`/`merge_commit_sha`/`labels` — for both a merged and a closed-without-merge PR —
   so code-review can finish its line. ([validated by `github-map.test.ts:24`](apps/floor/src/listeners/github-map.test.ts#L24), [`github-map.test.ts:54`](apps/floor/src/listeners/github-map.test.ts#L54))

7. A human reply arrives as a created `pull_request_review_comment` mapped to
   `github.pull_request_review_comment.created` with author/id/body; a non-created review comment is
   ignored. ([validated by `github-map.test.ts:146`](apps/floor/src/listeners/github-map.test.ts#L146), [`github-map.test.ts:172`](apps/floor/src/listeners/github-map.test.ts#L172))

8. The watcher parses the agent's review verdict from stdout: `REVIEW_RESULT:APPROVED` → `approved`,
   `CHANGES_REQUESTED` (with trailing feedback) → `changes_requested`, and no marker or absent output
   → undefined. ([validated by `agent-watcher-logic.test.ts:33`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L33), [`agent-watcher-logic.test.ts:38`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L38), [`agent-watcher-logic.test.ts:43`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L43))
