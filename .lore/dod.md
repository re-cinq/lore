# Definition of Done

> The anonymous HTTP response on DB failure is only {status:error}, omitting the ticket's required reason

**Strategy: `direct`** — A testing seam exists via HTTP request injection on the fully built server, allowing us to observe the real entry point's response directly.

## Done when these pass

- [ ] **returns 503 error with reason when configured DB is unreachable** — ensures the 503 response body includes the `reason` field as specified
  `apps/lore-api/src/transport/routes/healthz/healthz.acceptance.test.ts`
- [ ] **returns 200 ok when DB is connected** — ensures healthy DB cases return the agreed 200 response
  `apps/lore-api/src/transport/routes/healthz/healthz.acceptance.test.ts`
- [ ] **returns 200 ok when no DB is configured** — ensures no configured pool cases return the agreed 200 response
  `apps/lore-api/src/transport/routes/healthz/healthz.acceptance.test.ts`

## Facets

- [x] Update `serveHealthz` to include `health.reason` in the response body when `status` is `"error"`
- [ ] Ensure reader authentication logic continues to function for `tasks` and `embeddings` stats

## Out of scope

- Updating `getHealthStatus()` internal connection logic or DB ping mechanics.
