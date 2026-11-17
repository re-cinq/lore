# Feature Specification: Ticket Search

| Field     | Value                                                                   |
|-----------|-------------------------------------------------------------------------|
| Feature   | Ticket Search                                                           |
| Status    | Shipped                                                                 |
| Created   | 2026-11-17                                                              |
| Owner     | Platform Engineering                                                    |
| Builds on | [specs/utopia-graph-mirror](../utopia-graph-mirror/spec.md)             |

The agents that file tickets (spec-tickets decompose, issue triage) filed duplicates of open tickets and tickets for work already done; one incident left more than 500 useless tickets. Utopia already mirrors every issue of a repository as a document of its `issues` source, so this feature gives agents a fuzzy search over a repository's issues, open and closed, to run before they file one.

## FR1 — The ticket search route

- `GET /api/repos/{owner}/{repo}/tickets/search` (read scope) searches the repository's Utopia knowledge base and answers `{tickets: [{number, title, state, labels, url, score, excerpt}]}`, highest score first. ([validated by returns closed #12 then open #30 with GitHub's state, title and labels @6ffda7a3](../../apps/lore-api/src/transport/routes/tickets/ticket-search.test.ts#L87))
- Only hits of the repository's `issues` source count, because the `test-coverage` statements source carries `issue:` items too. ([validated by returns issue #12 first for a query matching its title @58a49720](../../apps/lore-api/src/transport/routes/tickets/ticket-hits.test.ts#L22), [validated by returns nothing for issue items of the test-coverage source and pull request hits @bfc86bfb](../../apps/lore-api/src/transport/routes/tickets/ticket-hits.test.ts#L45))
- An issue matched by several chunks appears once, at its best-scoring chunk, whose text is the excerpt. ([validated by returns issue #12 once, with the text of its best-scoring chunk @e33bedef](../../apps/lore-api/src/transport/routes/tickets/ticket-hits.test.ts#L34))
- An excerpt longer than 280 characters is cut to 280, ending in an ellipsis. ([validated by cuts an excerpt of 400 characters to 280 ending in an ellipsis @b77db3fb](../../apps/lore-api/src/transport/routes/tickets/ticket-hits.test.ts#L55))
- Title, state and labels are read from GitHub, not from Utopia's lagging copy, and the `state` filter (`open`, `closed` or `all`, the default) applies to what GitHub says now. ([validated by returns only open #30 for state=open @6f0f6b9e](../../apps/lore-api/src/transport/routes/tickets/ticket-search.test.ts#L107))
- An issue GitHub no longer has is dropped. ([validated by drops a hit whose issue GitHub no longer has @0094731f](../../apps/lore-api/src/transport/routes/tickets/ticket-search.test.ts#L134))
- `limit` defaults to ten and is capped at 25. ([validated by returns one ticket for limit=1 @87de47d9](../../apps/lore-api/src/transport/routes/tickets/ticket-search.test.ts#L115))
- A repository with no Utopia base, or no `issues` source, answers 200 with no tickets and the note `search_tickets: <repo> has no Utopia base`. ([validated by returns no tickets and a note when the repo has no Utopia base @5f87fae3](../../apps/lore-api/src/transport/routes/tickets/ticket-search.test.ts#L123))
- A request with no query answers 400. ([validated by answers 400 for a missing query @e07b45d0](../../apps/lore-api/src/transport/routes/tickets/ticket-search.test.ts#L144))

## FR2 — The lore_search_tickets MCP tool

- `lore_search_tickets` takes a query, state, limit and repo, and asks the route for the given repository or the one detected from the checkout. ([validated by registers lore_search_tickets @c41af660](../../apps/mcp-server/src/transport/tools/tickets/index.test.ts#L6), [validated by asks the detected repo's ticket search with the query, state and limit @c419f6f3](../../apps/mcp-server/src/transport/tools/tickets/search-tickets.test.ts#L31))
- The shared gateway serves the tool in agent mode, so agent pods search before they file a ticket. ([validated by serves lore_search_tickets on the gateway, so agent pods search before filing @b9858ad2](../../apps/mcp-server/src/transport/build-mcp-server.test.ts#L52))
- It prints one line per ticket, `#N [state] title (score) url`, with the excerpt indented under it. ([validated by prints closed #12 with its state, title, score, url and excerpt @abc2c7f8](../../apps/mcp-server/src/transport/tools/tickets/search-tickets.test.ts#L42))
- With no match it says so, followed by the route's notes. ([validated by says no ticket matched and prints the API's note @36d72648](../../apps/mcp-server/src/transport/tools/tickets/search-tickets.test.ts#L69))
- On the gateway a search that names no repository is refused. ([validated by refuses a search with no repo on the gateway @e107836a](../../apps/mcp-server/src/transport/tools/tickets/search-tickets.test.ts#L87))
- A failed API read comes back as text. ([validated by reports a failed API read as text @562f689b](../../apps/mcp-server/src/transport/tools/tickets/search-tickets.test.ts#L97))
