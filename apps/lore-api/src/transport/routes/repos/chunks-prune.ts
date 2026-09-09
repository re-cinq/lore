import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { zodResponse } from "../../http/zod-response.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";
import { pruneOrphanChunks } from "../../../work/chunks/prune-orphans.js";

/** Drops a repo's chunks for paths the caller's tree no longer has (or the classifier now refuses). `present_paths` must name at least one file: an empty tree would read as "delete everything". */

const PruneBody = z.object({
  present_paths: z.array(z.string().min(1)).min(1),
});

type PruneBody = z.infer<typeof PruneBody>;

const PruneResultSchema = z.object({
  schema: z.string(),
  deleted_paths: z.array(z.string()),
  deleted_chunks: z.number(),
});

async function servePrune(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { present_paths } = request.payload as PruneBody;
  const repo = `${request.params.owner}/${request.params.repo}`;

  return h.response(await pruneOrphanChunks(pool, repo, present_paths));
}

export function chunksPruneRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/chunks/prune",
    options: zodResponse(
      {
        ...bearerScope("write"),
        validate: { payload: zodValidate(PruneBody) },
      },
      PruneResultSchema,
      {
        name: "ChunkPruneResult",
        description:
          "The chunk schema swept, the indexed paths that were absent from the posted tree or refused by the classifier, and how many chunks went with them",
        errors: [400],
      },
    ),
    handler: withPool(getPool, servePrune),
  };
}
