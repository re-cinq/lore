// GET /api/assembly-runs/{id}/blobs/{hash} — a blob the external floor keeps, as the run page's Needs card links to it: only one the run itself references (run-viz FR4.4m).
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { runBlob, type RunBlob } from "../../../work/floor/floor-run-blob.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";

export const BLOB_HASH = /^sha256-[0-9a-f]{64}$/;

export const RunBlobSchema = z.object({
  hash: z.string(),
  contentType: z.string(),
  size: z.number(),
  text: z.string().nullable(),
  truncated: z.boolean(),
});

export type RunBlobOf = (
  runId: string,
  hash: string,
) => Promise<RunBlob | null>;

/** The floor's blob, when a floor is configured; a deployment without one has no blobs to show. */
export const floorRunBlob: RunBlobOf = (runId, hash) =>
  floorConfigured()
    ? runBlob(floorClient(), runId, hash)
    : Promise.resolve(null);

export function runBlobRoute(blobOf: RunBlobOf): ServerRoute {
  return {
    method: "GET",
    path: "/api/assembly-runs/{id}/blobs/{hash}",
    options: zodResponse(bearerScope("read"), RunBlobSchema, {
      name: "RunBlob",
      description:
        "A blob the external floor keeps, readable only through a run that references it: text up to 1 MiB for a textual content type, metadata alone otherwise; 400 for a malformed hash, 404 for a run or blob it does not reference",
      errors: [400, 404],
    }),
    handler: (request: Request, h: ResponseToolkit) =>
      serveRunBlob(blobOf, request, h),
  };
}

async function serveRunBlob(
  blobOf: RunBlobOf,
  request: Request,
  h: ResponseToolkit,
) {
  const hash = request.params.hash as string;

  enforceTrue(BLOB_HASH.test(hash), apiError(400), "malformed blob hash");
  const blob = await blobOf(request.params.id as string, hash);

  enforceTrue(blob !== null, apiError(404), "blob not found for this run");

  return h.response(blob);
}
