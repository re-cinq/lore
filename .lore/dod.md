# Definition of Done

> T008: Add PUT route for Inbox item state
>
> Users must be able to mark items handled or snooze them from the UI.

**Strategy: `direct`** — The API route and its HTTP testing seam via `buildServer` allow calling the route directly.

## Done when these pass

- [ ] **updates the DB for the calling user when marked handled** — Validates that a PUT to the route with a valid body upserts the state for the specified person.
  `apps/lore-api/src/transport/routes/inbox/inbox-item-state-put.acceptance.test.ts`

## Facets

- [ ] Add the PUT route in `apps/lore-api/src/transport/routes/inbox/`
- [ ] Export and register it in `route-list.ts`
- [ ] Connect the payload schema in `domain-routes.ts`

## Out of scope

- UI integration
- GET route and data models migration (depends on #3360)
