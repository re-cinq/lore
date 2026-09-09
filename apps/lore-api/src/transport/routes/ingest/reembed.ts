import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { getQueryEmbedding } from "@re-cinq/lore-server-core/platform/db.js";
import { zodResponse } from "../../http/zod-response.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";
import { backfillEmbeddings } from "../../../work/embeddings/backfill.js";

/** One bounded batch of the embedding backfill; the caller loops until `remaining` is 0 (scripts/infra/reembed.sh). A route rather than a job: it runs under the pod's own Workload Identity, and a request-sized batch cannot hang past the proxy timeout. */

const ReembedBody = z.object({
  schema: z
    .string()
    .regex(/^[a-z_][a-z0-9_]*$/)
    .optional(),
  limit: z.number().int().min(1).max(500).default(100),
  where: z.enum(["missing", "stale_links"]).default("missing"),
});

type ReembedBody = z.infer<typeof ReembedBody>;

const ReembedResultSchema = z.object({
  embedded: z.number(),
  failed: z.number(),
  remaining: z.number(),
  stopped: z.boolean(),
});

async function serveReembed(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { schema, limit, where } = request.payload as ReembedBody;
  const result = await backfillEmbeddings(pool, getQueryEmbedding, {
    schema,
    limit,
    where,
  });

  return h.response(result);
}

export function reembedRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/ingest/reembed",
    options: zodResponse(
      {
        ...bearerScope("write"),
        validate: { payload: zodValidate(ReembedBody) },
      },
      ReembedResultSchema,
      {
        name: "ReembedResult",
        description:
          "One batch of the embedding backfill: rows embedded, the first failure if the embedder returned nothing, and how many rows still wait",
        errors: [400],
      },
    ),
    handler: withPool(getPool, serveReembed),
  };
}
