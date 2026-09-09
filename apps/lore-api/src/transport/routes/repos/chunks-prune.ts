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
import { reconcileOrphanChunks } from "../../../work/chunks/reconcile-orphans.js";

/** Drops a repo's chunks for paths its tree no longer has (or the classifier now refuses). Omit `present_paths` and the server reads the tree over the GitHub API, so a caller with no checkout — a scheduler, the post-ingest hook — can reconcile too. Supplied, it must name at least one file: an empty tree would read as "delete everything". */

const PruneBody = z.object({
  present_paths: z.array(z.string().min(1)).min(1).optional(),
  /** Which ref to read when the server fetches the tree itself; defaults to the repo's default branch. */
  ref: z.string().optional(),
});

type PruneBody = z.infer<typeof PruneBody>;

const PruneResultSchema = z.object({
  schema: z.string(),
  deleted_paths: z.array(z.string()),
  deleted_chunks: z.number(),
});

// A large repo's tracked-path list outgrows the 1MB server default: ~40k paths at 25 bytes each.
const PRUNE_OPTIONS = {
  ...bearerScope("write"),
  payload: { maxBytes: 10 * 1_048_576 },
  validate: { payload: zodValidate(PruneBody) },
};

export function chunksPruneRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/chunks/prune",
    options: zodResponse(PRUNE_OPTIONS, PruneResultSchema, {
      name: "ChunkPruneResult",
      description:
        "The chunk schema swept, the indexed paths that were absent from the posted tree or refused by the classifier, and how many chunks went with them",
      errors: [400],
    }),
    handler: withPool(getPool, servePrune),
  };
}

async function servePrune(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { present_paths, ref } = request.payload as PruneBody;
  const repo = `${request.params.owner}/${request.params.repo}`;

  if (present_paths) {
    return h.response(await pruneOrphanChunks(pool, repo, present_paths));
  }
  const reconciled = await reconcileOrphanChunks(pool, repo, ref);

  return reconciled
    ? h.response(reconciled)
    : h.response({ error: `could not read the tree for ${repo}` }).code(502);
}
