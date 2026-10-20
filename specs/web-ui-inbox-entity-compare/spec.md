# Feature Specification: Inbox, Entity and Compare screens

| Field    | Value                                          |
|----------|------------------------------------------------|
| Feature  | Inbox, Entity and Compare screens (Lore v2)    |
| Branch   | ui-rework-lore-logo                            |
| Status   | Shipped                                        |
| Created  | 2026-10-20                                     |
| Owner    | Platform Engineering                           |

Three web-ui screens from the Lore v2 design that had no page before: an inbox of everything waiting on a person, a page for one knowledge-graph entity, and a side-by-side comparison of two runs of one line. Each is composed from reads lore-api already serves; none adds an endpoint.

## Background

The inbox reads one page of the floor's failed runs and one of its running runs (`GET /api/floor-runs?status=`) through `getInboxItems` (`apps/web-ui/src/lib/api/inbox.ts`).

The entity page reads the graph browser's `GET /api/graph-browse?entity=<name>&show_invalid=true` and the search page's `GET /api/memory-search?q=<name>` through `getEntity` (`apps/web-ui/src/lib/api/entities.ts`).

The compare page reads both runs, their station visits and their token usage through the run page's own readers, and A's repository's floor runs for the candidates.

## Inbox (`/inbox`)

- FR-1.1: Failures come first, newest first, then runs parked at a station whose state is `waiting`, the longest-waiting first. ([validated by puts failures first, then parked runs with the longest-waiting first](apps/web-ui/src/lib/api/inbox.test.ts#L38))
- FR-1.2: A running run with no station waiting is not in the inbox, and neither is a failure older than seven days. ([validated by leaves out a running run with no station waiting and a failure older than a week](apps/web-ui/src/lib/api/inbox.test.ts#L52))
- FR-1.3: A parked item names the station it waits at and links the run's pull request, else its issue. ([validated by names the waiting station and links the pull request ahead of the issue](apps/web-ui/src/lib/api/inbox.test.ts#L61))
- FR-1.4: A failed item is explained with the run's own reason. ([validated by explains a failure with the run's own reason](apps/web-ui/src/lib/api/inbox.test.ts#L76))
- FR-1.5: Chips above the list filter it to All, Failed or Waiting. Each chip is a link carrying `?kind=` with the count it would show; an unknown kind reads as All. ([validated by links each chip to its filter with the count it would show](apps/web-ui/src/app/inbox/InboxView.test.tsx#L32), [validated by keeps only the chosen kind under its chip](apps/web-ui/src/app/inbox/InboxView.test.tsx#L39), [validated by reads a known kind and falls back to all for anything else](apps/web-ui/src/app/inbox/InboxView.test.tsx#L82))
- FR-1.6: An empty inbox says nothing is waiting. ([validated by says nothing is waiting when the inbox is empty](apps/web-ui/src/app/inbox/InboxView.test.tsx#L46))
- FR-1.7: Each card opens its run, and its pull request or issue when it has one. ([validated by offers the run and its pull request as the card's actions](apps/web-ui/src/app/inbox/InboxView.test.tsx#L64))
- FR-1.8: One card is selected at a time: `j` and `k` move the selection within the list, `e` opens the selected run, and a key typed into a field is left to the field. ([validated by moves down with j and up with k, staying inside the list](apps/web-ui/src/app/inbox/inbox-keys.test.ts#L5), [validated by opens with e and ignores every key on an empty list](apps/web-ui/src/app/inbox/inbox-keys.test.ts#L11), [validated by moves the selection with j and opens the selected run with e](apps/web-ui/src/app/inbox/InboxView.test.tsx#L52))

## Entity (`/entities/<name>`)

- FR-2.1: A name that neither an entity row nor an edge carries is not an entity, and the page says the graph holds none rather than failing. ([validated by answers null when neither an entity row nor an edge names it](apps/web-ui/src/lib/api/entities.test.ts#L21), [validated by says the graph has no such entity instead of failing](apps/web-ui/src/app/entities/[name]/EntityView.test.tsx#L80))
- FR-2.2: Every relationship is read from the entity's side, newest first, with ended ones kept; only the ones that still hold are counted as active. ([validated by reads each edge from the entity's side, newest first, counting only the ones that still hold](apps/web-ui/src/lib/api/entities.test.ts#L25))
- FR-2.3: The entity's type comes from its row when the browse page carried it, else from an edge that names it. ([validated by takes the type from an edge when the browse page did not carry the entity row](apps/web-ui/src/lib/api/entities.test.ts#L43))
- FR-2.4: The header shows the type, the repository, the active count and a link that opens the entity in the graph browser. ([validated by heads the page with the entity's type, repo, active count and a link back to the graph](apps/web-ui/src/app/entities/[name]/EntityView.test.tsx#L47))
- FR-2.5: An ended relationship is marked ended with both dates, and every other end links to its own entity page. ([validated by marks a relationship that stopped holding as ended and links every other end to its own page](apps/web-ui/src/app/entities/[name]/EntityView.test.tsx#L62))
- FR-2.6: "What Lore knows" lists the memories and facts that mention the entity, each with its source and agent. ([validated by turns each memory hit into a fact with its source and agent](apps/web-ui/src/lib/api/entities.test.ts#L53), [validated by lists what memory holds about the entity](apps/web-ui/src/app/entities/[name]/EntityView.test.tsx#L72))

## Compare (`/compare?a=<run>&b=<run>`)

- FR-3.1: With no run chosen the page points to the run list. ([validated by points to the run list when no run is chosen](apps/web-ui/src/app/compare/CompareView.test.tsx#L54))
- FR-3.2: The other runs of A's line in A's repository are chips that keep A and set B. ([validated by offers the other runs of A's line as chips that keep A](apps/web-ui/src/app/compare/CompareView.test.tsx#L62))
- FR-3.3: Time per station sums every visit of a station; A's stations come first, then B's own. Both bars scale against the longest station time, and the difference A − B is left out where either run never reached the station. ([validated by sums every visit of a station and lists A's stations before B's own](apps/web-ui/src/app/compare/compare-runs.test.ts#L18), [validated by scales both bars against the longest station time and leaves the delta out where a run never got](apps/web-ui/src/app/compare/compare-runs.test.ts#L31), [validated by draws the time per station for both runs with the difference A − B](apps/web-ui/src/app/compare/CompareView.test.tsx#L78))
- FR-3.4: "What's different" names the station with the largest gap and the slower run, or says the runs never differ. ([validated by names the station with the largest gap and the slower run](apps/web-ui/src/app/compare/compare-runs.test.ts#L43), [validated by says when the runs never differ](apps/web-ui/src/app/compare/compare-runs.test.ts#L52))
- FR-3.5: A difference is signed, and a missing one is a dash. ([validated by signs the difference and dashes a missing one](apps/web-ui/src/app/compare/compare-runs.test.ts#L60))
- FR-3.6: The metrics table sets status, duration, token count, station visits and pull request side by side; it shows no cost. ([validated by sets the two runs' token counts side by side](apps/web-ui/src/app/compare/CompareView.test.tsx#L87))

## Out of Scope

What the design shows and lore-api does not serve: inbox actions taken in place and the "handled this session" undo list, an entity's summary, duplicate detection and merge, pinning or flagging a fact, the spec statements, ADRs, runs and gaps that mention an entity, and who started a run beyond the run's own `created_by`.
