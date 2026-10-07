# Implementation Plan: Lore merges on protected repos, and every PR knows what blocks it

| Field   | Value                                                             |
| ------- | ----------------------------------------------------------------- |
| Feature | Lore merges on protected repos, and every PR knows what blocks it |
| Branch  | feat/protected-branch-merge                                       |
| Spec    | [spec.md](./spec.md)                                              |
| Created | 2026-10-07                                                        |

Build Option A first — lore-reviewer as the approver — behind `auto_merge.approver = none | lore-reviewer`, with Option C as what a repo gets with `approver = none`, and leave Option D (GitHub merge queue) for later. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#d9fc30d4-669a-4121-b582-4efda0ddda66))

## Technical Context

| Area                  | Today                                          | After this plan                                              |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| Merge authority       | Person clicks merge                            | GitHub merges on branch-rule satisfaction                    |
| Auto-merge arming     | `automerge` label → workflow `gh pr merge --auto` | `enablePullRequestAutoMerge` GraphQL via post-review station |
| Approval identity     | Review App (author) → stepped down to COMMENT | lore-reviewer App (second identity) submits APPROVE          |
| Sensitive-path guard  | Path-allowlist in dark_factory settings        | CODEOWNERS enforced by GitHub branch rule                    |
| Blocked-reason        | No surface                                     | `pipeline.pr_blocked_reasons`, PR comment, audit log         |
| Dependency ordering   | `depends_on` at task level only                | PR-to-PR ordering within task_group_id                       |

## Constitution Check

| Principle                              | Verdict | Note                                                                       |
| -------------------------------------- | ------- | -------------------------------------------------------------------------- |
| DX-First Delivery                      | Pass    | lore-reviewer wires invisibly; person opts in from settings page           |
| Zero Stored Credentials                | Pass    | Private key in Secret Manager, mirrored by ESO; no long-lived in-process  |
| PR Description Quality Gates           | Pass    | No change to PR description gates                                          |
| Three-Command Interface                | Pass    | No new CLI surface                                                          |
| Single Interface (Lore MCP)            | Pass    | Blocked-reason exposed via lore-api routes                                 |
| Distributed Ownership with CI Gates   | Pass    | Four-place secret procedure; terraform apply before chart change            |
| Architecture Decisions Are Final       | Pass    | ADR-050 records the approver option decision                               |
| Schema-Per-Team Isolation              | Pass    | `pipeline.pr_blocked_reasons` in pipeline schema                           |
| Intelligent Agents Over Mechanical Scripts | Pass | Station reads and decides; no cron polling                               |
| Opt-In Data Collection                 | Pass    | `auto_merge.approver` is off by default; no repo enrolled without consent  |
| Intelligent Memory Lifecycle           | N/A     | No new memory writes                                                       |
| Event-Driven Automation Over Polling   | Pass    | Blocked-reason station reacts to GitHub webhooks                           |

## Approver Option Analysis

What any option has to satisfy: an approval GitHub counts for the branch rule; the author App cannot be the approver; sensitive PRs must always end with a human approval; the rule must be enforced by GitHub, not only by Lore. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#6b9e9b58-4fba-49d9-8e21-c610aa1de70f))

**Option A (chosen)**: A second GitHub App `lore-reviewer` with `pull_requests:write`, `contents:read` and `checks:read`, installed per repo, its App id and private key in Secret Manager, mirrored by ESO into the stations namespace. Lore first arms native auto-merge with its own App, then the post-review station submits its APPROVE as lore-reviewer. With review from Code Owners required, lore-reviewer's approval satisfies routine paths only. Pros: unattended merges for routine PRs, two identities in the audit trail, no bypass list, sensitive-path guarantee lives in GitHub. Cons: one more App to create, install and rotate. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_5f88837a-1fff-4196-a5d9-db36e47140b4))

**Option B** (rejected): Rulesets with Lore's App on the bypass list. The bypass covers every Lore PR, sensitive ones included. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_a39ea074-f8eb-41ca-8ec5-a660f3c49285))

**Option C** (what `approver = none` delivers): Humans approve, Lore arms native auto-merge. A repo gets this with `auto_merge.approver = none` or without the App installed: a person approves, nobody clicks merge. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_14d83942-4551-4f11-812b-58c80ed94911))

**Option D** (deferred): GitHub merge queue. Orthogonal to who approves: it solves ordering and base drift, at the cost of every repo's CI running on `merge_group` events. Later. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_1619d218-e234-408b-995e-d6467d60ca9c))

## Mechanisms

### Trigger wiring

The blocked-reason station (`apps/stations/src/blocked-reason/`) is a service station registered in `layers.yaml` with its own imports block. It subscribes to these GitHub events via `EVENT_MAPPERS` and `GITHUB_EVENT_NAMES` in `libs/shared/src/outbound/project/events/github-map.ts`:

- `pull_request` opened, synchronize, ready_for_review, closed
- `pull_request_review` submitted
- `check_suite` completed
- `push` to the base branch

`check_suite` and `push` are new entries in both `EVENT_MAPPERS` and `GITHUB_EVENT_NAMES` (step 2, first task). The post-review station (`apps/stations/src/code-review/post-review/`) grows the arm-before-approve steps inside its existing station body.

### Data model

**`pipeline.pr_blocked_reasons`** columns:

| Column       | Type        | Notes                                      |
| ------------ | ----------- | ------------------------------------------ |
| `repo`       | text        | `owner/name`                               |
| `pr_number`  | integer     | GitHub PR number                           |
| `reason`     | text        | One of 9 reason codes (nullable = no block)|
| `detail`     | text        | Check name, PR number, base, or refusal message |
| `since`      | timestamptz | When this reason first appeared            |
| `updated_at` | timestamptz | Last write                                 |

Primary key: `(repo, pr_number)`. One row per open PR Lore watches. Row deleted 30 days after PR closes or merges. Delivered as the next numbered migration under `charts/ui-helm/migrations`.

**`pipeline.v_auto_merge_kpis`** is a SQL view over `pipeline.audit_log`, joining `lore_reviewer_approved`, `pr_merged`, and `pr_blocked_reason` event rows. It exposes columns for routine-merge count (SC-001), dependency-order violations (SC-002), and sensitive-path approvals (SC-004). Read through `GET /api/repos/{owner}/{repo}/auto-merge/kpis`.

**Audit log event shapes**:

- `lore_reviewer_approved`: `{ prNumber, headSha, approver }`
- `auto_merge_armed`: `{ prNumber, headSha, approver }`
- `pr_merged`: `{ prNumber, mergedAt, taskId, sensitivePaths, approvedBy }`
- `pr_blocked_reason`: `{ prNumber, from, to, detail }`
- `auto_merge_disarmed`: `{ prNumber }` (one row per PR, on `approver → none` change)

### Assembly-line graph: blocked-reason station

The blocked-reason station has no assembly-line graph — it is a service station driven directly by the bus on each GitHub event. It reads `pipeline.pr_blocked_reasons`, computes the new reason, writes the updated row (one `pr_blocked_reason` audit row per reason change), edits the PR comment with the `<!-- lore:blocked-reason -->` marker via `updateIssueComment` (creating it if absent), and edits the backlog issue comment with the same marker if the PR has a `Lore-Task` trailer.

### Gating

- `auto_merge.approver = lore-reviewer` is saved only once the save path confirms: (a) lore-reviewer is installed on the repo, (b) the branch rule requires one approval, Code Owners review, and the required CI checks. If any are missing, the response names them and leaves the setting at `none`. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#q-option-a-install-criteria))
- The pilot repo has no branch protection and no CODEOWNERS today; the design must work once they exist, and this repo never names a hardcoded target. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_6b71d18e-8bba-42ad-8386-ff1190ae122a))
- On a change from `lore-reviewer` to `none`, the save path lists the repo's open PRs opened by Lore's App through the PR port, calls `disablePullRequestAutoMerge` on each one that is armed, and writes one `auto_merge_disarmed` audit row per PR. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#ce5fdbe9-1e2e-47ea-94b4-675fde887a78))

### Arm-before-approve ordering

The post-review station always calls `enablePullRequestAutoMerge` before submitting the APPROVE review as lore-reviewer. GitHub refuses to arm a PR that can already merge; arming first while the approval is still missing satisfies that constraint. Both operations carry idempotency keys (once per PR state, not per run).

### Merge-refusal classification

A named refusal (`github_refused` with a recognisable message) is written to `pr_blocked_reasons` on its first occurrence. An unclassified refusal is counted per PR; after 3 consecutive unclassified refusals (reset by any other outcome), the `github_refused` reason is written with the raw message.

### Dependency-aware merge ordering

Within a `task_group_id`, Lore arms auto-merge on a dependent PR only after its dependency PR has merged. Until then the dependent carries `blocked_by_pr`. When the dependency's `pull_request.closed` arrives with `merged: true`, the station re-evaluates the dependent. A dependency closed without merging keeps `blocked_by_pr` on the dependent until a person decides. Merge order: `depends_on` order, then by PR creation time.

### Base-drift update

When `base_behind` is detected, Lore calls GitHub's update-branch API (merge commit). CI re-runs on the resulting commit. If the branch rule dismisses stale approvals on push, the review line reruns and lore-reviewer re-approves. Until step 3 ships, the blocked-reason station writes `base_behind` but does not call update-branch; the label reads "Behind {base}; needs the base merged in".

### State and label taxonomy

| State                  | Mechanism                                        |
| ---------------------- | ------------------------------------------------ |
| `waiting_on_ci`        | `check_suite` not yet completed                  |
| `required_check_missing` | Branch rule names a check that never ran       |
| `needs_approval`       | Branch rule: 1 required approval, none posted    |
| `needs_code_owner`     | Code Owners review required, no code owner approved |
| `base_behind`          | PR base is behind default branch                 |
| `blocked_by_pr`        | `depends_on` dependency PR not yet merged        |
| `review_in_flight`     | Open review-family run on the floor              |
| `merge_conflict`       | GitHub reports a merge conflict                  |
| `github_refused`       | Merge API returned an error after 3 unclassified |

## Failure Edges & Rollback

- **lore-reviewer App compromised**: set `auto_merge.approver = none` on the repo. The save path calls `disablePullRequestAutoMerge` on all open Lore PRs and writes `auto_merge_disarmed` per PR. Nothing already approved merges on its own after this. Uninstalling the App from GitHub is the stronger stop. Platform engineering owns this first response. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#9f6854f7-2a1a-4105-a3ed-0c035e2f58ce))
- **`auto_merge_disarmed` path**: on `approver → none`, the save path disarms open PRs via `disablePullRequestAutoMerge` before writing the new setting, so no race where the old setting approves a new PR. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#ce5fdbe9-1e2e-47ea-94b4-675fde887a78))
- **Station event loss**: the blocked-reason station is idempotent; a re-delivery recomputes the same reason and writes nothing if unchanged.
- **GraphQL mutation failure**: `enablePullRequestAutoMerge` and `disablePullRequestAutoMerge` failures are surfaced as `github_refused`; the station retries on the next relevant event.

## Org-Admin Runbook

Creating and installing a GitHub App, writing a Secret Manager version and changing a repo's ruleset are org-admin actions, done by hand before lore-reviewer can run. One step touches Lore's existing App: subscribe it to the `check_suite` and `push` webhook events, which step 2's new mappers expect. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#bce7c22e-00a0-4eeb-b399-f2220353b096))

1. Create the App `lore-reviewer` with `pull_requests:write`, `contents:read` and `checks:read`, and no webhook. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_d7c04727-8cf9-47ec-8101-a702d81c92e4))
2. Install it on each repo that will use `auto_merge.approver = lore-reviewer`. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_414c5815-53b1-495a-ae7b-4759e4ce9087))
3. Add its App id and private key through the documented four-place secret procedure: the secret name list in `secrets.tf`, an `ExternalSecret` for the stations namespace, the `seed-secrets` script's required list, and the chart's `secretKeyRef`. The terraform apply must land before the chart change merges, or the stations pod fails to start. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_556fc718-df65-41d9-a1dd-5e2b84bb9719))
4. Configure the branch ruleset: one required approval, review from Code Owners and the required CI checks, and enable "Allow auto-merge". ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_9f260c7f-2a5e-49b2-a819-f82897906fe6))
5. Create or update CODEOWNERS to cover exactly the workflow and gate files (`.github/**`, `CODEOWNERS`), the agent-instruction floor (`**/CLAUDE.md`, `**/AGENTS.md`, `**/GEMINI.md`, `**/.claude/**`, `**/.gemini/**`) and the repo's escalate paths. The file must cover `CLAUDE.md` before the two-key procedure for `auto_merge.approver` is possible. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_72d63cdd-9d8b-4672-82ac-58e58a411877))
6. Remove or restrict the automerge label workflow on that repo once Lore arms auto-merge itself. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_a80fff8f-f343-4073-80d1-8e5f3a8f77ad))

## Ownership

Platform engineering runs the stations service and owns the review line, the approve-and-arm step and the audit log. It holds and rotates lore-reviewer's credentials, and answers the page when a merge should not have happened or PRs stop moving. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#9f6854f7-2a1a-4105-a3ed-0c035e2f58ce))

Each onboarded repo's owners keep their ruleset, CODEOWNERS file and escalate-path list, and keep CODEOWNERS covering the workflow and gate files, the agent-instruction floor, every escalate path and the CODEOWNERS file itself, nothing beyond those. A path missing from CODEOWNERS is guarded only by review; a path added beyond the agreed set needs a human code owner, so routine PRs touching it stop merging unattended. They are who a blocked PR is handed to, including when a dependency PR was closed without merging and Lore is waiting on a human decision. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#9dbed4af-280e-4f1d-a031-7fb7a0a8b50a))

## Project Structure

```
apps/stations/src/
  blocked-reason/          ← new service station (step 2)
    index.ts
    station.ts
    decide-reason.ts
    reason-comment.ts
  code-review/post-review/ ← existing, grows arm + approve steps (step 1)
libs/shared/src/outbound/project/lib/
  platform-github.ts       ← adds getBranchRule, getMergeability, getChangedFiles,
                             enablePullRequestAutoMerge, disablePullRequestAutoMerge,
                             updateIssueComment (steps 1-2)
libs/shared/src/domain/models/
  repo-settings.ts         ← adds auto_merge.approver field (step 1)
apps/lore-api/src/transport/routes/
  two-key.ts               ← extends to auto_merge.approver (step 1)
  auto-merge-kpis.ts       ← new GET route (step 1)
  blocked-reason.ts        ← new GET routes (step 2)
adrs/
  ADR-050-protected-branch-approver.md ← step 1
infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/
  NNNN_pr_blocked_reasons.sql          ← step 2
```

## Complexity Tracking

| Item                          | Estimate |
| ----------------------------- | -------- |
| lore-reviewer App + arming    | M        |
| `decideReviewOnOpen` gate fix | S        |
| `auto_merge.approver` setting | S        |
| Blocked-reason station        | L        |
| Dependency ordering           | M        |
| Base-drift update             | M        |
| KPI view + route              | S        |
