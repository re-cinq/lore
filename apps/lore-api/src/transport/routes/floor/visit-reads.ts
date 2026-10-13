// GET /api/assembly-runs/{id}/visits/{visitId}/model-calls and …/events — what one visit of a run on the external floor called and which events it handled and raised (run-viz FR4.1i). Keyed by the visit id rather than a pod name: a person's visit has no pod.
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { floorConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { floorRunReader } from "../../../work/floor/floor-backed-runs.js";
import type { ModelCall } from "../../../work/floor/floor-model-calls.js";
import type { VisitEventRow } from "../../../work/floor/floor-visit-events.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";

const ModelCallSchema = z.object({
  seq: z.number(),
  occurredAt: z.string(),
  model: z.string().nullable(),
  costUsd: z.number().nullable(),
  tokensIn: z.number().nullable(),
  tokensOut: z.number().nullable(),
});

const VisitEventSchema = z.object({
  id: z.string(),
  name: z.string(),
  direction: z.enum(["handled", "raised"]),
  inferred: z.boolean(),
  created_at: z.string(),
  acked_at: z.string().nullable(),
  claimed_by: z.string().nullable(),
  attempts: z.number(),
  last_error: z.string().nullable(),
  dead_at: z.string().nullable(),
  payload: z.unknown(),
});

export type VisitModelCallsOf = (
  runId: string,
  visitId: string,
) => Promise<ModelCall[] | null>;

export type VisitEventsOf = (
  runId: string,
  visitId: string,
) => Promise<VisitEventRow[] | null>;

export const floorVisitModelCalls: VisitModelCallsOf = (runId, visitId) =>
  floorConfigured()
    ? floorRunReader().visitModelCalls(runId, visitId)
    : Promise.resolve(null);

export const floorVisitEvents: VisitEventsOf = (runId, visitId) =>
  floorConfigured()
    ? floorRunReader().visitEvents(runId, visitId)
    : Promise.resolve(null);

export function visitModelCallsRoute(callsOf: VisitModelCallsOf): ServerRoute {
  return visitRead({
    path: "/api/assembly-runs/{id}/visits/{visitId}/model-calls",
    name: "VisitModelCalls",
    description:
      "The model calls one visit of a floor run made, from its llm_call records: model, tokens in and out, cost; 404 for a visit of no run the floor has",
    schema: z.object({ calls: z.array(ModelCallSchema) }),
    read: async (runId, visitId) => {
      const calls = await callsOf(runId, visitId);

      return calls === null ? null : { calls };
    },
  });
}

export function visitEventsRoute(eventsOf: VisitEventsOf): ServerRoute {
  return visitRead({
    path: "/api/assembly-runs/{id}/visits/{visitId}/events",
    name: "VisitEvents",
    description:
      "The floor events one visit handled and raised, each with its direction, whether the link was inferred, and its queue state; 404 for a visit of no run the floor has",
    schema: z.object({ events: z.array(VisitEventSchema) }),
    read: async (runId, visitId) => {
      const events = await eventsOf(runId, visitId);

      return events === null ? null : { events };
    },
  });
}

interface VisitRead<Body> {
  path: string;
  name: string;
  description: string;
  schema: z.ZodType<Body>;
  read: (runId: string, visitId: string) => Promise<Body | null>;
}

function visitRead<Body>(spec: VisitRead<Body>): ServerRoute {
  return {
    method: "GET",
    path: spec.path,
    options: zodResponse(bearerScope("read"), spec.schema, {
      name: spec.name,
      description: spec.description,
      errors: [404],
    }),
    handler: (request: Request, h: ResponseToolkit) =>
      serveVisitRead(spec, request, h),
  };
}

async function serveVisitRead<Body>(
  spec: VisitRead<Body>,
  request: Request,
  h: ResponseToolkit,
) {
  const body = await spec.read(
    request.params.id as string,
    request.params.visitId as string,
  );

  enforceTrue(body !== null, apiError(404), "no such visit of this run");

  return h.response(body);
}
