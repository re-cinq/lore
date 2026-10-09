# Definition of Done

> The onboard line rewrites hand-maintained workflows: #2585 silently defanged the spec-links check

**Strategy: `direct`** — The onboarding scaffold and guard logic can be tested directly via their existing seams.

## Done when these pass

- [ ] **reports a divergence and skips committing when a scaffold file already exists but differs** — ensures `enrolRepo` does not overwrite existing workflows, reporting them as divergent instead
  `libs/shared/src/work/onboard/enrol-repo.test.ts`
- [ ] **blocks re-cinq/lore outright because it is the source of the templates** — ensures `decideOnboard` rejects onboarding for the Lore repository itself
  `libs/shared/src/work/onboard-guard.test.ts`

## Facets

- [x] `decideScaffoldCommit` returns false when `current !== null` and `current !== file.content`
- [ ] `commitScaffoldFile` reports a divergence when the file exists and differs
- [ ] `decideOnboard` returns an allowed: false block for `re-cinq/lore`

## Out of scope

- Removing `||` from a "generated spec-links step", as no such step is generated for any repo (the agent hallucinated it onto the hand-maintained `pr-checks.yml` in #2585)
