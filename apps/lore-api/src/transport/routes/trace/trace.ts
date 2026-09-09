import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { zodResponse } from "../../http/zod-response.js";
import { rethrowBoom, apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { mergePersistentFeatures } from "@re-cinq/lore-shared";
import { projectFor } from "../../../outbound/project-boot.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";

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
const TraceReadSchema = z.record(z.string(), z.unknown());

type ProjectResult = Awaited<ReturnType<typeof projectFor>>;
type Trace = ProjectResult["trace"];

// A deployment whose lore.features table was never created reads as no features.
function listFeaturesTolerantly(featureStore: ProjectResult["features"]) {
  return featureStore.list().catch((err) => {
    if ((err as { code?: string }).code === "42P01") {
      return [];
    }
    throw err;
  });
}

// lore.features is source of truth for Feature nodes (ADR-027); tolerate 42P01.
async function graphWithFeatures(trace: Trace, project: ProjectResult) {
  const { features: featureStore } = project;
  const [graph, features] = await Promise.all([
    trace.graph(),
    listFeaturesTolerantly(featureStore),
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

/** The body for one {kind}: the no-path handlers shape their own, the rest need the ?path= the guard below demands. */
async function traceResult(
  request: Request,
  kind: string,
  filePath: string,
): Promise<object> {
  const project = await projectFor(
    `${request.params.owner}/${request.params.repo}`,
  );
  const trace = project.trace;
  const noPathHandler = NO_PATH_KINDS[kind];

  if (noPathHandler) {
    return noPathHandler(trace, project);
  }

  enforceTrue(filePath, apiError(400), "path query param required");

  return PATH_KINDS[kind](trace, filePath);
}

/** A traceability read, shaped by {kind}: the spec-to-test graph the coverage view and the VS Code extension both read. */
async function serveTrace(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const kind = request.params.kind;

  enforceTrue(TRACE_KINDS.has(kind), apiError(404), "not found");
  const { path: filePath = "" } = request.query as TraceQuery;

  try {
    return h.response(await traceResult(request, kind, filePath));
  } catch (err) {
    // Guard's refusal carries its status; only unexpected failure needs shaping.
    rethrowBoom(err);

    return h
      .response({ error: err instanceof Error ? err.message : String(err) })
      .code(500);
  }
}

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
    handler: (request, h) => serveTrace(request, h),
  };
}
