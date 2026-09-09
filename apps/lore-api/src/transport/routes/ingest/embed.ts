import { zodResponse } from "../../http/zod-response.js";
import { z } from "zod";
import { errorMessage, getQueryEmbedding } from "@re-cinq/lore-shared";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";

/** Station pods' embedding proxy (no GCP creds in pods; read scope). */

type EmbedFn = (text: string) => Promise<number[] | null>;

let embedOverride: EmbedFn | undefined;

/** Test seam — the route closes over module state, not a request-time import. */
/** A single embedding vector for the posted text. */
const EmbeddingSchema = z.object({ embedding: z.array(z.number()) });

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
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { payload: zodValidate(EmbedBody) },
      },
      EmbeddingSchema,
      {
        name: "Embedding",
        description: "The embedding for a piece of text",
        errors: [400],
      },
    ),
    handler: (request, h) => serveEmbed(request, h),
  };
}

async function serveEmbed(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  try {
    const { text } = request.payload as z.infer<typeof EmbedBody>;
    const embedding = await (embedOverride ?? getQueryEmbedding)(text);

    return h.response({ embedding });
  } catch (err) {
    return h.response({ error: errorMessage(err) }).code(500);
  }
}
