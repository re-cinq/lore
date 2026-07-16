# Feature Specification: Floor Event Bus

| Field   | Value                    |
|---------|--------------------------|
| Feature | Floor Event Bus          |
| Status  | Shipped                  |
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
