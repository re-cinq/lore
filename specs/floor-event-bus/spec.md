# Feature Specification: Floor Event Bus

| Field   | Value                    |
|---------|--------------------------|
| Feature | Floor Event Bus          |
| Status  | In Progress              |
| Owner   | Platform Engineering     |
| Builds on | [ADR-015](../../adrs/ADR-015-webhook-driven-review-reactor.md) |

The Floor Event Bus routes every Floor trigger — GitHub webhooks, Agent-CR terminal phases, cron ticks, post-ingest hooks — through one durable, at-least-once `pipeline.events` substrate, where a single loop atomically claims runnable rows, dispatches by event name through a registry, and retries with backoff into a dead-letter.

## Problem Statement

Every Floor trigger — GitHub webhooks, Agent-CR terminal phases, cron ticks,
post-ingest hooks — must flow through one durable, at-least-once substrate rather
than ad-hoc fan-out endpoints. The event bus (`pipeline.events`, ADR-015
amendment) is that substrate: listeners insert rows, a single loop atomically
claims runnable rows (`FOR UPDATE SKIP LOCKED`) and dispatches by `event_name`
through a registry, with retry/backoff → dead-letter and a stuck-row reaper.

## Functional Requirements

<!--
  One statement per behaviour of the loop / registry / retry layer; link its unit
  tests inline (v3): `Statement. ([validated by `file.test.ts:NN`](path#LNN))`.
-->

- FR1. A failed attempt is retried with an exponentially growing backoff (2 seconds after the first attempt, 16 seconds after the fourth) capped at 300 seconds, honouring a configurable attempt maximum. ([validated by `retry.test.ts:5`](apps/floor/src/main-loop/retry.test.ts#L5), [validated by `retry.test.ts:12`](apps/floor/src/main-loop/retry.test.ts#L12), [validated by `retry.test.ts:19`](apps/floor/src/main-loop/retry.test.ts#L19))

- FR2. Retrying stops and the event is dead-lettered once the attempt count reaches or passes the maximum. ([validated by `retry.test.ts:31`](apps/floor/src/main-loop/retry.test.ts#L31), [validated by `retry.test.ts:35`](apps/floor/src/main-loop/retry.test.ts#L35))

- FR3. When the handler for a claimed event succeeds, the loop marks that event row done. ([validated by `loop.test.ts:51`](apps/floor/src/main-loop/loop.test.ts#L51))

- FR4. When no handler is registered for an event name, the loop dead-letters the row immediately without retrying. ([validated by `loop.test.ts:61`](apps/floor/src/main-loop/loop.test.ts#L61))

- FR5. When the handler throws, the loop marks the row failed with the retry backoff below the attempt cap and dead-letters it at the cap. ([validated by `loop.test.ts:74`](apps/floor/src/main-loop/loop.test.ts#L74), [validated by `loop.test.ts:85`](apps/floor/src/main-loop/loop.test.ts#L85))

- FR6. The loop passes the event's params through to the dispatched handler. ([validated by `loop.test.ts:96`](apps/floor/src/main-loop/loop.test.ts#L96))

- FR7. The registry maps every event name a Floor producer can emit to a defined handler function. ([validated by `registry.test.ts:24`](apps/floor/src/main-loop/registry.test.ts#L24), [validated by `registry.test.ts:33`](apps/floor/src/main-loop/registry.test.ts#L33))

- FR8. A handler composed with `withExtra` runs the primary then every secondary in order, propagates a primary throw to preserve retry semantics, and swallows a secondary throw so it never breaks the primary. ([validated by `registry.test.ts:41`](apps/floor/src/main-loop/registry.test.ts#L41), [validated by `registry.test.ts:60`](apps/floor/src/main-loop/registry.test.ts#L60), [validated by `registry.test.ts:71`](apps/floor/src/main-loop/registry.test.ts#L71))

- FR9. Events in a serial family (`internal.ingest.spec_trace` — its handlers contend on shared dgraph state) run at most one at a time per Floor instance while every other event stays fully parallel: within a batch the family's events run one after the other, and while one is in flight the next drain's claim EXCLUDES the family so its waiting rows stay `pending` (never parked in `processing`, where the >600s reaper would reap a queued row as presumed-dead and re-run it concurrently — the observed duplicate-self race on long projections). The busy marker clears when the handler finishes, thrown or not — and a serial handler whose promise never settles releases the family slot at a deadline just past the reaper's visibility timeout (by then the row is already re-queued; holding the flag for an unsettled promise starves the family for good, as one hung network call proved on 2026-07-16), leaving the abandoned handler to run unsupervised like any parallel one. Cross-instance conflicts are absorbed by the dgraph layer's retry-on-abort. ([validated by `loop.test.ts:137`](apps/floor/src/main-loop/loop.test.ts#L148), [validated by `loop.test.ts:174`](apps/floor/src/main-loop/loop.test.ts#L185), [validated by `loop.test.ts:197`](apps/floor/src/main-loop/loop.test.ts#L208), [validated by `loop.test.ts:215`](apps/floor/src/main-loop/loop.test.ts#L226), [validated by `event-queue.test.ts:40`](libs/shared/src/project/events/event-queue.test.ts#L40), [validated by `event-queue.test.ts:112`](libs/shared/src/project/events/event-queue.test.ts#L112); implemented by [`loop.ts:66`](apps/floor/src/main-loop/loop.ts#L66), [`event-queue-pg.ts:21`](libs/shared/src/project/events/event-queue-pg.ts#L21))
