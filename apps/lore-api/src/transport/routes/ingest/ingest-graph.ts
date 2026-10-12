import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { zodResponse } from "../../http/zod-response.js";
/** POST /api/repos/:o/:r/ingest-graph — the retired projection trigger; it answers 410 with what replaced it. */

import type { Request, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";

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

export function ingestGraphRoute(): ServerRoute {
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
        description: "Never answered: the route refuses with 410",
        errors: [400],
      },
    ),
    handler: serveIngestGraph,
  };
}

const REPLACED =
  "Specs and ADRs are no longer projected by this route. The repository's lore-ingest.yml posts them itself with `lore-code-trace docs --post`: update the workflow from the onboarding template.";

/** This route queued a projection for Lore's own Floor to run. The Floor is gone and the repository's CI posts its specs and ADRs to the graph directly, so a workflow that still calls here is told to update: a 4xx fails its job, which is how the repository finds out. */
function serveIngestGraph(request: Request): never {
  resolveDocKinds(request.payload as IngestGraphBody);

  throw apiError(410)(REPLACED);
}

/** The doc kinds a push asked for, defaulting to both; an unknown kind is refused rather than dropped. */
function resolveDocKinds(body: IngestGraphBody): string[] {
  const requested =
    body.kinds && body.kinds.length > 0 ? body.kinds : ["specs", "adrs"];
  const unsupported = requested.filter((k) => !DOC_KINDS.has(k));

  enforceTrue(
    unsupported.length <= 0,
    apiError(400),
    `unsupported kind(s): ${unsupported.join(", ")} — only specs/adrs were ever projected here`,
  );

  return requested;
}
