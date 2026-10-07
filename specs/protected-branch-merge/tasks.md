# Task List: Lore merges on protected repos, and every PR knows what blocks it

| Field   | Value                                                             |
| ------- | ----------------------------------------------------------------- |
| Feature | Lore merges on protected repos, and every PR knows what blocks it |
| Spec    | [spec.md](./spec.md)                                             |
| Plan    | [plan.md](./plan.md)                                             |
| Created | 2026-10-07                                                        |

Decision: Build Option A first, behind `auto_merge.approver = none | lore-reviewer`, with Option C as what a repo gets with `approver = none`, and leave Option D for later. The ruleset requires one approval, review from Code Owners, and the required CI checks. ADR-050 is accepted once the prototype has been shown on 2026-10-09. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#d9fc30d4-669a-4121-b582-4efda0ddda66))

Delivery order: (1) lore-reviewer: the second App, the review line running on Lore's own PRs, the branch-rule and mergeability reads, arming native auto-merge before the post-review station approves as lore-reviewer, and the `auto_merge.approver` setting, first demonstrated on 2026-10-09. (2) The blocked-reason surface and refusal classification; due by 2026-10-31, before the first KPI deadline on 2026-11-15. (3) Dependency ordering and the base-drift update; due by 2026-12-15. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_2ede3ddb-c03c-4788-bc6c-41d56e40b5bf))

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

- [ ] T001 [P] **ADR-050** — Write `adrs/ADR-050-protected-branch-approver.md` recording the Option A decision; accepted at prototype demo 2026-10-09.
- [ ] T002 [P] **`auto_merge.approver` field** — Add `auto_merge.approver: none | lore-reviewer` to `RepoSettingsSchema` in `libs/shared/src/domain/models/repo-settings.ts`. Extend `twoKeyFieldsTouched` to flag it. Add save-path validation (confirm lore-reviewer installed + branch rule requirements). Add disarm-on-none: call `disablePullRequestAutoMerge` on open Lore PRs and write `auto_merge_disarmed` audit rows. Add settings-page link to GitHub App install page.
- [ ] T003 [P] **`decideReviewOnOpen` gate fix** — Read Lore's App login at startup with `GET /app` (JWT), hold in memory. Let it through `decideReviewOnOpen`; every other `[bot]` suffix still fails.
- [ ] T004 [P] **PR port — new reads** — Add `getBranchRule` (rulesets + classic protection), `getMergeability`, `getChangedFiles` to `libs/shared/src/outbound/project/lib/platform-github.ts`.
- [ ] T005 [P] **PR port — new writes** — Add `enablePullRequestAutoMerge(prId, mergeMethod)` (GraphQL), `disablePullRequestAutoMerge(prId)` (GraphQL), `updateIssueComment(commentId, body)` (REST PATCH) to the same port.
- [ ] T006 [P] **Post-review station — arm + approve** — Extend `apps/stations/src/code-review/post-review/` to: (1) read branch rule; (2) call `enablePullRequestAutoMerge(SQUASH)` on repos where `auto_merge.approver` is set and the rule requires an approval (arm before approve, idempotent per PR state); (3) submit APPROVE as lore-reviewer (or as Lore's App for `approver = none`). Write `lore_reviewer_approved` and `auto_merge_armed` audit rows.
- [ ] T007 [P] **KPI view + route** — Create `pipeline.v_auto_merge_kpis` SQL view over `pipeline.audit_log`. Add `GET /api/repos/{owner}/{repo}/auto-merge/kpis` route (read scope).
- [ ] T008 [P] **Prototype demo** — Demonstrate on 2026-10-09: a Lore PR on the pilot repo merges with no human click. ADR-050 is accepted at this point.

## Phase 2 — Blocked-reason surface and refusal classification

Due 2026-10-31.

The blocked-reason vocabulary reaches the Slack plan, the run page and the audit-log queries. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_5d21e6e9-d2d4-48f9-9885-c07ac3961226))

- [ ] T009 [P] **Event mappers** — Add `check_suite` and `push` to `EVENT_MAPPERS` and `GITHUB_EVENT_NAMES` in `libs/shared/src/outbound/project/events/github-map.ts`. Subscribe Lore's existing App to these webhook events.
- [ ] T010 [P] **Migration: `pipeline.pr_blocked_reasons`** — Write the next numbered migration under `charts/ui-helm/migrations`: table with `(repo, pr_number, reason, detail, since, updated_at)`, 30-day purge job.
- [ ] T011 [P] **Blocked-reason station** — Create `apps/stations/src/blocked-reason/` with `layers.yaml` entry: subscribes to `pull_request` (opened, synchronize, ready_for_review, closed), `pull_request_review` submitted, `check_suite` completed, `push` to base. Writes `pipeline.pr_blocked_reasons` and `pr_blocked_reason` audit rows. Edits PR comment with `<!-- lore:blocked-reason -->` marker. Edits backlog issue comment with same marker (resolves PR → task via `Lore-Task` trailer). Implements 3-consecutive unclassified-refusal threshold.
- [ ] T012 [P] **API routes** — Add `GET /api/repos/{owner}/{repo}/pulls/{number}/blocked-reason` and `GET /api/repos/{owner}/{repo}/blocked-pulls` routes (read scope), served from `pipeline.pr_blocked_reasons`.
- [ ] T013 [P] **`pr_merged` audit rows** — In the blocked-reason station's `pull_request.closed` handler (with `merged: true`), write `pr_merged` audit rows with `{ prNumber, mergedAt, taskId, sensitivePaths, approvedBy }`.

## Phase 3 — Dependency ordering and base-drift update

Due 2026-12-15.

- [ ] T014 [P] **Dependency-aware merge ordering** — In the blocked-reason station: when a PR has a `depends_on` dependency whose PR is not yet merged, set `blocked_by_pr`. Re-evaluate when the dependency's `pull_request.closed` arrives with `merged: true`. A dependency closed without merging holds `blocked_by_pr` until a person decides. Arm auto-merge in `depends_on` order then by PR creation time within a task group.
- [ ] T015 [P] **Base-drift update** — On `base_behind` detection, call GitHub's update-branch API (merge commit). CI re-runs on the result. If branch rule dismisses stale approvals, trigger review line rerun for lore-reviewer re-approval. Update label from "needs the base merged in" to "Lore is updating it" once step 3 ships.
