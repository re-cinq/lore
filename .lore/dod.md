# Definition of Done

> The generated onboarding PR body satisfies the unchanged description check: `Why`, `What Changed` and `Testing` are present and nonempty. Include meaningful content under the template's `Alternatives Considered` and `ADRs & Architecture` sections as well.
> Testing describes what has actually been verified. Opening the PR must not claim that CI or application tests have already passed; CI is checked by the following `await-ci` step.

**Strategy: `direct`** — The `open-pr` station exposes its handler, which we can call in an acceptance test to check the `body` of the PR it requests GitHub to open.

## Done when these pass

- [ ] **includes the sections required by the PR description check in the generated pull request body** — The generated PR body has `## Why`, `## What Changed`, `## Testing`, `## Alternatives Considered`, and `## ADRs & Architecture` sections, and does not mention CI.
  `apps/stations/src/onboard/open-pr/station.acceptance.test.ts`

## Facets

- [ ] Add the required sections from `libs/shared/src/work/onboard-content.ts` to `apps/stations/src/onboard/open-pr/station.ts`.
- [ ] Update tests in `apps/stations/src/onboard/open-pr/station.test.ts` to match the new PR body format.

## Out of scope

- Changes to other PR generators like implementation-loop PRs or the check workflow itself.
