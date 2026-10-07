// POST /api/assembly-runs/{id}/nodes/{node}/run — a person runs one station of a floor run again, open or finished: the floor reopens a finished run to take it.
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  runNodeByHand,
  type FloorPatience,
  type HandStartFloor,
  type RunNodeAsk,
} from "../../../work/floor/run-node-by-hand.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";

const RunNodeBody = z.object({ requested_by: z.string().min(1) });

const NodeRunAsked = z.object({ run_id: z.string(), pending: z.boolean() });

const RUN_NODE_OPTIONS = zodResponse(
  {
    ...bearerScope("task"),
    validate: { payload: zodValidate(RunNodeBody) },
  },
  NodeRunAsked,
  {
    name: "NodeRunAsked",
    status: 202,
    description:
      "The floor was asked to run the node again in its run, in the person's name; pending when it had not taken the ask within a few seconds. 400 for the line's exit or fail node or a node it does not have, 404 for a run the floor does not have, 409 with the floor's reason when it refused",
    errors: [400, 404, 409],
  },
);

export function runNodeRoute(
  floorOf: () => HandStartFloor = floorClient,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/assembly-runs/{id}/nodes/{node}/run",
    options: RUN_NODE_OPTIONS,
    handler: (request, h) => serveRunNode(floorOf, request, h),
  };
}

async function serveRunNode(
  floorOf: () => HandStartFloor,
  request: Request,
  h: ResponseToolkit,
) {
  const { requested_by } = request.payload as z.infer<typeof RunNodeBody>;
  const asked = await handleRunNode(floorOf(), {
    runId: request.params.id,
    nodeId: request.params.node,
    actor: requested_by,
  });

  return h.response(asked).code(202);
}

export async function handleRunNode(
  floor: HandStartFloor,
  ask: RunNodeAsk,
  patience?: FloorPatience,
): Promise<z.infer<typeof NodeRunAsked>> {
  const { runId, pending } = await runNodeByHand(floor, ask, patience);

  return { run_id: runId, pending };
}
