// GET /api/floor-runs — one page of the external floor's runs, newest first, each with its mini pipeline: what the live run list reads, and reads again when the floor says a run started.
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { floorConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { AssemblyRunStatusSchema } from "@re-cinq/lore-shared/models/assembly-run.js";
import { floorRunRows } from "../../../work/floor/floor-backed-runs.js";
import type { FloorRunPageQuery } from "../../../work/floor/floor-run-reader.js";
import { FloorRunPageSchema } from "../../../work/floor/floor-run-rows.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";

const MAX_LIMIT = 100;

const FloorRunsQuery = z.object({
  status: AssemblyRunStatusSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(), // eslint-disable-line re-lint/max-member-chain -- pipeline over a value already in hand
});

export type FloorRunPageOf = (
  query: FloorRunPageQuery,
) => Promise<z.infer<typeof FloorRunPageSchema>>;

/** The floor's pages where a floor is configured; an empty page where none is. */
export const floorRunPages: FloorRunPageOf = async (query) =>
  floorConfigured()
    ? floorRunRows().page(query)
    : { runs: [], next_cursor: null };

export function floorRunsRoute(pageOf: FloorRunPageOf): ServerRoute {
  const validate = { query: zodValidate(FloorRunsQuery) };

  return {
    method: "GET",
    path: "/api/floor-runs",
    options: zodResponse(
      { ...bearerScope("read"), validate },
      FloorRunPageSchema,
      {
        name: "FloorRunPage",
        description:
          "One page of the external floor's runs, newest first, each with its mini pipeline",
      },
    ),
    handler: async (request: Request, h: ResponseToolkit) =>
      h.response(await pageOf(request.query as FloorRunPageQuery)),
  };
}
