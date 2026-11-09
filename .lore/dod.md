# Definition of Done

> Demote to needs_review for the linked package-wide invariant: the three cited factories install withoutBlindRetryOnCreates, but another production factory, github-app-octokit.ts, constructs an unguarded Octokit. The installation-recording route calls this adapter. Its present public operations are GETs, so this is not evidence of a currently duplicated POST; it is a concrete exception to the original requirement that every constructed client install the policy once, including future/raw requests.

**Strategy: `mechanical`** — The fix is a small, fully-specified dedup wrapping `new Octokit()` in `withoutBlindRetryOnCreates`. Its behavior is pinned by existing tests and no new observable POST operations are exposed by this module.

## Done when these pass

- [ ] **sends a failed POST exactly once** — pins the `withoutBlindRetryOnCreates` behavior
  `libs/shared/src/outbound/project/lib/octokit-retry-policy.test.ts`

## Facets

- [x] Apply `withoutBlindRetryOnCreates` inside `appOctokit`
- [x] Update `specs/shared-utilities/spec.md` to list four clients instead of three

## Out of scope

- Testing duplicated mutations in other adapters, as this adapter is GET-only.
