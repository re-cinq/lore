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
  }),
);
type IngestGraphBody = z.infer<typeof IngestGraphBody>;

export function ingestGraphRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/ingest-graph",
    options: {
      ...bearerScope("write"),
      validate: { payload: zodValidate(IngestGraphBody) },
    },
    handler: async (request, h) => {
      const repo = `${request.params.owner}/${request.params.repo}`;
      const body = request.payload as IngestGraphBody;

      const requested =
        body.kinds && body.kinds.length > 0 ? body.kinds : ["specs", "adrs"];
      const unsupported = requested.filter((k) => !DOC_KINDS.has(k));
      if (unsupported.length > 0) {
        return h
          .response({
            error: `unsupported kind(s): ${unsupported.join(", ")} — only specs/adrs project here; test projection is CI-only (the lore-code-trace binary posts to the Floor ci-tests ingress)`,
          })
          .code(400);
      }

      // Each doc kind → fire-and-forget projection trigger.
      const pool = getPool();
      for (const kind of requested) {
        void triggerAgentSpecTrace(pool, repo, kind, {
          commit: body.commit,
          force: body.force,
        });
      }

      return h.response({ triggered: requested });
    },
  };
}
