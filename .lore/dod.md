# Definition of Done

Ticket claim: "a dedicated CronJob pod that holds no business logic and posts a message to start an assembly line"

Strategy: direct

Why: The `stationsRoute` handler is the real entry point for simple scheduled jobs (`POST /api/stations/{name}`); Hapi's `server.inject()` calls it without any stub, so a failing assertion on the response body is a genuine red bar against live behaviour.

Acceptance tests:
  - apps/stations/src/transport/routes/stations.test.ts::POST /api/stations/{name} > does not expose the job's failure reason in the response body — a Boom error from a station must not reach the courier — pins FR9.2: a Boom 503 thrown by a station propagates verbatim through Hapi, leaking the error message (which can contain DB connection strings) to the courier. The test fails: `expected { status: 503, bodyContainsSecret: true } to deeply equal { status: 500, bodyContainsSecret: false }`.

Facets (red-green-refactor steps, smallest first):
  - Add a try/catch inside `runStationHandler` that catches any error thrown by `station()`, logs it internally, and re-throws a bare `Boom.internal()` (no message), so sensitive details stay in server logs rather than the wire response.
  - The `finally` block already releases the in-flight latch — the catch must sit between the await and the finally so the latch is still freed on all paths.

Out of scope: The POST /api/assembly-runs route (FR8) is already fully implemented and all its statements are linked in start-run.test.ts. The courier CronJob manifest (courier-cronjob.yaml) already exists in stations-helm. The per-job conversion tickets (#1351, #1350, #1348, #1353) are separate. FR9.1 ({job, summary}) is implemented and linked (stations.test.ts:98).
