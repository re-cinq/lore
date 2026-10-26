// POST /api/assembly-runs/{id}/cancel — a person cancels an open floor run from its page, task or none.
import type { Request, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import type { CancelRunFloor } from "../../../work/floor/cancel-run.js";
import { cancelRun } from "../../../work/floor/cancel-run.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";

const CancelRunBody = z
  .object({ requested_by: z.string().min(1).optional() })
  .nullish();

const CancelledRun = z.object({
  cancelled: z.boolean(),
  run_id: z.string(),
});

const CANCEL_RUN_OPTIONS = zodResponse(
  {
    ...bearerScope("task"),
    validate: { payload: zodValidate(CancelRunBody) },
  },
  CancelledRun,
  {
    name: "AssemblyRunCancelled",
    description:
      "The floor cancelled the open run, with a reason naming who asked when the body says. 404 for a run the floor does not have, 409 for a run already finished",
    errors: [404, 409],
  },
);

export function cancelRunRoute(
  floorOf: () => CancelRunFloor = floorClient,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/assembly-runs/{id}/cancel",
    options: CANCEL_RUN_OPTIONS,
    handler: (request) => serveCancel(floorOf(), request),
  };
}

async function serveCancel(floor: CancelRunFloor, request: Request) {
  const body = request.payload as z.infer<typeof CancelRunBody>;
  const cancelled = await cancelRun(floor, {
    runId: request.params.id,
    requestedBy: body?.requested_by,
  });

  return { cancelled: true, run_id: cancelled.runId };
}
