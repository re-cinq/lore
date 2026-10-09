# Definition of Done

> A route-level test asserts the response shape includes issue title, triage label, and active run link when a run exists.

**Strategy: `direct`** — The Hapi server's router is the existing seam. The missing route will return 404. I will write a test that expects the new route to return 200 with the specified JSON shape, and the 404 response will fail it.

## Done when these pass

- [x] **returns issues with triage:* labels joined with their active floor runs** — A request to GET /api/repos/{owner}/{repo}/triage returns an array of issues with title, triage label, and active run link. ([validated by FR30])
  `apps/lore-api/src/transport/routes/triage/triage.test.ts`

## Facets

- [x] Write the acceptance test calling the new route.
- [x] Implement the new route `apps/lore-api/src/transport/routes/triage/triage.ts`.
- [x] Register it in `apps/lore-api/src/transport/route-list.ts`.

## Out of scope

- Front-end Triage tab UI implementation.
- Floor pipeline execution logic.
