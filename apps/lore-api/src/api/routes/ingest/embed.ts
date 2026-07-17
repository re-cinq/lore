import { z } from "zod";
import { errorMessage, getQueryEmbedding } from "@re-cinq/lore-shared";
import type { ServerRoute } from "@hapi/hapi";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";

/**
 * The station pods' embedding proxy (specs/ingest-station FR4): run pods carry
 * no GCP credentials (D6/D7), so statement embeddings route through the API,
 * which already holds Vertex access for search. Read scope — embedding leaks
 * nothing a read token can't already fetch.
 */

type EmbedFn = (text: string) => Promise<number[] | null>;

let embedOverride: EmbedFn | undefined;

/** Test seam — the route closes over module state, not a request-time import. */
export function setEmbedForTests(fn: EmbedFn | undefined): void {
  embedOverride = fn;
}

const EmbedBody = z.object({
  text: z.string().min(1).max(20_000),
});

export function embedRoute(): ServerRoute {
  return {
    method: "POST",
    path: "/api/embed",
    options: {
      ...bearerScope("read"),
      validate: { payload: zodValidate(EmbedBody) },
    },
    handler: async (request, h) => {
      try {
        const { text } = request.payload as z.infer<typeof EmbedBody>;
        const embedding = await (embedOverride ?? getQueryEmbedding)(text);

        return h.response({ embedding });
      } catch (err) {
        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
