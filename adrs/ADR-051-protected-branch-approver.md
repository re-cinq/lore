---
adr_number: 51
title: "Protected-branch approver: lore-reviewer as a second GitHub App"
status: accepted
date: 2026-10-07
deciders: ["Platform Engineering"]
domains: [code-review, merge, github, stations, lore-api]
---

# ADR-051: Protected-branch approver — lore-reviewer as a second GitHub App

**Status**: Accepted on 2026-10-09 (amended 2026-10-23)
**Date**: 2026-10-07
**Deciders**: Platform Engineering
**Demonstration**: Prototype demo accepted on 2026-10-09 (#2712); verified on protected branches over the 2026-10-23–2026-10-26 rollout ([weekend report](../docs/building-lore/implementation-loop-2026-10-23-weekend.md)), where `approve` ran 43 times across re-cinq/Otto and re-cinq/lore, merging 23 routine loop pull requests (11 on Otto #499–#508, 12 on lore) without a human click while holding all 17 re-cinq/lore pull requests touching `CODEOWNERS`-governed paths (`CLAUDE.md`, `adrs/`, `.github/`) for a named human code owner's approval (#3602).

---

## Context

On 2026-10-02 PR #2431 deleted `apps/floor` and with it the dark-factory auto-merge evaluation, which never shipped to any repo. On the same day PR #2445 deleted the per-repo dark_factory settings, their route and their tab. Nothing in Lore merges a pull request today. A person reads every Lore-opened PR, approves it and clicks merge.

PR 2224 (`escalate_paths`, `auto_merge.enabled`) targeted the deleted Floor code and is superseded. A draft ADR-049 in that PR covered related ground; however ADR-049 on main is already taken by the external-floor decision, and ADR-050 is the metrics stack, so this record becomes ADR-051. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_d9110a41-a9b6-48d3-97ee-9ac0d2af7cec))

Four options were evaluated for who satisfies the branch rule's required-approval gate after Lore arms GitHub's native auto-merge. The criteria any option must satisfy: an approval GitHub counts for the branch rule; the author App cannot be the approver; sensitive PRs must always end with a human approval; the rule must be enforced by GitHub, not only by Lore. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#6b9e9b58-4fba-49d9-8e21-c610aa1de70f))

## Decision

- Build **Option A** first — a second GitHub App `lore-reviewer` as the approver — behind a per-repo `auto_merge.approver = none | lore-reviewer` setting, off by default. Option C (humans approve, Lore arms native auto-merge) is what any repo gets with `approver = none`. Option D (GitHub merge queue) is deferred. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#d9fc30d4-669a-4121-b582-4efda0ddda66), [validated by builds a configured client from the three LORE_REVIEWER_APP_* values @94c87592](../libs/shared/src/outbound/project/github-installations/lore-reviewer.test.ts#L5), [validated by is null when the installation id is missing, so the loop knows it has no reviewer @b1b1dcf2](../libs/shared/src/outbound/project/github-installations/lore-reviewer.test.ts#L15), [validated by parks Lore's own PR when only Lore's App can approve, and approves it as lore-reviewer when that App is installed @56d19ac4](../apps/stations/src/auto-merge/approve-merge/approve-merge.test.ts#L125))

- The branch rule that makes this safe: one required approval, review from Code Owners, and the required CI checks. CODEOWNERS lists exactly the sensitive paths. A GitHub App cannot be a code owner, so lore-reviewer's approval satisfies routine paths only and never a sensitive one; GitHub enforces that difference and records who gave the human approval. ([validated by getBranchRule reads 1 approval, Code Owners review and checks build and lint from a ruleset @e918555e](../libs/shared/src/outbound/project/lib/platform-github.test.ts#L1382), [validated by reads the first CODEOWNERS present, .github/ before the root, and none when there is none @d880a83c](../libs/shared/src/domain/codeowners.test.ts#L66), [validated by arms, approves and asks the code owners of a PR that changes an owned path on a branch whose rule wants a code owner's review, and asks nobody without one, since lore's approve step refused 17 times over the weekend of 2026-10-23 @79601c5b](../apps/stations/src/auto-merge/approve-merge/approve-merge.test.ts#L183), [validated by counts only PR 1, sensitive and approved by bots alone, as merged without a code owner @5ca15de6](../apps/lore-api/src/integration-tests/auto-merge-kpis-view.test.ts#L40))

### Amendment 2026-10-23: the auto-merge loop

- The approver setting and its two-key ceremony are gone. Approving and arming moved out of the post-review station into an **auto-merge loop** (`specs/protected-branch-merge`), switched per repo by `auto_merge.enabled` with one setting, `auto_merge.min_age_hours` (24 by default). It takes every open pull request code review has passed, whoever opened it, fixes red CI, conflicts and open review threads with an agent, and once the pull request is green, settled and old enough approves it: as lore-reviewer when that App is installed, as Lore's own App otherwise, which can approve only a person's pull request. On a protected branch it arms native auto-merge before approving and GitHub merges, as decided above. On a branch with no approval rule nothing would make GitHub wait, so the loop merges the pull request itself, unless it changes a path CODEOWNERS gives an owner, which it leaves to a person. That is the one exception to "GitHub performs every merge". Code owners stay the guard for sensitive paths on both kinds of branch; the two-key ceremony keeps guarding an agent definition's `image` only. ([validated by PUT merge on writes auto_merge.enabled with no approval asked @a84417d2](../apps/lore-api/src/transport/routes/loops/loops.test.ts#L294), [validated by reads the minimum age as auto_merge.min_age_hours, 24 when absent, negative or fractional @ffd4422a](../libs/shared/src/domain/loops/loop-enabled.test.ts#L50), [validated by starts a run for #1 whose review passed, and none for #2 still unreviewed @78a39291](../apps/stations/src/work/auto-merge-tick/auto-merge-tick.test.ts#L45), [validated by given a branch requiring approval, when review approves, then it posts a comment review and arms nothing @9353c4db](../apps/stations/src/code-review/post-review/station.test.ts#L258), [validated by arms auto-merge with squash before approving a person's PR on a branch that requires an approval @0f02e3e8](../apps/stations/src/auto-merge/approve-merge/approve-merge.test.ts#L73), [validated by approves and squash-merges a PR on a branch with no approval rule @9965706e](../apps/stations/src/auto-merge/approve-merge/approve-merge.test.ts#L98), [validated by parks a PR on an unprotected branch that changes a CODEOWNERS path, merging nothing and asking its code owners @546c297a](../apps/stations/src/auto-merge/approve-merge/approve-merge.test.ts#L110))

## Alternatives Considered

**Option A — Second GitHub App `lore-reviewer`** (chosen)
`pull_requests:write`, `contents:read`, `checks:read`. Installed per repo, credentials in Secret Manager, mirrored by ESO into the stations namespace. Lore's post-review station arms native auto-merge first (GraphQL `enablePullRequestAutoMerge`), then submits APPROVE as lore-reviewer; GitHub counts it and merges once the branch rule is satisfied. Two identities in the audit trail, no bypass list, sensitive-path guarantee lives in GitHub. Cons: one more App to create, install and rotate. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_5f88837a-1fff-4196-a5d9-db36e47140b4))

**Option B — Ruleset bypass list** (rejected)
Add Lore's App to the bypass list in the branch ruleset, so its PRs skip the approval requirement. The bypass covers every Lore PR, sensitive ones included: the sensitive-path guarantee would be enforced only by Lore's code, not GitHub. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_a39ea074-f8eb-41ca-8ec5-a660f3c49285))

**Option C — Human approves, Lore arms native auto-merge** (delivered as `approver = none` until 2026-10-23)
A person approves; Lore arms `enablePullRequestAutoMerge`; GitHub merges. No click required after approval. This is what any repo gets today once Lore arms native auto-merge. The approver identity is a human, which is always audit-safe, but routine Lore PRs still need a person to review. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_14d83942-4551-4f11-812b-58c80ed94911))

**Option D — GitHub merge queue** (deferred)
Orthogonal to who approves. Solves ordering and base drift, at the cost of every repo's CI running on `merge_group` events. A later addition once A and C are running. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_1619d218-e234-408b-995e-d6467d60ca9c))

## Consequences

- lore-reviewer is the first second-identity App in the platform; its credentials follow the four-place secret procedure (secret names in terraform, ExternalSecret per namespace, seed-secrets REQUIRED list, chart secretKeyRef; terraform apply before chart change). Rotation is a platform-engineering responsibility.
- `decideReviewOnOpen` must let Lore's own App through the bot check (read login at startup via `GET /app`, hold in memory) so Lore-authored PRs receive a review and lore-reviewer is asked to approve.
- ~~Enabling `auto_merge.approver = lore-reviewer` on a repo goes through the two-key ceremony.~~ Superseded 2026-10-23: the auto-merge loop's switch needs only admin scope (see the amendment above).
- The automerge label workflow (`.github/workflows/auto-merge.yml`) is retired on repos where Lore arms native auto-merge itself.
- Protected-branch demonstration and rollout: accepted after the 2026-10-09 prototype demo (#2712) and verified on protected branches over the 2026-10-23–2026-10-26 rollout ([`docs/building-lore/implementation-loop-2026-10-23-weekend.md`](../docs/building-lore/implementation-loop-2026-10-23-weekend.md)), where 23 routine loop pull requests merged without a human click (11 on re-cinq/Otto #499–#508, 12 on re-cinq/lore) and all 17 `approve` refusals on re-cinq/lore held pull requests touching `CODEOWNERS` paths (`CLAUDE.md`, `adrs/`, `.github/`) for a human code owner's approval (#3602).
- If GitHub changes App eligibility as code owners, the sensitive-path separation must be reconsidered.
