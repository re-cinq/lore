# Definition of Done

> lore-api records a Refine ask on the pool it built, never the shared one

**Strategy: `mechanical`** — The behaviour was already pinned in `register-planning.acceptance.test.ts` by PR #4375, but the corresponding statement in the spec was left un-linked, resulting in this ticket.

## Done when these pass

- [ ] **A Refine through production dependency construction records its ask on the server pool and starts analyze** — The existing test that pins the wiring of `askFloorRefine` to the server pool.
  `apps/lore-api/src/app/register-planning.acceptance.test.ts`

## Facets

- [x] Add the missing validation link to the statement in `specs/7-feature-planning/spec.md`.

## Out of scope

- Any changes to production code or new acceptance tests, as the behaviour is already covered and green.
