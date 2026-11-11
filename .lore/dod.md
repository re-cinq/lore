# Definition of Done

> Scaffold Inbox GET route with plan and onboarding sources
> 
> Route successfully returns 200
> Returns mapped Plan and Onboarding PR items

**Strategy: `direct`** — The HTTP test seam already exists via `buildServer`, allowing us to test the `GET /api/inbox` API endpoint directly.

## Done when these pass

- [ ] **successfully returns 200 and mapped Plan and Onboarding PR items** — The route returns a 200 OK status code and the JSON payload contains `items` that correctly map Plan and Onboarding PR data.
  `apps/lore-api/src/transport/routes/inbox/inbox.acceptance.test.ts`

## Facets

- [ ] Add the route directory and `GET /api/inbox` handler scaffold in `apps/lore-api/src/transport/routes/inbox/inbox.ts`
- [ ] Register the route in `route-list.ts` and `route-categories.ts`
- [ ] Implement the DB query logic to map and return plan items and onboarding PR items

## Out of scope

- Implementing the cross-repo plan query (#3361)
- Implementing the other `kind`s like `failed_run`, `spec_pr`, and `triage`