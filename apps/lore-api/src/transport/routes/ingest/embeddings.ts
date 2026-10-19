import { zodResponse } from "../../http/zod-response.js";
import { z } from "zod";
import { errorMessage, getQueryEmbeddings } from "@re-cinq/lore-shared";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";

/** Station pods' batch embedding proxy (no GCP creds in pods; read scope): one request per spec file rather than one per statement, which is what kept a 100 KB spec inside its station's deadline. */

type EmbeddingsFn = (texts: string[]) => Promise<Array<number[] | null>>;

let embeddingsOverride: EmbeddingsFn | undefined;

/** Test seam — the route closes over module state, not a request-time import. */
export function setEmbeddingsForTests(fn: EmbeddingsFn | undefined): void {
  embeddingsOverride = fn;
}

/** The most texts one request may carry (Vertex's per-request instance ceiling); the station never sends more in one call. */
const MAX_TEXTS = 250;

const EmbeddingsBody = z.object({
  texts: z.array(z.string().min(1).max(20_000)).min(1).max(MAX_TEXTS),
});

/** One vector per posted text, in order; null where the provider produced none. */
const EmbeddingsSchema = z.object({
  embeddings: z.array(z.array(z.number()).nullable()),
});

export function embeddingsRoute(): ServerRoute {
  return {
    method: "POST",
    path: "/api/embeddings",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { payload: zodValidate(EmbeddingsBody) },
      },
      EmbeddingsSchema,
      {
        name: "Embeddings",
        description: "One embedding per posted text, in order",
        errors: [400],
      },
    ),
    handler: (request, h) => serveEmbeddings(request, h),
  };
}

async function serveEmbeddings(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  try {
    const { texts } = request.payload as z.infer<typeof EmbeddingsBody>;
    const embeddings = await (embeddingsOverride ?? getQueryEmbeddings)(texts);

    return h.response({ embeddings });
  } catch (err) {
    return h.response({ error: errorMessage(err) }).code(500);
  }
}
