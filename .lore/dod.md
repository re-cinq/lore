# Definition of Done

> A retry from a node re-launches on the run's stale ci_* args instead of re-reading CI

**Strategy: `direct`** — The seam already exists in `runNodeByHand`. The red bar is CI's to show, specifically the CI job `test (lore-api)` which runs the tests.

## Done when these pass

- [ ] **routes a retry of a node fed by CI (repair-build) through await-ci so CI re-judges the branch** — ensures the retry routes to await-ci so the verdict is refreshed instead of using stale args
  `apps/lore-api/src/work/floor/run-node-by-hand.acceptance.test.ts`

## Facets

- [ ] Update `runNodeByHand` to post `node.await-ci.start` when asked to run nodes fed by CI

## Out of scope

- Updating stale args manually without routing to await-ci
