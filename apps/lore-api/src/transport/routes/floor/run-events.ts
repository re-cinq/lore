// GET /api/assembly-runs/{id}/events — the agent events of a run on the external floor, in the shape and with the ids the Floor's own `/api/agent-events/{id}` and the live relay give them, so the run page folds a floor run's history without knowing which engine ran it.
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import type { AgentRunEvent } from "@re-cinq/lore-shared/models/agent-run-event.js";
import { floorConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { floorRunReader } from "../../../work/floor/floor-backed-runs.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";

/** The Floor's own page size, which the page reads as the end-of-history signal: a page shorter than this is the last. */
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 1000;

const EventPageSchema = z.object({
  events: z.array(z.record(z.string(), z.unknown())),
});

export type EventsOf = (runId: string) => Promise<AgentRunEvent[]>;

const floorEvents: EventsOf = (runId) =>
  floorConfigured() ? floorRunReader().agentEvents(runId) : Promise.resolve([]);

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
      h.response(
        eventPage(await eventsOf(request.params.id as string), request.query),
      ),
  };
}

/** The events after the cursor, one page of them. Ids outgrow a JS number, so the cursor compares as a bigint, as the Floor's own read does. */
export function eventPage(
  events: AgentRunEvent[],
  query: { after?: unknown; limit?: unknown },
): { events: AgentRunEvent[] } {
  const after = BigInt(String(query.after ?? "0") || "0");
  const limit = Math.min(Number(query.limit) || DEFAULT_LIMIT, MAX_LIMIT);

  return {
    events: events.filter((event) => BigInt(event.id) > after).slice(0, limit),
  };
}
