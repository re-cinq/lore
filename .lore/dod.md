# Definition of Done

> Open an issue when no open PR exists for the repository.

**Strategy: `direct`** — The seam (`DetectDriftDeps`) already exists; we inject GitHub ports via `as any` to test the missing behavior natively, expecting the implementation round to formalize the signature.

## Done when these pass

- [x] **opens a link-rot issue when drift exists and no open PR exists for the repository** — The station detects drift and, when no PRs are open, creates an issue with the spec-link-rot label.
  `apps/stations/src/spec-upkeep/detect-drift/station.acceptance.test.ts`

## Facets

- [x] Add `project` or `pulls` and `issues` ports to `DetectDriftDeps`.
- [x] Inject `issues` and `pulls` in `productionDeps` from `projectFor`.
- [x] Check `pulls.list()` in `detectDriftHandle` when drift is found.
- [x] Call `issues.create` if no PR is open and return success.

## Out of scope

- Generating PR comments for the link rot (already covered elsewhere).