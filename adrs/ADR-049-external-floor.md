---
adr_number: 49
title: "The external floor replaces apps/floor, one family of lines at a time"
status: accepted
date: 2026-09-30
deciders: ["Bogdan Szabo"]
domains: [architecture, execution-model, code-review, lore-api, stations]
---

# ADR-049: The external floor replaces apps/floor, one family of lines at a time

The Floor was rewritten as a standalone engine, [re-cinq/floor](https://github.com/re-cinq/floor), and runs in the same cluster as Lore. This ADR records how Lore moves onto it: through `@re-cinq/floor-client` only, one family of assembly lines per slice, with both floors running side by side until the last line has moved and `apps/floor` is deleted.

## Context

`apps/floor` holds three powers ([ADR-024](ADR-024-ubiquitous-language-execution-model.md)): the event drain, the assembly-run walk with station dispatch, and the live bus. Around the walk it grew everything a line needed from GitHub — starting lines from webhooks, posting reviews from hooks that ran after a node, stamping pull requests, settling tasks. The external floor keeps the walk and drops the rest: it holds no provider client, never calls out, and hands every piece of work to whoever claims it from its queue. What was a hook inside Lore's Floor is a station there, visible in the graph and retried by the same rules.

That split leaves Lore three jobs the external floor names itself: start its lines, run a service station for every GitHub action a line takes, and mint the git credentials its agent pods ask for.

The move is made one family of lines per slice: detection, ingest, merge, implementation and planning follow the code-review lines, each as its own slice that converts the lines, writes their stations, re-points what starts them and deletes their path from `apps/floor`.

## Decision

- **One client.** Everything in Lore reaches the external floor through `@re-cinq/floor-client`, built once in `libs/shared/src/outbound/floor/`. Nothing reads the floor's database. ([validated by is configured when both the url and the service token are set](../libs/shared/src/outbound/floor/floor-client.test.ts#L5), [validated by builds a client that serves runs when both are set](../libs/shared/src/outbound/floor/floor-client.test.ts#L28), [validated by spells re-cinq/Otto as github.com/re-cinq/otto](../libs/shared/src/outbound/floor/floor-items.test.ts#L13))
- **The two floors never run the same line.** The code-review lines move first ([specs/external-floor](../specs/external-floor/spec.md)), and the pull-request and comment events they took are unregistered on `apps/floor`. ([validated by leaves the pull-request and comment events the external floor now takes unregistered](../apps/floor/src/events/main-loop/registry.test.ts#L43), [validated by answers every review event name it asks the bus for](../apps/stations/src/events/floor-review-handlers.test.ts#L82))
- **Definitions are floor pipeline files in this repository**, under `libs/assembly-lines/src/floor-pipelines/`, written by hand in the floor's own format with the prompt inline. lore-api puts every pipeline at boot; a version is its content, so what the floor already holds is untouched, an edit made there stays the latest, and only a file changed in the release becomes a new version. ([validated by ships exactly the pipelines code-review, code-review-recheck, code-review-reply and lore-run-settled](../libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L55), [validated by reports nothing changed when the floor holds every pipeline as written](../apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts#L89), [validated by reports both lines as changed on a floor that holds neither](../apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts#L80))
- **Lines are started through the API, not by forwarding webhooks.** `lines.start` answers whether the run was joined, which the announcement comment and the re-check decision both need. The stations service makes the call from the bus, so a floor that is down costs a delayed review and not a lost one. ([validated by announces run-new with a link to its run page](../libs/shared/src/work/review/floor-review-start.test.ts#L140), [validated by posts no announcement for a review it joined](../libs/shared/src/work/review/floor-review-start.test.ts#L150), [validated by starts code-review when a pull request opens in a repository with auto_review on](../apps/stations/src/events/floor-review-handlers.test.ts#L90))
- **Stations live in `apps/stations/src/<family>/<station>/`**, one folder each, written with `@re-cinq/floor-station`. They claim from the floor's queue; nothing in Lore dispatches them. ([validated by creates the review, upserts the neutral check and reports success with the summary and url](../apps/stations/src/code-review/post-review/station.test.ts#L71), [validated by produces body plus inline comment 700 for review 55 on PR 412 of re-cinq/lore](../apps/stations/src/code-review/read-review/station.test.ts#L69), [validated by fails the check on sha-1 of re-cinq/lore for a code-review run settled as error](../apps/stations/src/code-review/run-settled/station.test.ts#L66))
- **The run page stays one page.** lore-api answers a run from Postgres first and from the floor otherwise, and relays the floor's per-run socket onto the run channel the browser already holds ([ADR-048](ADR-048-one-websocket-for-live-channels.md)). ([validated by answers local-1 from Postgres](../apps/lore-api/src/work/floor/floor-backed-runs.test.ts#L46), [validated by answers floor-1 from the floor when Postgres has no such run](../apps/lore-api/src/work/floor/floor-backed-runs.test.ts#L50), [validated by sends the run, its visit, the replayed turn and then catchup_complete](../apps/lore-api/src/work/floor/floor-run-feed.test.ts#L52))

## Consequences

- The floor's own cluster agent runs the pods of the moved lines. Lore's cluster agent, its catalog sync and lore-api's claim routes keep serving the lines still on `apps/floor`, and go with it.
- A deployment without `enable_external_floor` has no code review: the old path is gone, and the stations service subscribes to pull-request events only when a floor is configured.
- The prompts of moved lines are no longer rows of `lore.agent_definitions`; the `/agents` editor does not reach them, and a prompt change is a change on the floor or a new pipeline file.
- Until the last slice, a run lives in one of two stores. The decorator that hides this is deleted with `apps/floor`.
- [ADR-044](ADR-044-event-router-owns-the-event-bus.md) still holds for Lore's own bus: GitHub's webhooks land on the event-router, and the stations service turns the ones a moved line cares about into calls on the floor.
