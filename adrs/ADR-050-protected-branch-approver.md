# ADR-050: Protected-branch approver — lore-reviewer as a second GitHub App

**Status**: Accepted (at prototype demo 2026-10-09)
**Date**: 2026-10-07
**Deciders**: Platform Engineering

---

## Context

On 2026-10-02 PR #2431 deleted `apps/floor` and with it the dark-factory auto-merge evaluation, which never shipped to any repo. On the same day PR #2445 deleted the per-repo dark_factory settings, their route and their tab. Nothing in Lore merges a pull request today. A person reads every Lore-opened PR, approves it and clicks merge.

PR 2224 (`escalate_paths`, `auto_merge.enabled`) targeted the deleted Floor code and is superseded. A draft ADR-049 in that PR covered related ground; however ADR-049 on main is already taken by the external-floor decision, so this record becomes ADR-050. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_d9110a41-a9b6-48d3-97ee-9ac0d2af7cec))

Four options were evaluated for who satisfies the branch rule's required-approval gate after Lore arms GitHub's native auto-merge. The criteria any option must satisfy: an approval GitHub counts for the branch rule; the author App cannot be the approver; sensitive PRs must always end with a human approval; the rule must be enforced by GitHub, not only by Lore. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#6b9e9b58-4fba-49d9-8e21-c610aa1de70f))

## Decision

Build **Option A** first — a second GitHub App `lore-reviewer` as the approver — behind a per-repo `auto_merge.approver = none | lore-reviewer` setting, off by default. Option C (humans approve, Lore arms native auto-merge) is what any repo gets with `approver = none`. Option D (GitHub merge queue) is deferred. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#d9fc30d4-669a-4121-b582-4efda0ddda66))

The branch rule that makes this safe: one required approval, review from Code Owners, and the required CI checks. CODEOWNERS lists exactly the sensitive paths. A GitHub App cannot be a code owner, so lore-reviewer's approval satisfies routine paths only and never a sensitive one; GitHub enforces that difference and records who gave the human approval.

## Options Considered

**Option A — Second GitHub App `lore-reviewer`** (chosen)
`pull_requests:write`, `contents:read`, `checks:read`. Installed per repo, credentials in Secret Manager, mirrored by ESO into the stations namespace. Lore's post-review station arms native auto-merge first (GraphQL `enablePullRequestAutoMerge`), then submits APPROVE as lore-reviewer; GitHub counts it and merges once the branch rule is satisfied. Two identities in the audit trail, no bypass list, sensitive-path guarantee lives in GitHub. Cons: one more App to create, install and rotate. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_5f88837a-1fff-4196-a5d9-db36e47140b4))

**Option B — Ruleset bypass list** (rejected)
Add Lore's App to the bypass list in the branch ruleset, so its PRs skip the approval requirement. The bypass covers every Lore PR, sensitive ones included: the sensitive-path guarantee would be enforced only by Lore's code, not GitHub. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_a39ea074-f8eb-41ca-8ec5-a660f3c49285))

**Option C — Human approves, Lore arms native auto-merge** (delivered as `approver = none`)
A person approves; Lore arms `enablePullRequestAutoMerge`; GitHub merges. No click required after approval. This is what any repo gets today once Lore arms native auto-merge. The approver identity is a human, which is always audit-safe, but routine Lore PRs still need a person to review. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_14d83942-4551-4f11-812b-58c80ed94911))

**Option D — GitHub merge queue** (deferred)
Orthogonal to who approves. Solves ordering and base drift, at the cost of every repo's CI running on `merge_group` events. A later addition once A and C are running. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/ea73a044-33aa-44ab-8d08-19fe4e282156#p_1619d218-e234-408b-995e-d6467d60ca9c))

## Consequences

- lore-reviewer is the first second-identity App in the platform; its credentials follow the four-place secret procedure (secret names in terraform, ExternalSecret per namespace, seed-secrets REQUIRED list, chart secretKeyRef; terraform apply before chart change). Rotation is a platform-engineering responsibility.
- `decideReviewOnOpen` must let Lore's own App through the bot check (read login at startup via `GET /app`, hold in memory) so Lore-authored PRs receive a review and lore-reviewer is asked to approve.
- Enabling `auto_merge.approver = lore-reviewer` on a repo goes through the two-key ceremony: admin scope plus a CODEOWNERS approval PR with the `dark-factory-approval` label. The save path validates installation and the branch ruleset before persisting; if any prerequisite is missing, it names what is missing and leaves the setting at `none`.
- The automerge label workflow (`.github/workflows/auto-merge.yml`) is retired on repos where Lore arms native auto-merge itself.
- If GitHub changes App eligibility as code owners, the sensitive-path separation must be reconsidered.
