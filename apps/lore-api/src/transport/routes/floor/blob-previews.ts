// GET /api/assembly-runs/{id}/blob-previews?hash=… — the first 4 KiB of the blobs a run references, so the run page can show a short file in place and link only a long one (run-viz FR4.4m).
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  blobPreviews,
  type RunBlob,
} from "../../../work/floor/floor-run-blob.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { BLOB_HASH, RunBlobSchema } from "./run-blob.js";

// One card's worth: a run page asks once per card, and no card lists more.
const MAX_HASHES = 50;

const BlobPreviewsSchema = z.object({
  previews: z.record(z.string(), RunBlobSchema),
});

export type BlobPreviewsOf = (
  runId: string,
  hashes: string[],
) => Promise<Record<string, RunBlob> | null>;

/** The floor's previews, when a floor is configured; a deployment without one has no blobs to show. */
export const floorBlobPreviews: BlobPreviewsOf = (runId, hashes) =>
  floorConfigured()
    ? blobPreviews(floorClient(), runId, hashes)
    : Promise.resolve(null);

export function blobPreviewsRoute(previewsOf: BlobPreviewsOf): ServerRoute {
  return {
    method: "GET",
    path: "/api/assembly-runs/{id}/blob-previews",
    options: zodResponse(bearerScope("read"), BlobPreviewsSchema, {
      name: "BlobPreviews",
      description:
        "The first 4 KiB of each blob the run references, by hash; a hash it does not reference is left out. 400 for a malformed hash or more than 50, 404 for a run the floor does not have",
      errors: [400, 404],
    }),
    handler: (request: Request, h: ResponseToolkit) =>
      serveBlobPreviews(previewsOf, request, h),
  };
}

async function serveBlobPreviews(
  previewsOf: BlobPreviewsOf,
  request: Request,
  h: ResponseToolkit,
) {
  const hashes = [request.query.hash].flat().filter(Boolean) as string[];

  enforceTrue(hashes.length <= MAX_HASHES, apiError(400), "too many hashes");
  enforceTrue(
    hashes.every((hash) => BLOB_HASH.test(hash)),
    apiError(400),
    "malformed blob hash",
  );
  const previews = await previewsOf(request.params.id as string, hashes);

  enforceTrue(previews !== null, apiError(404), "run not found");

  return h.response({ previews });
}
