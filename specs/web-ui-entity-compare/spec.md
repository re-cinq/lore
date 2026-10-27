# Feature Specification: Entity and Compare screens

| Field    | Value                                          |
|----------|------------------------------------------------|
| Feature  | Entity and Compare screens (Lore v2)           |
| Branch   | ui-rework-lore-logo                            |
| Status   | Shipped                                        |
| Created  | 2026-10-20                                     |
| Owner    | Platform Engineering                           |

Two web-ui screens from the Lore v2 design that had no page before: a page for one knowledge-graph entity, and a side-by-side comparison of two runs of one line. Each is composed from reads lore-api already serves; neither adds an endpoint. The design's third new screen, the inbox, needs backend work and is specified on its own in `specs/inbox/spec.md`.

## Background

The entity page reads the graph browser's `GET /api/graph-browse?entity=<name>&show_invalid=true` and the search page's `GET /api/memory-search?q=<name>` through `getEntity` (`apps/web-ui/src/lib/api/entities.ts`).

The compare page reads both runs, their station visits and their token usage through the run page's own readers, and A's repository's floor runs for the candidates.

## Entity (`/entities/<name>`)

- FR-1.1: A name that neither an entity row nor an edge carries is not an entity, and the page says the graph holds none rather than failing. ([validated by answers null when neither an entity row nor an edge names it](apps/web-ui/src/lib/api/entities.test.ts#L21), [validated by says the graph has no such entity instead of failing](apps/web-ui/src/app/entities/[name]/EntityView.test.tsx#L80))
- FR-1.2: Every relationship is read from the entity's side, newest first, with ended ones kept; only the ones that still hold are counted as active. ([validated by reads each edge from the entity's side, newest first, counting only the ones that still hold](apps/web-ui/src/lib/api/entities.test.ts#L25))
- FR-1.3: The entity's type comes from its row when the browse page carried it, else from an edge that names it. ([validated by takes the type from an edge when the browse page did not carry the entity row](apps/web-ui/src/lib/api/entities.test.ts#L43))
- FR-1.4: The header shows the type, the repository, the active count and a link that opens the entity in the graph browser. ([validated by heads the page with the entity's type, repo, active count and a link back to the graph](apps/web-ui/src/app/entities/[name]/EntityView.test.tsx#L47))
- FR-1.5: An ended relationship is marked ended with both dates, and every other end links to its own entity page. ([validated by marks a relationship that stopped holding as ended and links every other end to its own page](apps/web-ui/src/app/entities/[name]/EntityView.test.tsx#L62))
- FR-1.6: "What Lore knows" lists the memories and facts that mention the entity, each with its source and agent. ([validated by turns each memory hit into a fact with its source and agent](apps/web-ui/src/lib/api/entities.test.ts#L53), [validated by lists what memory holds about the entity](apps/web-ui/src/app/entities/[name]/EntityView.test.tsx#L72))

## Compare (`/compare?a=<run>&b=<run>`)

- FR-2.1: With no run chosen the page points to the run list. ([validated by points to the run list when no run is chosen](apps/web-ui/src/app/compare/CompareView.test.tsx#L54))
- FR-2.2: The other runs of A's line in A's repository are chips that keep A and set B. ([validated by offers the other runs of A's line as chips that keep A](apps/web-ui/src/app/compare/CompareView.test.tsx#L62))
- FR-2.2a: A picked B that is not among the newest candidates still shows as the active chip. ([validated by keeps the picked B as the active chip when it is not among the candidates](apps/web-ui/src/app/compare/CompareView.test.tsx#L78))
- FR-2.3: Time per station sums every visit of a station; A's stations come first, then B's own. Both bars scale against the longest station time, and the difference A − B is left out where either run never reached the station. ([validated by sums every visit of a station and lists A's stations before B's own](apps/web-ui/src/app/compare/compare-runs.test.ts#L18), [validated by scales both bars against the longest station time and leaves the delta out where a run never got](apps/web-ui/src/app/compare/compare-runs.test.ts#L31), [validated by draws the time per station for both runs with the difference A − B](apps/web-ui/src/app/compare/CompareView.test.tsx#L93))
- FR-2.4: "What's different" names the station with the largest gap and the slower run, or says the runs never differ. ([validated by names the station with the largest gap and the slower run](apps/web-ui/src/app/compare/compare-runs.test.ts#L43), [validated by says when the runs never differ](apps/web-ui/src/app/compare/compare-runs.test.ts#L52))
- FR-2.5: A difference is signed, and a missing one is a dash. ([validated by signs the difference and dashes a missing one](apps/web-ui/src/app/compare/compare-runs.test.ts#L60))
- FR-2.6: The metrics table sets status, duration, token count, station visits and pull request side by side; it shows no cost. ([validated by sets the two runs' token counts side by side](apps/web-ui/src/app/compare/CompareView.test.tsx#L97))

## Out of Scope

What the design shows and lore-api does not serve: an entity's summary, duplicate detection and merge, pinning or flagging a fact, the spec statements, ADRs, runs and gaps that mention an entity, and who started a run beyond the run's own `created_by`.
