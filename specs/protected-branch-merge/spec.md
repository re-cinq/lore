# Feature Specification: Lore merges on protected repos, and every PR knows what blocks it

| Field   | Value                                                             |
| ------- | ----------------------------------------------------------------- |
| Feature | Lore merges on protected repos, and every PR knows what blocks it |
| Branch  | feat/protected-branch-merge                                       |
| Status  | Draft                                                             |
| Created | 2026-10-07                                                        |
| Owner   | Platform Engineering                                              |

Lore opens pull requests but on a protected repo nothing it does can merge them. This spec defines the lore-reviewer App, GitHub native auto-merge arming, blocked-reason surface, dependency-aware merge ordering, and the KPI tracking that replaces the retired Floor-based auto-merge. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#43713d28-5f9b-4010-af24-d924d38f4ec8))

## Problem Statement

Lore opens pull requests, but on a repo that protects its main branch nothing it does can merge them. GitHub will not count an approval from the account that opened the PR, and since Lore's own Floor and its dark-factory auto-merge were retired on 2026-10-02 (#2431), nothing in Lore merges a PR at all. Today a person reads every Lore PR, approves it and clicks merge, and what was checked is recorded only in whatever they happen to leave behind. We want Lore to merge routine changes on protected repos without a human click, to leave sensitive changes to a human approval every time, and to have GitHub, not Lore, enforce and record that difference. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#43713d28-5f9b-4010-af24-d924d38f4ec8))

Lore's own Floor (`apps/floor`) was deleted on 2026-10-02 (#2431), and with it the dark-factory auto-merge evaluation, which never ran on any repo. The per-repo dark_factory settings, their route and their tab were deleted the same day (#2445). Nothing in Lore merges a pull request today; the merge line (`floor-pipelines/merge.yaml`) runs only after a merge. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_bb5ddf7e-20ba-4634-b813-dbc06af53edf))

Review runs on the external floor. The code-review line ends in Lore's post-review station (`apps/stations/src/code-review/post-review`), which submits APPROVE or REQUEST_CHANGES and steps down to a COMMENT review only because GitHub refuses an approval from the App that authored the PR. The verdict also lands on the `lore/code-review` check run. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_b77c6a52-a240-4ad9-88d4-462a8ec7e6bd))

The PR port (`libs/shared/src/outbound/project/lib/platform-github.ts`) authenticates as one GitHub App. It can review, comment, label and merge, but has no call to enable GitHub's native auto-merge (GraphQL `enablePullRequestAutoMerge`), no branch-rule read and no mergeability read. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_205d2e9d-9178-4721-8ff4-20020995aa2f))

This repo arms native auto-merge with a workflow: adding the `automerge` label runs `gh pr merge --auto` (`.github/workflows/auto-merge.yml`). Anyone allowed to label a PR can arm it, and GitHub then merges once the branch rule is satisfied, so the label is only as strong as the rule behind it. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_de5ca40a-bfce-4b7b-ae89-c9bb8608e65c))

That rule does not require an approval today: agent-generated PR 2064 merged with no review recorded, because the review line skips PRs opened by Lore's App. PR 2065 shows the review loop correcting work (the review bot requested changes, the author fixed them, the bot approved, a person merged), but no approval GitHub enforced. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#21d0253f-e6b8-45ca-a6f4-5cb693760851))

PR 2224 (`escalate_paths`, `auto_merge.enabled`) targets the deleted Floor code and is superseded: escalate paths become CODEOWNERS entries that GitHub enforces. Its draft ADR-049 clashes with ADR-049-external-floor on main, so this decision is recorded as ADR-050. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_d9110a41-a9b6-48d3-97ee-9ac0d2af7cec))

The implementation loop (`floor-pipelines/implementation-loop.yaml`) waits for green CI and resolved review threads and never merges. The old escalation line was retired with the Floor, so nothing tells a person when a PR is stuck. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_a5c91be7-b8bf-4ef8-a44b-27e46e69c550))

We also want every Lore PR to know what is holding it up: CI, a required check that never ran, a missing human approval, a sibling PR that must land first, or a base branch that moved. Today these all look the same, a PR that is not merging. Naming the blocker turns a stalled line into a queue a team can work, and gives the Slack plan something truthful to announce. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#68f6d704-5ab1-4604-8fdc-4807f379db2d))

## lore-reviewer App — identity and per-repo opt-in

lore-reviewer is a second GitHub App whose only job is to approve. Lore first arms GitHub's native auto-merge on the PR, while the branch rule still requires an approval, and then the post-review station submits its APPROVE as lore-reviewer, so GitHub counts it. The order matters: GitHub refuses to arm auto-merge on a PR that can already merge. GitHub merges once the branch rule is satisfied; Lore never calls merge. Lore passes `mergeMethod: SQUASH` to `enablePullRequestAutoMerge`, the method the automerge label workflow already uses, so the switch changes nothing about history or CI. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_0fb6ce5d-602d-4f29-99aa-3bc62a13b6f2))

The review line starts on PRs opened by Lore's own App. Today `decideReviewOnOpen` (`libs/shared/src/work/review/code-review-decisions.ts`) skips every PR whose author ends in `[bot]`, re-checks included, so no Lore-authored PR is ever reviewed on its own and lore-reviewer would never be asked to approve. Lore's App is let through; every other bot stays skipped. Lore's App is recognised by its own login, read once at startup with `GET /app` under the App's JWT (the App slug plus the `[bot]` suffix) and held in memory for the life of the process, so no login is hardcoded and every other bot still fails the plain `[bot]` suffix check. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#fe939733-53d6-4cde-a143-761995766fd3))

A per-repo setting `auto_merge.approver = none | lore-reviewer` lives in `lore.repos.settings`, off by default. To switch to lore-reviewer, the repo's settings page in Lore links to GitHub's App install page; Lore saves the setting only once it confirms the installation and a ruleset requiring one approval, review from Code Owners and the required CI checks — until then the repo stays on `none` and the settings page names what is missing. Any repo can opt in; none gets lore-reviewer by default. With `none`, a person approves and Lore arms auto-merge without lore-reviewer approving. Turning lore-reviewer on also goes through the two-key ceremony (admin scope plus a CODEOWNER approval PR). The setting is a new `auto_merge.approver` field on `RepoSettingsSchema` in `libs/shared/src/domain/models/repo-settings.ts`. The two-key gate is the existing `checkApproval` in `apps/lore-api/src/transport/routes/two-key.ts`, extended to the repo-settings PUT that sets `auto_merge.approver`. The approval PR carries the `dark-factory-approval` label. The ceremony resolves approvers from CODEOWNERS entries that name people, so the file must list at least one `@user` handle beside the team handles. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_11a16252-0386-4b7e-a94b-b04fb35431f6))

What any approver option has to satisfy: an approval GitHub counts for the branch rule; the author App cannot be the approver; sensitive PRs must always end with a human approval; and the rule must be enforced by GitHub, not only by Lore. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#6b9e9b58-4fba-49d9-8e21-c610aa1de70f))

## Arming GitHub native auto-merge

Three new reads are added to the PR port (`libs/shared/src/outbound/project/lib/platform-github.ts`): the branch rule (rulesets and classic protection: required approvals, Code Owners review, required checks), the PR's mergeability, and the PR's changed files, which Lore matches against CODEOWNERS to tell a sensitive PR from a routine one. Lore uses them to decide where it may arm auto-merge, to confirm a repo's ruleset before saving `approver = lore-reviewer`, and to derive blocked reasons. Two new writes join the port, the only mutations this plan adds: `enablePullRequestAutoMerge` (with mergeMethod) and `disablePullRequestAutoMerge`, both GraphQL. A third write updates an existing issue or PR comment in place, which the blocked-reason marker needs; today the port only creates comments. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#4c893409-6504-4075-848f-01d4151dca9d))

Native auto-merge is armed only where the branch rule requires an approval, never on an unprotected branch, and always before lore-reviewer approves, because GitHub refuses to arm a PR that can already merge. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_c3919542-5ccb-49bd-a19b-ee275739aa4a))

Lore never merges. It approves as lore-reviewer and arms GitHub's native auto-merge; GitHub performs the merge and enforces the branch rule. No pod holds merge authority. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_4f610c67-8d33-44e4-b3ab-5e51b32276ac))

The automerge label workflow is retired on repos where Lore arms auto-merge itself, so arming no longer depends on who may label a PR. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_ae022c06-e581-49f6-97c8-dc30d5438e2d))

## Sensitive-path detection via CODEOWNERS

The branch rule that makes this safe: one required approval, review from Code Owners, and the required CI checks. CODEOWNERS lists only the sensitive paths: workflow and gate files (`.github/**`, `CODEOWNERS`), the agent-instruction floor (`**/CLAUDE.md`, `**/AGENTS.md`, `**/GEMINI.md`, `**/.claude/**`, `**/.gemini/**`) and each repo's escalate paths. A GitHub App cannot be a code owner, so lore-reviewer can approve a routine PR but never a sensitive one: GitHub enforces the human approval and records who gave it. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_ca050897-badb-4bd1-b0ce-52b625b9329b))

CODEOWNERS lists exactly the sensitive paths: workflow and gate files, the agent-instruction floor, each repo's escalate paths and the CODEOWNERS file itself. A path left out is guarded only by review; a path added beyond them needs a human code owner, so routine PRs touching it stop merging unattended. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_626bcd93-ef22-482a-b0b3-f249b6dfc958))

CODEOWNERS on this repo names owners for `CLAUDE.md`, `AGENTS.md`, `adrs/`, `runbooks/`, `scripts/`, `mcp-server/` and `.github/`. Without a rule requiring Code Owner review it only requests reviewers; the branch ruleset and CODEOWNERS file are created as org-admin steps before lore-reviewer can run. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_ef73e5ca-d32c-40cc-b15f-af010db4c5c5))

The design relies on GitHub Apps being ineligible as code owners. If GitHub changes that, the separation must be reconsidered. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_1ddedf90-07aa-4cdb-85a9-e6b40b2120fe))

## Blocked-reason surface

One derived blocked reason per Lore PR: waiting on CI, required check missing, needs code-owner approval, base behind, blocked by a sibling PR, review in flight, merge conflict, or a classified GitHub refusal. Stored in its own per-PR record keyed by repo and PR number, not on the task row (most PRs carry no task). Written to the audit log and as one idempotent PR comment per reason change, and read through one lore-api route per PR and per repo that the UI, the Slack plan, the run page and the backlog ticket all consume. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_d64bfae3-dc32-4628-b1f5-827991607316))

### Reason codes and labels

Each reason has a code and the label Lore shows: `waiting_on_ci` "Waiting for CI"; `required_check_missing` "A required check has not run: {check}"; `needs_approval` "Needs one approval"; `needs_code_owner` "Needs a code owner's approval"; `base_behind` "Behind {base}; needs the base merged in"; `blocked_by_pr` "Waiting for #{pr} to merge first"; `review_in_flight` "Lore's review is still running"; `merge_conflict` "Conflicts with {base}"; `github_refused` "GitHub refused the merge: {message}". The PR comment reads "Not merging yet: {label}. Lore updates this comment when the reason changes." and carries the marker `<!-- lore:blocked-reason -->`, so it is edited in place and never posted twice. Until step 3 ships, `base_behind` only names the condition; from step 3 Lore performs the update itself and the label reads "Behind {base}; Lore is updating it". ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#501c6706-685b-436e-9ecd-ea9a144ced20))

### pipeline.pr_blocked_reasons table

A new table `pipeline.pr_blocked_reasons` (`repo`, `pr_number`, `reason`, `detail`, `since`, `updated_at`), one row per open PR Lore watches. It holds reason codes and GitHub's refusal message, never PR content. A row is deleted 30 days after its PR merges or closes. Read through `GET /api/repos/{owner}/{repo}/pulls/{number}/blocked-reason`, answering `{ repo, prNumber, reason, label, detail, since, updatedAt }` with `reason` null when nothing blocks the PR, and `GET /api/repos/{owner}/{repo}/blocked-pulls`, answering `{ pulls: [that shape] }` for blocked PRs only; both need read scope. Each change also writes one `pipeline.audit_log` row, `event_type` `pr_blocked_reason`, payload `{ prNumber, from, to, detail }`. The table and its 30-day purge arrive as the next numbered migration under `charts/ui-helm/migrations`. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#48ce99a3-5ffb-4d5a-a9e7-56a29626a89f))

### blocked-reason station

The blocked-reason surface is delivered by one blocked-reason service station under `apps/stations/src/blocked-reason`, run by the stations service from the bus on the GitHub webhooks it already receives (`pull_request` opened, synchronize, ready_for_review and closed; `pull_request_review` submitted; `check_suite` completed; and a push to the base branch), which writes the per-PR record. The run page and the backlog ticket read it through the per-PR route, so no new node joins the line's walk. Two of those events reach the bus only once they are mapped: `check_suite` and `push` join `EVENT_MAPPERS` and `GITHUB_EVENT_NAMES` in `libs/shared/src/outbound/project/events/github-map.ts` and the stations service's subscription list. The station lives in its own folder with its entry in `layers.yaml` and its own imports block, as the assembly-line guide requires. The same station writes the backlog issue comment: it resolves the PR to its task through the `Lore-Task` trailer and to the task's issue, and edits the one comment carrying the marker. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#7f02b5ad-eec8-42ef-9747-28a03649c4ab))

The backlog line knows why its PR is not merging and shows it, without holding the repo's backlog slot. The run still settles once the PR is green with no unresolved threads and marked ready, which releases the slot so the next ticket starts. From then on the backlog issue carries the PR's current blocked reason as one comment, edited in place with the same text and marker as the PR comment, and the settled run's page shows it from the per-PR record, both updated as it changes, until GitHub merges the PR and the ticket is marked done. A PR waiting on a person stays on the ticket with its reason; it never stalls the backlog. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#7f02b5ad-eec8-42ef-9747-28a03649c4ab))

### API routes

Blocked reason lives in a separate per-repo PR-state endpoint that the UI and Slack plan query: `GET /api/repos/{owner}/{repo}/pulls/{number}/blocked-reason` and `GET /api/repos/{owner}/{repo}/blocked-pulls`, both needing read scope and served from `pipeline.pr_blocked_reasons`. This is not a field on the task row or the run row. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#q-blocked-reason-api-shape))

### Audit events

Approvals are recorded twice: on the PR as a review under lore-reviewer's identity, and as one `pipeline.audit_log` row per approval and per arming, `event_type` `lore_reviewer_approved` or `auto_merge_armed`, payload `{ prNumber, headSha, approver }`. The same blocked-reason station writes the `pr_merged` row (`event_type` `pr_merged`, payload `{ prNumber, mergedAt, taskId` (null for a PR with no task)`, sensitivePaths, approvedBy }`) when `pull_request` closed arrives with `merged` true; that row is what the KPI views count. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#e402ac83-2582-41bd-a87b-058523e88b95))

## Merge-refusal classification

A named refusal is reported on its first occurrence, an unclassified one after 3 in a row, counted per PR and reset by any other outcome. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_a0edebf1-10d8-459a-8e22-69b940ce8d55))

Three consecutive unclassified `github_refused` retries per PR are the threshold before the reason surfaces; any other outcome (a successful merge, a CI update, a new review) resets the count to zero. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#q-api-failure-retries))

## Dependency-aware merging

Dependency-aware merging inside a task group: dispatch stays at task completed; Lore arms auto-merge on a PR only once its dependency's PR has merged, and a dependency closed without merging blocks its dependents until a person decides. Updating a branch that fell behind its base with GitHub's update-branch call, which merges the base into the branch as a merge commit, with the required checks run again on that commit. If the branch rule dismisses stale approvals on push, lore-reviewer re-approves when the review line reruns; a sensitive PR requires its code owner to approve again. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_15265048-f8a1-4562-8238-f783d91b74e9))

Dependencies: today a spec-task's `depends_on` is satisfied when the dependency task is completed or merged (`task-queue-pg-spec-tasks.ts`), so a dependent can start before its dependency's PR lands. Issue `blocked_by` links only steer the backlog picker (`implementation-loop-tick.ts`). There is no PR-to-PR ordering inside a `task_group_id`, no update-branch before merge and no GitHub merge-queue support. This plan adds that ordering. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_84caf514-fee0-424d-9556-27bcbf730d23))

A PR whose dependency in the same task group has an unmerged open PR receives `blocked_by_pr` and is re-evaluated when that dependency's `pull_request.closed` arrives with `merged: true`. A dependency closed without merging blocks its dependents with `blocked_by_pr` until a person decides. Merge order within a task group: `depends_on` order, then by PR creation time. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#q-dependency-semantics))

Dispatch stays at "task completed"; arming auto-merge is separate from dispatch and waits on the dependency. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#q-dependency-semantics))

## Base-drift update

A branch that falls behind its base is updated using GitHub's update-branch API (a merge commit, not a rebase). The required CI checks run again on the resulting commit. The branch rule's dismiss-stale-approvals setting causes lore-reviewer to re-approve once the review line reruns on the pushed commit; a sensitive PR requires its code owner to approve again. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#q-update-branch-method))

## KPI view and route

`pipeline.v_auto_merge_kpis` is a SQL view over `pipeline.audit_log`, read through `GET /api/repos/{owner}/{repo}/auto-merge/kpis` (read scope). It is the named source for all four KPIs. The view ships with the audit rows in step 1.

## Success Criteria

**SC-001** — On a repo with a ruleset requiring one approval, review from Code Owners and the CI check, and `approver` set to `lore-reviewer`, a Lore PR on routine paths merges with no human click and the audit row names the approver identity. Metric: share of such PRs merged with no human click. Baseline: 0% (merge refused, 422). Target: 95%. Direction: up. Deadline: 2026-12-31. Source: `pipeline.v_auto_merge_kpis` over `lore_reviewer_approved` rows, read through `GET /api/repos/{owner}/{repo}/auto-merge/kpis`. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#k-auto-merge-routine))

**SC-002** — A dependent PR never merges before its dependency in the same task group. Metric: dependent PRs in a task group merged before their dependency. Baseline: unmeasured, possible today. Target: 0. Direction: hold. Deadline: 2026-12-15. Source: `pipeline.v_auto_merge_kpis` over `pr_merged` rows joined to each task's `depends_on`, read through the same route. The `pr_merged` rows begin in step 2, so this KPI reads zero until the blocked-reason station ships. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#k-dependency-order))

**SC-003** — Every Lore PR that cannot merge shows a human-readable reason on the PR and in the audit log. Metric: Lore PRs that are not mergeable and show no reason. Baseline: 100% (nothing reports a reason today). Target: 0. Direction: down. Deadline: 2026-11-15. Source: `pipeline.pr_blocked_reasons` through `GET /api/repos/{owner}/{repo}/blocked-pulls`, compared against the PR port's mergeability read. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#k-api-failure-visibility))

**SC-004** — A Lore PR that touches a sensitive path (workflow and gate files, agent instructions, escalate paths) ends with a code owner's approval and GitHub's auto-merge, never a Lore or lore-reviewer approval. Metric: such PRs merged without a code owner's approval. Baseline: n/a, they never merge today. Target: 0. Direction: hold. Deadline: 2026-11-15. GitHub enforces this through the Code Owners rule, not Lore. Source: `pipeline.v_auto_merge_kpis` over `pr_merged` rows whose payload carries `sensitivePaths` and `approvedBy`, read through the same route. The `pr_merged` rows begin in step 2, so this KPI reads zero until the blocked-reason station ships. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#k-auto-merge-escalated))

## Compliance Requirements

- The review line runs again on every push, so approving, arming and commenting each carry an idempotency key and happen once per PR state. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_a928dff4-4235-4284-8050-a69c46076706))
- Turning `auto_merge.approver` on is two-key (admin scope plus a CODEOWNER approval PR), which needs a CODEOWNERS file covering `CLAUDE.md`. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_e9bcb5f9-5511-4691-85cc-acb66dcd6cca))
- lore-reviewer's private key lives in Secret Manager and reaches the stations service through ESO (ADR-046); the terraform apply lands before any chart references it. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_c7ad479f-84fc-4512-825d-6d38ae3aafd9))

## Out of Scope

Slack messages, the morning queue and `/lore queue`: the sibling plan "Slack tells people, in plain words, when Lore needs them". Branch `feat/review-queue` holds a draft spec and an 11-task plan for Slack alerts on human-only outcomes and a daily queue message; this plan exposes the data it needs (blocked reason per PR) and does not duplicate the Slack side. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_4aafe350-c4f8-4190-9120-7a6c09929725), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_182f9370-4417-4661-939d-90db0e61a19c))

Picking reviewers. GitHub requests code owners on its own. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_e66aa75d-2e5a-41d3-9301-bf4c762e78ee))

Rebuilding a merge engine in Lore. GitHub performs every merge. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_a763b688-4fb5-4b1f-8c52-ed55f85c906d))

An internal merge queue. GitHub's merge queue is a later option. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_a463fa41-8c77-4f34-85bc-1eda28f532bc))

PR 2224 (superseded by CODEOWNERS). ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_8597c640-c5c7-4575-8bbe-36c04335d1fd))

The org-admin runbook covers App creation and install, the four-place secret procedure, the ruleset, CODEOWNERS and "Allow auto-merge". ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_e0b08a95-0b0f-41dc-8fd1-3dec5f614077))

## Open Questions

**Q: Do we agree with the recommendation to start with Option C (arm native auto-merge) and then build Option A (Second-App approver), leaving Option D (merge queue) for later?** ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#q-approve-recommendation))

Settled: Build Option A first, behind `auto_merge.approver = none | lore-reviewer`, with Option C as what a repo gets with `approver = none`, and leave Option D for later. See ADR-050.

**Q: How many consecutive api_failure retries (N) should we allow before escalating through the escalation line with an `auto_merge_blocked` reason?** ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#q-api-failure-retries))

Settled: 3 consecutive unclassified refusals per PR before the `github_refused` reason surfaces; any other outcome resets the count.

**Q: Do we agree with the recommendation for dependency semantics: keep dispatch at completed (parallel work), but make the merge decision wait for the dependency's PR to merge?** ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#q-dependency-semantics))

Settled: Yes. Dispatch stays at "task completed"; merge waits for the dependency's PR. A dependency closed without merging blocks dependents with `blocked_by_pr` until a person decides. Merge order: `depends_on` order, then by PR creation time.
