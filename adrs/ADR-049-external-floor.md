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

## Decision

- **One client.** Everything in Lore reaches the external floor through `@re-cinq/floor-client`, built once in `libs/shared/src/outbound/floor/`. Nothing reads the floor's database.
- **One family per slice.** The code-review lines move first ([specs/external-floor](../specs/external-floor/spec.md)); detection, ingest, merge, implementation and planning follow, each as its own slice that converts the lines, writes their stations, re-points what starts them and deletes their path from `apps/floor`. The two floors never run the same line.
- **Definitions are floor pipeline files in this repository**, under `libs/assembly-lines/src/floor-pipelines/`, written by hand in the floor's own format with the prompt inline. lore-api seeds a pipeline only when the floor does not have its line, so the floor's copy is the one that runs and an edit made there survives a deploy.
- **Lines are started through the API, not by forwarding webhooks.** `lines.start` answers whether the run was joined, which the announcement comment and the re-check decision both need. The stations service makes the call from the bus, so a floor that is down costs a delayed review and not a lost one.
- **Stations live in `apps/stations/src/<family>/<station>/`**, one folder each, written with `@re-cinq/floor-station`. They claim from the floor's queue; nothing in Lore dispatches them.
- **The floor's own cluster agent runs the pods.** Lore's cluster agent, its catalog sync and lore-api's claim routes keep serving the lines still on `apps/floor`, and go with it.
- **The run page stays one page.** lore-api answers a run from Postgres first and from the floor otherwise, and relays the floor's per-run socket onto the run channel the browser already holds ([ADR-048](ADR-048-one-websocket-for-live-channels.md)).

## Consequences

- A deployment without `enable_external_floor` has no code review: the old path is gone, and the stations service subscribes to pull-request events only when a floor is configured.
- The prompts of moved lines are no longer rows of `lore.agent_definitions`; the `/agents` editor does not reach them, and a prompt change is a change on the floor or a new pipeline file.
- Until the last slice, a run lives in one of two stores. The decorator that hides this is deleted with `apps/floor`.
- [ADR-044](ADR-044-event-router-owns-the-event-bus.md) still holds for Lore's own bus: GitHub's webhooks land on the event-router, and the stations service turns the ones a moved line cares about into calls on the floor.
