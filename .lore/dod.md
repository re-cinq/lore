# Definition of Done

> decideBranchResume resumes any existing branch that carries no lore:blocked verdict. A branch that has been MERGED is not "work in progress to continue": every commit on it is already on main, so a resumed run cannot push anything new, and the dod step's "pushed nothing" guard reads that as a failure.

**Strategy: `direct`** — `decideBranchResume` in `libs/shared/src/work/backlog/resume-branch.ts` is a pure function that already decides whether to resume a branch; the acceptance test calls it directly with a `branchMerged: true` input and fails because the function has no such check today.

## Done when these pass

- [ ] **starts fresh when the branch is merged into base** — `decideBranchResume` returns `{ resume: false }` when the branch's head is already an ancestor of the base branch, so the loop never resumes a merged branch and burns a run that cannot push anything new
  `libs/shared/src/work/backlog/resume-branch.test.ts`

## Facets

- [ ] Add `branchMerged: boolean | undefined` to `BranchResumeInput` in `resume-branch.ts`
- [ ] Return `FRESH` in `decideBranchResume` when `branchMerged === true`, before the existing `lore:blocked` check
- [ ] Feed `branchMerged` from the GitHub port's branch-comparison call in `implementation-loop-tick.ts` (the port already has the branch name; the check is whether the branch head is an ancestor of the default branch)

## Out of scope

- Deleting or renaming the merged branch before starting fresh (the caller opens a new branch from main; old branch cleanup is a separate concern)
- Detecting the `Refs` vs `Closes` distinction for partially-merged tickets (already FR11's `Lore-Issue-Coverage` mechanic)
- Any change to the `implementation-loop-tick` logic beyond wiring `branchMerged` into the `decideBranchResume` call
