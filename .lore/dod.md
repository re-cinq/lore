# Definition of Done

> cachedRepo uses null as both 'not yet detected' and a failed/no-match result, so repeated unsuccessful detection reruns git, contrary to the unqualified no-second-call-until-reset criterion.

**Strategy: `direct`** — The `detectCurrentRepo` function is already exposed and can be tested directly by verifying `execSync` is not called again after a null response.

## Done when these pass

- [ ] **caches the null result so a second call does not re-run git** — verifies that a null result (e.g. from an exception) is cached so repeated calls don't invoke `execSync` a second time
  `libs/server-core/src/work/repo/repo-detect.acceptance.test.ts`

## Facets

- [ ] Update `detectCurrentRepo` state to distinguish between "not yet evaluated" and "evaluated to null"
- [ ] Ensure `resetRepoCache` resets this updated state correctly

## Out of scope

- Updating consumers of `detectCurrentRepo`
- Updating cache logic in `detectCurrentBranch`
