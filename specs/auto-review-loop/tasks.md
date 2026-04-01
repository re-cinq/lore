# Task Breakdown: Autonomous Review Loop

## Phase 1: Runner Review Mode

- [ ] T001 [P] Add `gh` CLI to `docker/claude-runner/Dockerfile` — install via apt or GitHub release binary
- [ ] T002 Update `docker/claude-runner/entrypoint.sh` — detect TASK_TYPE=review, clone PR branch, run Claude Code with review prompt, capture stdout for REVIEW_APPROVED or REVIEW_CHANGES_REQUESTED, skip commit/push, write result to /tmp/review-result.txt
- [ ] T003 Add PR_NUMBER env var support to entrypoint — passed from LoreTask spec, used in review prompt and gh commands [DEPENDS ON: T002]

## Phase 2: CRD + Controller Updates

- [ ] T004 Update CRD `terraform/modules/gke-mcp/loretask-crd/crd.yaml` — add status fields: reviewResult (string), parentTaskId (string), prNumber (integer) to spec
- [ ] T005 Update `agent/src/loretask-controller.ts` — on review task completion, parse Job logs for REVIEW_APPROVED or REVIEW_CHANGES_REQUESTED, set reviewResult in LoreTask status [DEPENDS ON: T002, T004]
- [ ] T006 Pass GH_TOKEN env to Job pod for `gh` CLI auth — use same token secret as GITHUB_TOKEN [DEPENDS ON: T001]

## Phase 3: Watcher Loop

- [ ] T007 Add `shouldAutoReview(repo)` helper to `agent/src/jobs/loretask-watcher.ts` — read lore.repos.settings JSONB for auto_review flag
- [ ] T008 Trigger review LoreTask after implementation PR — in watcher Succeeded handler, if auto_review enabled, create review pipeline task + LoreTask CR with review prompt, link via parentTaskId [DEPENDS ON: T004, T007]
- [ ] T009 Handle review LoreTask completion — in watcher, detect Succeeded review CRs: if approved update parent task status, if changes-requested check iteration count, create new implementation LoreTask with feedback or escalate with needs-human-review label [DEPENDS ON: T005, T008]

## Phase 4: Config + Polish

- [ ] T010 [P] Update `scripts/task-types.yaml` — review type gets execution_mode: claude-code, updated prompt template with structured output format
- [ ] T011 [P] Add auto_review toggle to repo settings UI `web-ui/src/app/repos/[name]/settings/page.tsx` or equivalent settings page
- [ ] T012 End-to-end test — submit implementation task on repo with auto_review=true, verify: implementation Job → PR → review Job → comments posted → result detected [DEPENDS ON: T009, T010]
