# Definition of Done

> The active blocked-reason derivation reads mergeability, branch rules, CI and approval counts only; neither it nor the final approval station loads task-group depends_on PRs. blocked_by_pr is a displayable code, not an enforced merge-order gate.

**Strategy: `direct`** — The seams are `runBlockedReason` and `approveAndMerge`. The test provides an augmented port mock (`getTaskDependsOn` etc.) to prove the dependencies are currently ignored, failing on behaviour. The implementation will need to formalize this seam.

## Done when these pass

- [ ] **records blocked_by_pr when a PR's task depends on another task in the same group that has an unmerged open PR**
  `apps/stations/src/blocked-reason/dependency-aware-merge.acceptance.test.ts`
- [ ] **refuses to arm or merge a PR whose dependency task has an unmerged open PR**
  `apps/stations/src/auto-merge/approve-merge/dependency-aware-arming.acceptance.test.ts`

## Facets

- [ ] Add dependency resolution logic to the project port so `runBlockedReason` can fetch `taskGroupId` and `depends_on`.
- [ ] Add `dependency-aware` blocked reason rule in `blocked-reason/derivation.ts`.
- [ ] Add dependency check guard in `approve-merge.ts` before arming or merging.
- [ ] Re-evaluate dependent PRs upon their dependency's closure.

## Out of scope

- Creation time tie-breaker ordering logic inside the same task group (wait, the ticket mentions "enforce depends_on/creation order before arming", so it is in scope? I will not list it as out of scope, I'll leave out of scope empty or list something else).
- Actually, "re-evaluate after dependency merge" is part of the remaining work. I can leave out of scope as just "General task queue semantics beyond pull request merge ordering."
