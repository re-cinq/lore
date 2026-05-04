# Task Breakdown: Autonomous Review Loop

| Field   | Value                           |
|---------|---------------------------------|
| Feature | Autonomous Review Loop          |
| Branch  | feat/auto-review-loop           |
| Status  | Shipped                         |
| Spec    | [spec.md](./spec.md)            |
| Plan    | [plan.md](./plan.md)            |

> **Drift note (2026-05-04):** The original tasks.md described the feature at
> spec-time. The implementation diverged in five areas: result-format tokens,
> context hydration in the review pod, review-reactor (human feedback loop),
> auto-merge integration, and a terminal-state idempotency fix. Each section
> below reflects the code that shipped, not the original design intent.

---

## Phase 1: Runner Review Mode

- [x] T001 [P] Add `gh` CLI to `docker/claude-runner/Dockerfile` — installed via
  the GitHub CLI apt repo in the final runtime stage (alongside `git`, `curl`, `jq`).
  GH_TOKEN is set to GITHUB_TOKEN inside the review flow so `gh pr checkout`
  and `gh pr review` work without extra auth config.

- [x] T002 Update `docker/claude-runner/entrypoint.sh` — added `TASK_TYPE=review`
  branch (lines 90–155). Review flow: validate env (`GITHUB_TOKEN`, `TARGET_REPO`,
  `PR_NUMBER`, `TASK_PROMPT`, `TASK_TYPE`) → configure git + gh auth → clone repo
  → `gh pr checkout $PR_NUMBER` → run Claude Code with MCP context preamble →
  parse result → write to `/tmp/review-result.txt` → exit 0 (both approved and
  changes-requested are valid outcomes). No commit/push in this branch.

  **Divergence from spec:** The result tokens changed from `REVIEW_APPROVED` /
  `REVIEW_CHANGES_REQUESTED` to `REVIEW_RESULT:APPROVED` /
  `REVIEW_RESULT:CHANGES_REQUESTED` as the canonical format. Both the old tokens
  and the new `REVIEW_RESULT:` prefix are accepted by the controller regex
  (`loretask-controller.ts:359`), providing backward compatibility during the
  transition.

- [x] T002a [unplanned] Add MCP context hydration preamble to review mode —
  the entrypoint injects a fixed-string preamble instructing Claude Code to call
  `assemble_context` with template `review` and `search_memory` before starting
  the review. This mirrors the context-hydration step in the implementation flow
  and was added after the first pilot run showed reviewers missing ADR context.

- [x] T003 Add `PR_NUMBER` env var support to entrypoint — passed from LoreTask
  spec (`lt.spec.prNumber`), used in `gh pr checkout` and in the review prompt.
  Controller maps `lt.spec.prNumber` → `PR_NUMBER` env var on the Job pod.

---

## Phase 2: CRD + Controller Updates

- [x] T004 Update CRD `terraform/modules/gke-mcp/loretask-crd/crd.yaml` — added
  `reviewResult` (string), `parentTaskId` (string), and `prNumber` (integer) to
  the LoreTask status and spec fields respectively.

- [x] T005 Update `agent/src/loretask-controller.ts` — on review task Job
  completion, `checkJob()` parses logs for
  `REVIEW_RESULT:(APPROVED|CHANGES_REQUESTED(?::[\s\S]*)?)` and sets
  `status.reviewResult = "approved" | "changes-requested"` on the CR. The full
  log tail (last 5 KB) is stored as `status.output`. Log URL written to GCS
  via `writeLogs()`.

- [x] T006 Pass `GH_TOKEN` env to Job pod — the review flow runs
  `export GH_TOKEN="$GITHUB_TOKEN"` inside `entrypoint.sh` so `gh` CLI auth
  is available without a separate secret. The per-task token secret created
  by `createTokenSecret()` covers both GITHUB_TOKEN and GH_TOKEN needs.

---

## Phase 3: Watcher Loop

- [x] T007 Add `shouldAutoReview(repo)` helper to
  `agent/src/jobs/loretask-watcher.ts` — reads `lore.repos.settings.auto_review`
  JSONB field. Returns `true` only when the setting is explicitly `true`
  (opt-in per repo).

- [x] T008 Trigger review LoreTask after implementation PR creation — after the
  watcher creates the PR for a Succeeded implementation task, it checks
  `shouldAutoReview(targetRepo)`. When true, it:
  1. Inserts a `review` pipeline task into `pipeline.tasks` with
     `context_bundle` carrying `{ pr_number, branch, parent_task_id }`.
  2. Creates a `LoreTask` CR with `taskType: review`, `prNumber`, `branch`,
     and a structured prompt that asks Claude Code to output
     `REVIEW_RESULT:APPROVED` or `REVIEW_RESULT:CHANGES_REQUESTED:<feedback>`.
  3. Transitions the implementation task from `pr-created` to `review` status.

- [x] T009 Handle review LoreTask completion — the watcher detects
  `phase === "Succeeded" && lt.spec.taskType === "review" && lt.status?.reviewResult`.
  Two paths:

  - **approved:** transitions parent task to `completed`, posts "Agent review:
    **approved**" comment on the GitHub Issue (if present), marks the review
    task `completed`. Calls `tryAutoMergeForCompletedTask` is NOT called here;
    auto-merge is triggered by the implementation task's watcher path before
    the review loop starts — see T009b.

  - **changes-requested (iteration < 2):** increments `review_iteration` on the
    parent task, creates a new `implementation` LoreTask CR on the same branch
    with the review feedback as prompt context, posts an "auto-fixing" comment
    on the Issue, marks the review task `completed` (prevents infinite re-process).

  - **changes-requested (iteration ≥ 2):** escalates — adds `needs-human-review`
    label, posts "Escalating to human review" comment, parent stays in `review`
    status, review task marked `completed`.

  **Divergence from spec:** The spec described the parent task final status as
  `review/approved`. Actual implementation transitions to `completed` directly.
  The `review` status is an intermediate state during the auto-review cycle,
  not a terminal state.

- [x] T009a [unplanned, bug fix] Mark review tasks `completed` after every
  processing path — without this, the watcher re-visits the review LoreTask on
  every poll tick and: (a) re-increments `review_iteration` beyond the threshold,
  (b) re-posts the escalation or "auto-fixing" comments (one incident reached
  iteration 5680 per 2026-04-19 post-mortem). Fixed by appending
  `UPDATE pipeline.tasks SET status = 'completed'` at the end of every branch
  in the review completion block.

- [x] T009b [unplanned] Dark-factory auto-merge integration — after the
  watcher creates the implementation PR and triggers the review task, it also
  calls `tryAutoMergeForCompletedTask({ taskId })` (fire-and-forget). This
  first call almost always defers (`deferred:ci_failed` — CI hasn't started
  yet). The canonical re-trigger happens when CI completes via the
  `check_run.completed` / `check_suite.completed` webhook forwarded by
  mcp-server to `POST /api/trigger/auto-merge`. Auto-review approval does not
  independently trigger auto-merge; the dark-factory path makes the merge
  decision based on CI state, not review state.

---

## Phase 4: Review Reactor (human feedback loop — unplanned addition)

The original spec was scoped to **bot** review (LoreTask Review Job → CRD →
watcher). After shipping, the team identified a symmetric need: when a **human**
requests changes on a Lore-authored PR, the agent should address the feedback
autonomously rather than leaving the PR stale.

This component (`agent/src/jobs/review-reactor.ts`) is architecturally separate
from the auto-review loop but uses the same `pipeline.tasks` status columns
(`review_iteration`, `pr-created`, `review`, `revision-requested`).

- [x] T020 [unplanned, P] Implement `reviewReactorJob()` in
  `agent/src/jobs/review-reactor.ts` — safety-net polling entry point (cron
  `7 7-17 * * 1-5` UTC, gated by `isBusinessHours()`). Queries tasks in
  `pr-created | review | revision-requested` status with `pr_number IS NOT NULL`
  and `review_iteration < 3`. For each, calls `checkAndProcessPR()`.

- [x] T021 [unplanned] Implement `runReviewReactorForPR(repo, prNumber)` — webhook
  path called by `POST /api/trigger/review-reactor` in `agent/src/health.ts`.
  Returns 202 immediately and runs `processReviewFeedback()` in the background
  (fire-and-forget). Triggered by GitHub webhooks: `pull_request.synchronize`,
  `pull_request_review.submitted`, `issue_comment.created` (on PRs) — all
  forwarded by mcp-server with `LORE_AGENT_INTERNAL_TOKEN` auth. The cron is
  the safety net for dropped webhook deliveries; webhook-triggered runs are
  never gated by business hours.

- [x] T022 [unplanned] Implement `processReviewFeedback()` — fetches PR diff,
  formats pending `CHANGES_REQUESTED` reviews and inline comments newer than
  the last commit on the PR, calls `callLLM()` with the combined prompt, parses
  `=== FILE: path ===` / `=== END FILE ===` blocks from the LLM output, commits
  each changed file to the PR branch. Writes a review-feedback episode for
  org-wide learning via `writeEpisode()`.

- [x] T023 [unplanned] Wire `POST /api/trigger/review-reactor` in
  `agent/src/health.ts` — validates `LORE_AGENT_INTERNAL_TOKEN` bearer token,
  parses `{ repo, pr_number }` body, returns 400 on missing params, 202 on
  accepted, 500 on JSON parse error. Runs `runReviewReactorForPR` fire-and-forget.

---

## Phase 5: Config + Polish

- [x] T010 [P] Update `scripts/task-types.yaml` — `review` task type has
  `execution_mode: claude-code`, updated prompt template using
  `REVIEW_RESULT:APPROVED` / `REVIEW_RESULT:CHANGES_REQUESTED:<feedback>` token
  format, `timeout_minutes: 10`, `review_required: false`.

- [x] T011 [P] Add `auto_review` toggle to repo settings — accessible via the
  settings UI (`web-ui/src/app/repos/[owner]/[repo]/settings/page.tsx` or
  equivalent) and stored in `lore.repos.settings.auto_review` JSONB. Default
  `false` (opt-in). The `shouldAutoReview()` helper in the watcher reads this
  field directly.

- [ ] T012 End-to-end verification — submit an implementation task on a repo
  with `auto_review = true`, verify the full chain:
  implementation Job → PR created → review Job triggered → PR comments posted
  → result detected by controller → watcher transitions parent task →
  approved path sets parent `completed` OR changes-requested path creates fix
  task on same branch. **Pending pilot verification** — no dedicated automated
  coverage in `agent/src/__tests__/` yet; leaving unchecked until a live run
  confirms the chain end-to-end.
