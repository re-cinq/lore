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

type ProjectResult = Awaited<ReturnType<typeof projectFor>>;
type Trace = ProjectResult["trace"];

// lore.features is source of truth for Feature nodes (ADR-027); tolerate 42P01.
async function graphWithFeatures(trace: Trace, project: ProjectResult) {
  const [graph, features] = await Promise.all([
    trace.graph(),
    project.features.list().catch((err) => {
      if ((err as { code?: string }).code === "42P01") {
        return [];
      }
      throw err;
    }),
  ]);

  return mergePersistentFeatures(
    graph,
    features.map((f) => ({
      id: f.id,
      title: f.title,
      path: f.path,
      status: f.status,
    })),
  );
}

// Kinds answerable without a ?path=; each handler shapes its own response body.
const NO_PATH_KINDS: Partial<
  Record<string, (trace: Trace, project: ProjectResult) => Promise<object>>
> = {
  specs: async (trace) => ({ specs: await trace.specs() }),
  "spec-summaries": async (trace) => ({
    summaries: await trace.specSummaries(),
  }),
  adrs: async (trace) => ({ adrs: await trace.adrs() }),
  "adr-summaries": async (trace) => ({ summaries: await trace.adrSummaries() }),
  graph: graphWithFeatures,
};

// Kinds gated behind the ?path= required-query check below.
const PATH_KINDS: Record<
  string,
  (trace: Trace, filePath: string) => Promise<object>
> = {
  document: (trace, filePath) => trace.document(filePath),
  ring: (trace, filePath) => trace.ring(filePath),
  source: async (trace, filePath) => ({ source: await trace.source(filePath) }),
};

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
        const project = await projectFor(
          `${request.params.owner}/${request.params.repo}`,
        );
        const trace = project.trace;
        const noPathHandler = NO_PATH_KINDS[kind];

        if (noPathHandler) {
          return h.response(await noPathHandler(trace, project));
        }

        enforceTrue(filePath, apiError(400), "path query param required");

        return h.response(await PATH_KINDS[kind](trace, filePath));
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
