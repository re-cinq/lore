# Task List: Lore merges on protected repos, and every PR knows what blocks it

| Field   | Value                                                             |
| ------- | ----------------------------------------------------------------- |
| Feature | Lore merges on protected repos, and every PR knows what blocks it |
| Spec    | [spec.md](./spec.md)                                             |
| Plan    | [plan.md](./plan.md)                                             |
| Created | 2026-10-07                                                        |

Decision: Build Option A first, behind `auto_merge.approver = none | lore-reviewer`, with Option C as what a repo gets with `approver = none`, and leave Option D for later. The ruleset requires one approval, review from Code Owners, and the required CI checks. ADR-050 is accepted once the prototype has been shown on 2026-10-09. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#d9fc30d4-669a-4121-b582-4efda0ddda66))

Delivery order: (1) lore-reviewer: the second App, the review line running on Lore's own PRs, the branch-rule and mergeability reads, arming native auto-merge before the post-review station approves as lore-reviewer, and the `auto_merge.approver` setting, first demonstrated on 2026-10-09. (2) The blocked-reason surface and refusal classification; due by 2026-10-31, before the first KPI deadline on 2026-11-15. (3) Dependency ordering and the base-drift update; due by 2026-12-15. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_2ede3ddb-c03c-4788-bc6c-41d56e40b5bf))

Dependencies below are the build order inside a phase: a task marked `[P]` has no unfinished prerequisite and runs beside its phase-peers; a task with `(depends on …)` waits for those. Two tasks that edit the same file are chained, never parallel.

## Story Map

| Step | Theme                    | Due          | KPI gate     |
| ---- | ------------------------ | ------------ | ------------ |
| 1    | lore-reviewer + arming   | 2026-10-09   | SC-001 armed |
| 2    | Blocked-reason surface   | 2026-10-31   | SC-002, SC-003, SC-004 |
| 3    | Dependency + base-drift  | 2026-12-15   | SC-002       |

## Phase 1 — lore-reviewer App, arming, approver setting, ADR-050

Prototype due 2026-10-09.

Org-admin steps done by hand before step 1 can run: create and install lore-reviewer, add its credentials through the four-place secret procedure, create the pilot's ruleset and CODEOWNERS, and enable "Allow auto-merge". For this repo, the same person adds one `@user` handle to CODEOWNERS beside the team handles, so the two-key ceremony can resolve an approver here. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_4e94ffd5-c86f-4442-a599-8b2a39cefb47))

No new onboarding step: a repo opts in from its settings page in Lore, which links to GitHub's install page for lore-reviewer on that repo — GitHub only lets an org owner, or a repo admin the org allows, approve an App install, so Lore links rather than installing silently. Lore saves `auto_merge.approver = lore-reviewer` only once it confirms the installation and a ruleset requiring one approval, review from Code Owners and the required CI checks are in place; until then the repo runs with `approver = none` and the settings page names what is missing. Any repo can opt in; none gets lore-reviewer by default. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_2e69534a-8fd3-49cb-93f7-bd7bc612972d))

PR 2224 is closed as superseded. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_0ee9bc55-2189-479a-85c9-bc792986273d))

- [ ] T001 **ADR-050 accepted** — `adrs/ADR-050-protected-branch-approver.md` already lands with this spec PR as a draft. After the prototype demo, flip its status to accepted and record the demo date; no other change. (depends on T008)
- [ ] T002 [P] **`auto_merge.approver` field and its two-key gate** — Add `auto_merge.approver: none | lore-reviewer` (default `none`) to `RepoSettingsSchema` in `libs/shared/src/domain/models/repo-settings.ts`. Extend `twoKeyFieldsTouched` to flag it, and extend the `checkApproval` gate in `apps/lore-api/src/transport/routes/two-key.ts` from agent-definition image writes to the repo-settings PUT that sets it. The approval PR carries the `dark-factory-approval` label and needs at least one `@user` handle in CODEOWNERS.
- [ ] T003 [P] **`decideReviewOnOpen` lets Lore's own App through** — Read Lore's App login once at startup with `GET /app` under the App's JWT (the App slug plus the `[bot]` suffix), hold it in memory for the life of the process, and let a PR by that author through `decideReviewOnOpen` in `libs/shared/src/work/review/code-review-decisions.ts`; every other `[bot]` suffix still fails. No login is hardcoded.
- [ ] T004 [P] **PR port — three new reads** — Add `getBranchRule` (rulesets and classic protection: required approvals, Code Owners review, required checks), `getMergeability`, and `getChangedFiles` (matched against CODEOWNERS to tell a sensitive PR from a routine one) to `libs/shared/src/outbound/project/lib/platform-github.ts`.
- [ ] T005 **PR port — three new writes** — Add `enablePullRequestAutoMerge(prId, mergeMethod)` (GraphQL), `disablePullRequestAutoMerge(prId)` (GraphQL) and `updateIssueComment(commentId, body)` (REST PATCH) to the same port file. (depends on T004)
- [ ] T016 **Approver save path** — In the repo-settings save path in `apps/lore-api`: on a change to `lore-reviewer`, confirm the App installation and, through `getBranchRule`, a ruleset requiring one approval, review from Code Owners and the required CI checks; refuse otherwise, naming what is missing, and leave the repo on `none`. On a change to `none`, list the repo's open PRs opened by Lore's App, call `disablePullRequestAutoMerge` on each one that is armed, and write one `auto_merge_disarmed` audit row per PR, before writing the new setting. (depends on T002, T004, T005)
- [ ] T017 **Settings page offers the approver switch** — In `apps/web-ui`, the repo settings page shows `auto_merge.approver`, links to GitHub's install page for lore-reviewer on that repo, and shows what the save path said is missing when it refused. (depends on T016)
- [ ] T006 **Post-review station arms, then approves** — Extend `apps/stations/src/code-review/post-review/`: (1) read the branch rule and the repo's `auto_merge.approver`; (2) where the rule requires an approval, call `enablePullRequestAutoMerge` with `SQUASH` first, idempotent per PR state, and write an `auto_merge_armed` audit row; (3) only where `approver = lore-reviewer`, submit the APPROVE as lore-reviewer and write a `lore_reviewer_approved` audit row with `{ prNumber, headSha, approver }`. Where `approver = none`, Lore arms and does not approve: a person gives the approval, and GitHub refuses one from the App that opened the PR. Arming never happens on an unprotected branch. (depends on T002, T003, T004, T005)
- [ ] T018 **Retire the automerge label workflow where Lore arms** — Remove `.github/workflows/auto-merge.yml` from this repo once T006 arms auto-merge itself, so arming no longer depends on who may label a PR; the runbook step covers other repos. (depends on T006)
- [ ] T007 **KPI view and route** — Create the SQL view `pipeline.v_auto_merge_kpis` over `pipeline.audit_log` (the `lore_reviewer_approved` and `auto_merge_armed` rows from T006, with columns for the `pr_merged` rows T013 adds, empty until step 2) and add `GET /api/repos/{owner}/{repo}/auto-merge/kpis` (read scope) in `apps/lore-api`. (depends on T006)
- [ ] T008 **Prototype demo, three PRs** — On 2026-10-09, on one throwaway repo with the runbook's ruleset, CODEOWNERS (`.github/**`, the agent-instruction floor, one escalate path, nothing else), "Allow auto-merge" on, lore-reviewer installed and `auto_merge.approver = lore-reviewer`: (1) a routine PR, approved by lore-reviewer and merged by GitHub with no human click; (2) a PR touching `CLAUDE.md`, also approved by lore-reviewer, held by GitHub until a code owner approves, then merged with exactly one click; (3) a PR touching a workflow file, held the same way. Each approval is recorded on the PR under the identity that gave it, and the audit rows name the approver. (depends on T003, T006, T016, T017, T018)

## Phase 2 — Blocked-reason surface and refusal classification

Due 2026-10-31.

The blocked-reason vocabulary reaches the Slack plan, the run page and the audit-log queries. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_5d21e6e9-d2d4-48f9-9885-c07ac3961226))

Org-admin step before T009 can deliver: subscribe Lore's existing App to the `check_suite` and `push` webhook events, which the new mappers expect.

- [ ] T009 [P] **Event mappers for check_suite and push** — Add `check_suite` and `push` to `EVENT_MAPPERS` and `GITHUB_EVENT_NAMES` in `libs/shared/src/outbound/project/events/github-map.ts`, and to the stations service's subscription list.
- [ ] T010 [P] **Migration: `pipeline.pr_blocked_reasons`** — Write the next numbered migration under `charts/ui-helm/migrations`: table `(repo, pr_number, reason, detail, since, updated_at)`, one row per open PR Lore watches, and the 30-day purge of rows whose PR merged or closed.
- [ ] T012 **Blocked-reason read routes** — Add `GET /api/repos/{owner}/{repo}/pulls/{number}/blocked-reason` (answering `{ repo, prNumber, reason, label, detail, since, updatedAt }`, `reason` null when nothing blocks the PR) and `GET /api/repos/{owner}/{repo}/blocked-pulls` (`{ pulls: [that shape] }`, blocked PRs only), both read scope, served from `pipeline.pr_blocked_reasons`. (depends on T010)
- [ ] T011 **Blocked-reason station** — Create `apps/stations/src/blocked-reason/` with its `layers.yaml` entry and imports block. It runs from the bus on `pull_request` (opened, synchronize, ready_for_review, closed), `pull_request_review` submitted, `check_suite` completed and `push` to the base branch; derives exactly one reason per PR from the fixed vocabulary (`waiting_on_ci`, `required_check_missing`, `needs_approval`, `needs_code_owner`, `base_behind`, `blocked_by_pr`, `review_in_flight`, `merge_conflict`, `github_refused`); writes `pipeline.pr_blocked_reasons` and one `pr_blocked_reason` audit row per change; edits one PR comment in place through `updateIssueComment`, carrying `<!-- lore:blocked-reason -->`; resolves the PR to its task through the `Lore-Task` trailer and edits the backlog issue's one comment the same way; surfaces `github_refused` on the first named refusal and after 3 consecutive unclassified ones, reset by any other outcome. Idempotent on re-delivery. (depends on T005, T009, T010)
- [ ] T013 **`pr_merged` audit rows feed the KPI view** — In the station's `pull_request.closed` handler with `merged: true`, write a `pr_merged` audit row `{ prNumber, mergedAt, taskId (null for a PR with no task), sensitivePaths (computed through `getChangedFiles` against CODEOWNERS), approvedBy (from the PR's reviews) }`, and extend `pipeline.v_auto_merge_kpis` so SC-002 and SC-004 read from those rows. (depends on T011, T004, T007)
- [ ] T019 **Run page and PR list show the blocked reason** — In `apps/web-ui`, the settled run's page reads the per-PR route and shows the reason under its PR, and the repo's pull-request list reads `blocked-pulls` and shows one line per blocked PR, both updating as the reason changes. (depends on T012)

## Phase 3 — Dependency ordering and base-drift update

Due 2026-12-15.

- [ ] T014 **Dependency-aware merge ordering** — In the blocked-reason station: a PR whose `depends_on` sibling in the same task group has an unmerged PR gets `blocked_by_pr`, re-evaluated when that sibling's `pull_request.closed` arrives with `merged: true`; a dependency closed without merging holds `blocked_by_pr` until a person decides. Arming follows `depends_on` order, then PR creation time, within a task group; dispatch stays at task completed. (depends on T011, T013)
- [ ] T015 **Base-drift update by merge commit** — Add `updateBranch(prNumber)` to the PR port (GitHub's update-branch call, a merge commit, never a rebase). On `base_behind`, the station calls it; the required checks run again on the resulting commit; where the branch rule dismisses stale approvals, the review line reruns so lore-reviewer re-approves, and a sensitive PR needs its code owner again. Change the `base_behind` label from "Behind {base}; needs the base merged in" to "Behind {base}; Lore is updating it" in the same change. (depends on T011, T004, T006)
