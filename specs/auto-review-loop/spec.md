# Feature Specification: Autonomous Review Loop

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
4. Changes requested (iteration < 2): new implementation LoreTask with feedback, same branch
5. Changes requested (iteration >= 2): escalate with `needs-human-review` label
6. Review completes in <5 min
7. Review result visible in pipeline UI
8. Auto-review is opt-in per repo
9. All steps run as ephemeral Job pods — no in-process LLM calls
