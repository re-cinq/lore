/**
 * `GET /api/repos/:o/:r/impact/base` — the commit whose line numbering the
 * repo's trace-graph ranges are expressed in.
 *
 * Separate from the POST because the client needs this BEFORE it can compute the
 * right diff: knowing the baseline is what lets it check, per file, whether its
 * diff's old side is in the same coordinate system as the graph. One ~50ms GET
 * in a job that already spends seconds on a full-history checkout.
 *
 * Fail-soft like its sibling: no Dgraph, or a query that errors, answers
 * `{ graphCommit: null }` rather than a 5xx, so the advisory check degrades to
 * "coordinates unverified" instead of failing the step.
 */

import type { ServerRoute } from "@hapi/hapi";
import { createDgraphClient, readGraphBaseline } from "@re-cinq/lore-shared";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

// Shared, not cloned per response: hapi serialises it to JSON and never hands
// the object to a caller who could mutate it.
const UNSTAMPED = { graphCommit: null, graphCommitAt: null, source: "none" };

export function impactBaseRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/impact/base",
    options: bearerScope("read"),
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
