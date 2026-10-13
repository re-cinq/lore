# Definition of Done

> Extend `apps/stations/src/code-review/post-review/`: (1) read the branch rule and the repo's `auto_merge.approver`; (2) where the rule requires an approval, call `enablePullRequestAutoMerge` with `SQUASH` first, idempotent per PR state, and write an `auto_merge_armed` audit row; (3) only where `approver = lore-reviewer`, submit the APPROVE as lore-reviewer and write a `lore_reviewer_approved` audit row with `{ prNumber, headSha, approver }`. Where `approver = none`, Lore arms and does not approve: a person gives the approval, and GitHub refuses one from the App that opened the PR. Arming never happens on an unprotected branch.

**Strategy: `direct`** — The acceptance test can call the real entry point `postReviewHandle` today and fail on behaviour. The red bar is CI's to show; the `lore-tests` CI job runs the tests.

## Done when these pass

- [x] **given a branch requiring approval, when review completes, then it calls enableAutoMerge with SQUASH and writes an audit row** — It calls enableAutoMerge with SQUASH and writes an audit row.
  `apps/stations/src/code-review/post-review/station.test.ts`
- [x] **given approver is lore-reviewer, when review approves, then it submits APPROVE and writes lore_reviewer_approved audit row** — It approves as lore-reviewer and records the approval.
  `apps/stations/src/code-review/post-review/station.test.ts`
- [x] **given approver is none, when review approves, then it arms but does not approve** — It arms auto-merge without approving.
  `apps/stations/src/code-review/post-review/station.test.ts`
- [x] **given an unprotected branch, when review completes, then it does not arm auto-merge** — It does not arm auto-merge on an unprotected branch.
  `apps/stations/src/code-review/post-review/station.test.ts`
- [x] **given a re-run on the same PR state, when review completes, then it does not re-arm or re-approve** — Approving and arming happen only once per PR state.
  `apps/stations/src/code-review/post-review/station.test.ts`

## Facets

- [x] Add `enableAutoMerge` to PR port
- [x] Read `getBranchRule` from project port
- [x] Read `getSettings` from project port
- [x] Record audit row for `auto_merge_armed`
- [x] Record audit row for `lore_reviewer_approved`
- [x] Perform idempotency check
- [ ] Resolve PR number to GraphQL node ID for enableAutoMerge

## Out of scope

- Setting up GitHub App identities or keys.
- Changing `apps/lore-api` two-key ceremonies or API routes.