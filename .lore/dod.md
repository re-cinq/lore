# Definition of Done

> A GET route reads registered repos, but available is still a hardcoded re-cinq/lore row. It does not fetch GitHub App installation repos or exclude already-onboarded repos as FR2.1 requires.

**Strategy: `direct`** — The web-ui GET route exists and can be tested directly by directing its upstream API requests to a real test HTTP server.

## Done when these pass

- [ ] **returns App-accessible, not-yet-onboarded repositories instead of hardcoded list** — The route returns the actual list of available repositories retrieved from the upstream API.
  `apps/web-ui/src/app/api/repos/route.acceptance.test.ts`
- [ ] **returns an upstream error when the GitHub fetch fails** — The route correctly relays meaningful upstream errors when the backend fails to fetch installation repositories.
  `apps/web-ui/src/app/api/repos/route.acceptance.test.ts`

## Facets

- [ ] Expose `getAvailableRepos` as an endpoint in `lore-api` (e.g. `/api/repos/available`).
- [ ] Update `listAllRepos` or create a new fetcher in `web-ui` to call this endpoint.
- [ ] Update `apps/web-ui/src/app/api/repos/route.ts` to use the new fetcher instead of hardcoding the available list.
- [ ] Ensure any upstream errors are caught and surfaced via `upstreamError`.

## Out of scope

- UI rendering of the repositories; this ticket is strictly about the API route returning the data.
