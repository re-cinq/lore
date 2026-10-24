// GET /api/repos/{owner}/{repo}/spec-tickets — the spec tickets loop as the Loops tab shows it: the specs it is splitting, the ones whose split failed, and the ones it ticketed this week, in the shared loop sections.
import type { ServerRoute } from "@hapi/hapi";
import { SPEC_TICKETS_LINE } from "@re-cinq/lore-shared/spec-tickets/floor-spec-tickets.js";
import type { FloorRunPageOf } from "../floor/floor-runs.js";
import { onboardedProject } from "../repos/github-read.js";
import { loopReadRoute } from "../loops/loop-read-route.js";
import { SpecTicketsSchema, ticketsQueues } from "./tickets-queues.js";

/** Enough runs to hold a week of merged specs with their newest run each. */
const RUNS_READ = 40;

/** How far back Recently addressed looks. */
const RECENT_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export function specTicketsRoute(pageOf: FloorRunPageOf): ServerRoute {
  return loopReadRoute({
    segment: "spec-tickets",
    schema: SpecTicketsSchema,
    name: "SpecTickets",
    description:
      "The spec tickets loop: the specs being split into issues, the ones whose split failed, and the ones ticketed this week, in the shared loop sections",
    read: (fullName) => readQueues(pageOf, fullName),
  });
}

async function readQueues(pageOf: FloorRunPageOf, fullName: string) {
  await onboardedProject(fullName);
  const page = await pageOf({
    repo: fullName,
    line: SPEC_TICKETS_LINE,
    limit: RUNS_READ,
  });

  return ticketsQueues({
    runs: page.runs,
    since: new Date(Date.now() - RECENT_DAYS * DAY_MS).toISOString(),
  });
}
