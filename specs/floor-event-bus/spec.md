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

- FR3. When the handler for a claimed event succeeds, the loop marks that event row done. ([validated by `loop.test.ts:52`](apps/floor/src/main-loop/loop.test.ts#L52))

- FR4. When no handler is registered for an event name, the loop dead-letters the row immediately without retrying. ([validated by `loop.test.ts:62`](apps/floor/src/main-loop/loop.test.ts#L62))

- FR5. When the handler throws, the loop marks the row failed with the retry backoff below the attempt cap and dead-letters it at the cap. ([validated by `loop.test.ts:75`](apps/floor/src/main-loop/loop.test.ts#L75), [validated by `loop.test.ts:86`](apps/floor/src/main-loop/loop.test.ts#L86))

- FR6. The loop passes the event's params through to the dispatched handler. ([validated by `loop.test.ts:97`](apps/floor/src/main-loop/loop.test.ts#L97))

- FR7. The registry maps every event name a Floor producer can emit to a defined handler function. ([validated by `registry.test.ts:24`](apps/floor/src/main-loop/registry.test.ts#L28), [validated by `registry.test.ts:33`](apps/floor/src/main-loop/registry.test.ts#L37))

- FR8. A handler composed with `withExtra` runs the primary then every secondary in order, propagates a primary throw to preserve retry semantics, and swallows a secondary throw so it never breaks the primary. ([validated by `registry.test.ts:66`](apps/floor/src/main-loop/registry.test.ts#L66), [validated by `registry.test.ts:85`](apps/floor/src/main-loop/registry.test.ts#L85), [validated by `registry.test.ts:96`](apps/floor/src/main-loop/registry.test.ts#L96))

- FR9. The serial-family mechanism runs a family's events at most one at a time per Floor instance while every other event stays fully parallel: within a batch the family's events run one after the other, and while one is in flight the next drain's claim EXCLUDES the family so its waiting rows stay `pending` (never parked in `processing`, where the >600s reaper would reap a queued row as presumed-dead and re-run it concurrently). The busy marker clears when the handler finishes, thrown or not — and a serial handler whose promise never settles releases the family slot at a deadline just past the reaper's visibility timeout, leaving the abandoned handler to run unsupervised like any parallel one. The PRODUCTION family set is EMPTY since specs/ingest-station FR6 — no in-process dgraph writer remains (`internal.ingest.spec_trace` handlers only start assembly lines now); the mechanism stays as a general tool, injected through `LoopDeps.serialFamilies` (which is how the tests exercise it), and the default drain runs every event in parallel. ([validated by `loop.test.ts:188`](apps/floor/src/main-loop/loop.test.ts#L188), [validated by `loop.test.ts:225`](apps/floor/src/main-loop/loop.test.ts#L225), [validated by `loop.test.ts:248`](apps/floor/src/main-loop/loop.test.ts#L248), [validated by `loop.test.ts:266`](apps/floor/src/main-loop/loop.test.ts#L266), [validated by `loop.test.ts:157`](apps/floor/src/main-loop/loop.test.ts#L157), [validated by `event-queue.test.ts:25`](libs/shared/src/project/events/event-queue.test.ts#L25), [validated by `event-queue.test.ts:97`](libs/shared/src/project/events/event-queue.test.ts#L97); implemented by [`loop.ts:66`](apps/floor/src/main-loop/loop.ts#L66), [`event-queue-pg.ts:21`](libs/shared/src/project/events/event-queue-pg.ts#L21))
