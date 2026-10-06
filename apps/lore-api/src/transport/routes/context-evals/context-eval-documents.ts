import { z } from "zod";
import type { Pool } from "pg";
import type { ResponseObject, ServerRoute } from "@hapi/hapi";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { repoFullName } from "../common-schemas.js";
import { withPool, type PooledHandler } from "../with-pool.js";
import { documentPaths } from "../../../work/context-evals/eval-documents.js";

/** The documents a repository's context eval samples from (specs/context-evals): its ingested ADRs and specs that are still in force. */

const DocumentsQuery = z.object({ repo: repoFullName });

const EvalDocumentsSchema = z.object({ documents: z.array(z.string()) });

const RESPONSE = {
  name: "EvalDocuments",
  description: "The paths a context eval samples from",
  errors: [400 as const],
};

export function contextEvalDocumentsRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/context-evals/documents",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(DocumentsQuery) },
      },
      EvalDocumentsSchema,
      RESPONSE,
    ),
    handler: withPool(getPool, serveEvalDocuments),
  };
}

const serveEvalDocuments: PooledHandler = async (
  pool,
  request,
  h,
): Promise<ResponseObject> => {
  const { repo } = request.query as unknown as z.infer<typeof DocumentsQuery>;

  return h.response({ documents: await documentPaths(pool, repo) });
};
