import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
/**
 * `POST /api/repos/:o/:r/ingest-graph` — the REST/curl/CI (re-)projection
 * trigger for the spec-traceability graph. Only docs (`specs`/`adrs`) flow
 * here: each fires the fire-and-forget spec-trace trigger — the coordinator
 * reads the repo and projects them into the graph, no pipeline task. Test
 * projection is CI-only (the lore-code-trace binary POSTs the Floor ci-tests
 * ingress), so a non-doc kind is rejected.
 */

import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { triggerAgentSpecTrace } from "../helpers.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";

/** The only kinds this route projects — both read from repo markdown. */
const DOC_KINDS = new Set(["specs", "adrs"]);

// Empty body is valid (defaults to specs+adrs), so an absent payload coerces to {}.
const IngestGraphBody = z.preprocess(
  (v) => v ?? {},
  z.object({
    kinds: z.array(z.string()).optional(),
    commit: z.string().optional(),
    force: z.boolean().optional(),
    /** Substring path filter — lets an operator target one directory slice. */
    glob: z.string().optional(),
  }),
);

type IngestGraphBody = z.infer<typeof IngestGraphBody>;

/** Which projection kinds the push triggered. */
const IngestTriggeredSchema = z.object({ triggered: z.array(z.string()) });

export function ingestGraphRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/ingest-graph",
    options: zodResponse(
      {
        ...bearerScope("write"),
        validate: { payload: zodValidate(IngestGraphBody) },
      },
      IngestTriggeredSchema,
      {
        name: "IngestTriggered",
        description: "The projections this push started",
        errors: [400],
      },
    ),
    handler: async (request, h) => {
      const repo = `${request.params.owner}/${request.params.repo}`;
      const body = request.payload as IngestGraphBody;

      const requested =
        body.kinds && body.kinds.length > 0 ? body.kinds : ["specs", "adrs"];
      const unsupported = requested.filter((k) => !DOC_KINDS.has(k));

      enforceTrue(
        unsupported.length <= 0,
        apiError(400),
        `unsupported kind(s): ${unsupported.join(", ")} — only specs/adrs project here; test projection is CI-only (the lore-code-trace binary posts to the Floor ci-tests ingress)`,
      );

      // Each doc kind → fire-and-forget projection trigger.
      const pool = getPool();

      for (const kind of requested) {
        void triggerAgentSpecTrace(pool, repo, kind, {
          commit: body.commit,
          force: body.force,
          glob: body.glob,
        });
      }

      return h.response({ triggered: requested });
    },
  };
}
