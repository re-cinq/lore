import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { createDgraphClient, dropOverlay } from "@re-cinq/lore-shared";
import { zodResponse } from "../../http/zod-response.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";

const OverlayDropBody = z.object({ branch: z.string().min(1).max(255) });

type OverlayDropBody = z.infer<typeof OverlayDropBody>;

const OverlayDropSchema = z.object({ dropped: z.boolean() });

/** POST /trace/overlay-drop — a branch is done (its pull request closed, merged or not), so the overlay its pushes built in the graph describes nothing anyone will read again. The stations service calls this on the close; it used to ride the `ingest` assembly line as a pod per drop (specs/external-floor FR16). Dropping twice is safe. */
export function traceOverlayDropRoute(): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/trace/overlay-drop",
    options: zodResponse(
      {
        ...bearerScope("write"),
        validate: { payload: zodValidate(OverlayDropBody) },
      },
      OverlayDropSchema,
      {
        name: "OverlayDrop",
        description:
          "Whether the graph was asked to drop the branch's overlay; false when no graph is configured",
        errors: [400],
      },
    ),
    handler: (request, h) => serveOverlayDrop(request, h),
  };
}

async function serveOverlayDrop(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { owner, repo } = request.params as { owner: string; repo: string };
  const { branch } = request.payload as OverlayDropBody;
  const dgraph = createDgraphClient(process.env);

  if (!dgraph) {
    return h.response({ dropped: false });
  }
  await dropOverlay(dgraph, `${owner}/${repo}`, branch);

  return h.response({ dropped: true });
}
