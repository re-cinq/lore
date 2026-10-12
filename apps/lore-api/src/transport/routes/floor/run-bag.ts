// GET /api/assembly-runs/{id}/bag — the items the external floor holds in a run's bag, for the run page's facts card (run-viz FR4.4n). A run the floor does not have, including every run Lore's own engine walked, has none.
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { runBag, type RunBag } from "../../../work/floor/floor-run-bag.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";

const BagItemSchema = z.object({
  kind: z.enum(["value", "file", "git"]),
  ref: z.string(),
  by: z.string(),
  sha: z.string().optional(),
});

const RunBagSchema = z.object({ bag: z.record(z.string(), BagItemSchema) });

export type RunBagOf = (runId: string) => Promise<RunBag | null>;

/** The floor's bag, when a floor is configured; a deployment without one has no bags to show. */
export const floorRunBag: RunBagOf = (runId) =>
  floorConfigured() ? runBag(floorClient(), runId) : Promise.resolve(null);

export function runBagRoute(bagOf: RunBagOf): ServerRoute {
  return {
    method: "GET",
    path: "/api/assembly-runs/{id}/bag",
    options: zodResponse(bearerScope("read"), RunBagSchema, {
      name: "RunBag",
      description:
        "The items the external floor holds in a run's bag right now, by name, each with its kind (value, file or git), its ref, who put it there and, for a git item, the commit; 404 for a run the floor does not have",
      errors: [404],
    }),
    handler: (request: Request, h: ResponseToolkit) =>
      serveRunBag(bagOf, request, h),
  };
}

async function serveRunBag(
  bagOf: RunBagOf,
  request: Request,
  h: ResponseToolkit,
) {
  const bag = await bagOf(request.params.id as string);

  enforceTrue(bag !== null, apiError(404), "no bag for this run");

  return h.response({ bag });
}
