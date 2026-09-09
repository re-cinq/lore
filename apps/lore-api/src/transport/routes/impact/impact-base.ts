import { zodResponse } from "../../http/zod-response.js";
import { z } from "zod";
/** The commit whose line numbering the graph's ranges are expressed in (needed for diff validation). */

import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { createDgraphClient, readGraphBaseline } from "@re-cinq/lore-shared";
import { bearerScope } from "../../http/bearer-scope.js";
import { failureReason } from "./impact-failure.js";

// Shared object (hapi serializes to JSON, never hands to caller).
const UNSTAMPED = { graphCommit: null, graphCommitAt: null, source: "none" };

/** The commit a repo's impact reports are measured against. */
const ImpactBaseSchema = z.record(z.string(), z.unknown());

type Dgraph = NonNullable<ReturnType<typeof createDgraphClient>>;

/** The stamped baseline in wire shape. */
async function stampedBase(dgraph: Dgraph, repo: string) {
  const baseline = await readGraphBaseline(dgraph, repo);

  return {
    graphCommit: baseline.commit,
    graphCommitAt: baseline.at,
    source: baseline.source,
  };
}

/** A repo with no graph, or a graph that will not answer, reads as unstamped rather than as an error — impact is advisory, and a failing baseline must not red-light a PR. */
async function serveImpactBase(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const repo = `${request.params.owner}/${request.params.repo}`;
  const dgraph = createDgraphClient(process.env);

  if (!dgraph) {
    return h.response(UNSTAMPED);
  }

  try {
    return h.response(await stampedBase(dgraph, repo));
  } catch (err) {
    console.error(
      `[impact] baseline read failed for ${repo}: ${failureReason(err)}`,
    );

    return h.response(UNSTAMPED);
  }
}

export function impactBaseRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/impact/base",
    options: zodResponse(bearerScope("read"), ImpactBaseSchema, {
      name: "ImpactBase",
      description: "The stamped base commit, or unstamped",
    }),
    handler: (request, h) => serveImpactBase(request, h),
  };
}
