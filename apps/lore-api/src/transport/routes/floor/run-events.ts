// GET /api/assembly-runs/{id}/events — the agent events of a run on the external floor, in the shape and with the ids the Floor's own `/api/agent-events/{id}` and the live relay give them, so the run page folds a floor run's history without knowing which engine ran it.
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import type { AgentRunEvent } from "@re-cinq/lore-shared/models/agent-run-event.js";
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { floorRunHistory } from "../../../work/floor/floor-run-history.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";

/** The Floor's own page size, which the page reads as the end-of-history signal: a page shorter than this is the last. */
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 1000;
const ROWS_PER_TURN = 100n;

const EventPageSchema = z.object({
  events: z.array(z.record(z.string(), z.unknown())),
});

/** The run's events after a cursor, read off the floor's journal. */
export type EventsOf = (
  runId: string,
  after: string | undefined,
) => Promise<AgentRunEvent[]>;

const floorEvents: EventsOf = (runId, after) =>
  floorConfigured()
    ? floorRunHistory(floorClient().runs.watch, runId, after)
    : Promise.resolve([]);

export function floorRunEventsRoute(
  eventsOf: EventsOf = floorEvents,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/assembly-runs/{id}/events",
    options: zodResponse(bearerScope("read"), EventPageSchema, {
      name: "FloorRunEvents",
      description:
        "One page of the agent events of a run on the external floor, oldest first; empty for a run the floor does not have",
    }),
    handler: async (request: Request, h: ResponseToolkit) =>
      h.response(await servePage(eventsOf, request)),
  };
}

async function servePage(eventsOf: EventsOf, request: Request) {
  const events = await eventsOf(
    request.params.id as string,
    cursorOf(request.query.after),
  );

  return eventPage(events, request.query);
}

function cursorOf(value: unknown): string | undefined {
  return typeof value === "string" && /^\d+$/.test(value) ? value : undefined;
}

/** The events after the cursor, one page of them. Ids outgrow a JS number, so the cursor compares as a bigint, as the Floor's own read does. A page never ends inside a turn: the next read asks the journal for what follows the last turn it saw, so the rows of a turn cut in two would be lost. */
export function eventPage(
  events: AgentRunEvent[],
  query: { after?: unknown; limit?: unknown },
): { events: AgentRunEvent[] } {
  const after = BigInt(cursorOf(query.after) ?? "0");
  const limit = limitOf(query.limit);
  const unseen = events.filter((event) => BigInt(event.id) > after);

  return { events: unseen.slice(0, wholeTurns(unseen, limit)) };
}

// A limit that is no positive number reads as the default, so a malformed query pages like an unqualified one.
function limitOf(value: unknown): number {
  const asked = Number(value);

  return Number.isInteger(asked) && asked > 0
    ? Math.min(asked, MAX_LIMIT)
    : DEFAULT_LIMIT;
}

// Where the page ends: at the limit, moved on past the rest of the turn the limit landed in.
function wholeTurns(events: AgentRunEvent[], limit: number): number {
  const landed = Math.min(limit, events.length);
  const rest = events
    .slice(landed)
    .findIndex((event) => turnOf(event) !== turnOf(events[landed - 1]));

  return rest < 0 ? events.length : landed + rest;
}

function turnOf(event: AgentRunEvent | undefined): bigint | null {
  return event ? BigInt(event.id) / ROWS_PER_TURN : null;
}
