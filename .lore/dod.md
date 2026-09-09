# Definition of Done

> The `EventDeliveriesPort` contract suite
> (`libs/shared/src/project/events/event-deliveries.contract.test.ts`) generates
> a random subscriber per case via `sub()` and never removes the rows. Running it
> against a long-lived Postgres accumulates them [...] Fix: an `afterEach`/`afterAll`
> that deletes the subscribers and events the run created.

**Strategy: `mechanical`** — the fix is a test-file cleanup hook, not a change to
any production behaviour, and it is observable ONLY against a live Postgres. This
container has no Postgres (no `psql`, no `docker`, `:5432` connection refused) and
cannot stand one up, and even in CI this contract's Postgres arm is never run
(`test-integration.yml` runs only the `assembly-runs` contract against its
ephemeral DB). A new behavioural test for the cleanup would therefore be either
Postgres-only (impossible to red-bar here) or a `readFileSync`-of-the-test guard
(a source-text test, forbidden). Per the "only red bar is source text → the ticket
owes no new test" rule, this owes no new test. The edit — an `afterAll` in the
Postgres arm deleting `internal.test.%` events (their deliveries cascade per
migration 0048) and `sub-%` subscriptions — is the whole deliverable; the existing
contract assertions staying green prove the hook does not regress the suite, and
review judges the DELETEs (which no environment reachable from here can execute).

## Done when these pass

- [x] **EventDeliveriesPort contract (in-memory)** — 24 assertions; the added
  `afterAll` lives inside the `if (pg.ok)` Postgres arm, so it does not touch this
  arm, which is the one runnable here. Stays green.
  `libs/shared/src/project/events/event-deliveries.contract.test.ts`
- [x] **the Postgres implementation is actually exercised** — the skip-guard test;
  still passes (no `LORE_REQUIRE_PG_CONTRACT`), confirming the file loads with the
  new hook present.
  `libs/shared/src/project/events/event-deliveries.contract.test.ts`

## Facets

- [x] Add an `afterAll` in the `if (pg.ok)` block deleting `internal.test.%` events
  (deliveries cascade) then `sub-%` subscriptions, on its own short-lived pool.
- [ ] (Unverifiable here) Against a live Postgres the suite leaves no net-new
  `sub-*`/`internal.test.*` rows — proven only by running the Postgres arm on a
  machine that has the DB.

## Out of scope

- Adding a delete/unsubscribe method to `EventDeliveriesPort` or its adapters (the
  ticket scopes the fix to a test-file hook, not the production surface).
- Wiring this contract's Postgres arm into `test-integration.yml` CI.
- The `~649 internal.test.*` events the reporter already purged from local dev.
