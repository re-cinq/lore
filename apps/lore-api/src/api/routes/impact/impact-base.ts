import { zodResponse } from "../../../server/plugins/zod-response.js";
import { z } from "zod";
/** The commit whose line numbering the graph's ranges are expressed in (needed for diff validation). */

import type { ServerRoute } from "@hapi/hapi";
import { createDgraphClient, readGraphBaseline } from "@re-cinq/lore-shared";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

// Shared object (hapi serializes to JSON, never hands to caller).
const UNSTAMPED = { graphCommit: null, graphCommitAt: null, source: "none" };

/** The commit a repo's impact reports are measured against. */
const ImpactBaseSchema = z.record(z.unknown());

export function impactBaseRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/impact/base",
    options: zodResponse(bearerScope("read"), ImpactBaseSchema, {
      name: "ImpactBase",
      description: "The stamped base commit, or unstamped",
    }),
    handler: async (request, h) => {
      const repo = `${request.params.owner}/${request.params.repo}`;
      const dgraph = createDgraphClient(process.env);

      if (!dgraph) {
        return h.response(UNSTAMPED);
      }

      try {
        const baseline = await readGraphBaseline(dgraph, repo);

        return h.response({
          graphCommit: baseline.commit,
          graphCommitAt: baseline.at,
          source: baseline.source,
        });
      } catch (err) {
        const reason =
          err instanceof Error ? (err.stack ?? err.message) : String(err);

        console.error(`[impact] baseline read failed for ${repo}: ${reason}`);

        return h.response(UNSTAMPED);
      }
    },
  };
}
