# Definition of Done

Ticket claim: "a dedicated CronJob pod that holds no business logic and posts a message to start an assembly line"

Strategy: direct

Why: The `stationsRoute` handler is the real entry point for simple scheduled jobs (`POST /api/stations/{name}`); Hapi's `server.inject()` calls it without any stub, so a failing assertion on the response body is a genuine red bar against live behaviour.

Acceptance tests:
  - apps/stations/src/transport/routes/stations.test.ts::POST /api/stations/{name} > includes the station name as 'job' in the 200 body, so a courier or operator can confirm which station ran — pins FR9.1: the endpoint must return `{ job, summary }` not just `{ summary }`. The `job` field is currently absent; the test fails with "expected 'job' to be 'approval-check', received undefined".

Facets (red-green-refactor steps, smallest first):
  - Change `h.response({ summary: await station() })` in `apps/stations/src/transport/routes/stations.ts` to `h.response({ job: name, summary: await station() })` — one line.
  - Update the existing `toEqual({ summary: "..." })` assertion in `stations.test.ts` to `toEqual({ job: "approval-check", summary: "..." })` so the strict equality check stays honest.

Out of scope: The POST /api/assembly-runs route (FR8) is already fully implemented and all its statements are linked in start-run.test.ts. The courier CronJob manifest (courier-cronjob.yaml) already exists in stations-helm. The per-job conversion tickets (#1351, #1350, #1348, #1353) are separate.
