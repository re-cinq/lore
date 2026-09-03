import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { mergePersistentFeatures } from "@re-cinq/lore-shared";
import { projectFor } from "../../../platform/project-boot.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";

// kind: Set check (404 unknown); path: bounded to 1024 chars.
const TraceQuery = z.object({ path: z.string().max(1024).optional() });

type TraceQuery = z.infer<typeof TraceQuery>;

// GET /trace/{kind} — spec-traceability graph served via project.trace (shared facade).
const TRACE_KINDS = new Set([
  "specs",
  "spec-summaries",
  "adrs",
  "adr-summaries",
  "document",
  "source",
  "graph",
  "ring",
]);

// Union of all /trace/{kind} responses; one route, many contract shapes.
const TraceReadSchema = z.record(z.unknown());

export function traceRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/trace/{kind}",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(TraceQuery) },
      },
      TraceReadSchema,
      {
        name: "TraceRead",
        description: "A traceability read, shaped by {kind}",
        errors: [400, 404],
      },
    ),
    handler: async (request, h) => {
      const kind = request.params.kind;

      enforceTrue(TRACE_KINDS.has(kind), apiError(404), "not found");
      const { path: filePath = "" } = request.query as TraceQuery;

      try {
        const trace = (
          await projectFor(`${request.params.owner}/${request.params.repo}`)
        ).trace;

        if (kind === "specs") {
          return h.response({ specs: await trace.specs() });
        }

        if (kind === "spec-summaries") {
          return h.response({ summaries: await trace.specSummaries() });
        }

        if (kind === "adrs") {
          return h.response({ adrs: await trace.adrs() });
        }

        if (kind === "adr-summaries") {
          return h.response({ summaries: await trace.adrSummaries() });
        }

        if (kind === "graph") {
          // lore.features is source of truth for Feature nodes (ADR-027); tolerate 42P01.
          const project = await projectFor(
            `${request.params.owner}/${request.params.repo}`,
          );
          const [graph, features] = await Promise.all([
            trace.graph(),
            project.features.list().catch((err) => {
              if ((err as { code?: string }).code === "42P01") {
                return [];
              }
              throw err;
            }),
          ]);

          return h.response(
            mergePersistentFeatures(
              graph,
              features.map((f) => ({
                id: f.id,
                title: f.title,
                path: f.path,
                status: f.status,
              })),
            ),
          );
        }

        enforceTrue(filePath, apiError(400), "path query param required");

        if (kind === "document") {
          return h.response(await trace.document(filePath));
        }

        if (kind === "ring") {
          return h.response(await trace.ring(filePath));
        }

        return h.response({ source: await trace.source(filePath) });
      } catch (err) {
        // Guard's refusal carries its status; only unexpected failure needs shaping.
        rethrowBoom(err);

        return h
          .response({ error: err instanceof Error ? err.message : String(err) })
          .code(500);
      }
    },
  };
}
