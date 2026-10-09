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
import {
  parseRanges,
  createDgraphClient,
  failuresTouching,
  withTxn,
} from "@re-cinq/lore-shared";
import { projectFor } from "../../../outbound/project-boot.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";

const zCoerce = z.coerce;
const DepthParam = zCoerce.number().int().min(1).max(10).optional();

// kind: Set check (404 unknown); path: bounded to 1024 chars.
const TraceQuery = z.object({
  path: z.string().max(1024).optional(),
  ranges: z.string().max(200).optional(),
  branch: z.string().max(255).optional(),
  symbol: z.string().max(255).optional(),
  direction: z.enum(["callers", "callees"]).optional(),
  depth: DepthParam,
});

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
  "tests-covering",
  "failures-touching",
  "callers",
]);

// Union of all /trace/{kind} responses; one route, many contract shapes.
const TraceReadSchema = z.record(z.string(), z.unknown());

type ProjectResult = Awaited<ReturnType<typeof projectFor>>;
type Trace = ProjectResult["trace"];

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
  graph: async (trace) => trace.graph(),
};

// `ranges` narrows the covered file to spans; `branch` reads that branch's overlay instead of main.
async function testsCoveringResult(
  trace: Trace,
  filePath: string,
  query: TraceQuery,
): Promise<object> {
  const ranges = parseRanges(query.ranges ?? "");
  const target = { file: filePath, ...(ranges.length ? { ranges } : {}) };

  return { tests: await trace.testsCovering(target, query.branch) };
}

// Kinds gated behind the ?path= required-query check below.
const PATH_KINDS: Record<
  string,
  (trace: Trace, filePath: string, query: TraceQuery) => Promise<object>
> = {
  document: (trace, filePath) => trace.document(filePath),
  ring: (trace, filePath) => trace.ring(filePath),
  source: async (trace, filePath) => ({ source: await trace.source(filePath) }),
  "tests-covering": testsCoveringResult,
};

// Kinds that read the graph directly, not through the Project facade.
const GRAPH_KINDS: Record<
  string,
  (repo: string, query: TraceQuery) => Promise<object>
> = {
  "failures-touching": failuresResult,
  callers: callersResult,
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
    handler: (request, h) => serveTrace(request, h),
  };
}

/** A traceability read, shaped by {kind}: the spec-to-test graph the coverage view and the VS Code extension both read. */
async function serveTrace(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const kind = request.params.kind;

  enforceTrue(TRACE_KINDS.has(kind), apiError(404), "not found");
  const query = request.query as TraceQuery;

  try {
    return h.response(await traceResult(request, kind, query));
  } catch (err) {
    // Guard's refusal carries its status; only unexpected failure needs shaping.
    rethrowBoom(err);

    return h
      .response({ error: err instanceof Error ? err.message : String(err) })
      .code(500);
  }
}

/** The body for one {kind}: the no-path handlers shape their own, the rest need the ?path= the guard below demands. */
async function traceResult(
  request: Request,
  kind: string,
  query: TraceQuery,
): Promise<object> {
  const repo = `${request.params.owner}/${request.params.repo}`;

  const graphHandler = GRAPH_KINDS[kind];
  if (graphHandler) {
    return graphHandler(repo, query);
  }
  const project = await projectFor(repo);
  const trace = project.trace;
  const noPathHandler = NO_PATH_KINDS[kind];

  if (noPathHandler) {
    return noPathHandler(trace, project);
  }
  const filePath = query.path ?? "";

  enforceTrue(filePath, apiError(400), "path query param required");

  return PATH_KINDS[kind](trace, filePath, query);
}

const CALLERS_QUERY = `query q($repo: string, $symbol: string) {
  target(func: eq(CodeChunk.symbol_name, $symbol)) @filter(eq(CodeChunk.repo, $repo)) {
    callers: ~CodeChunk.references @filter(eq(CodeChunk.repo, $repo)) {
      CodeChunk.file_path
      CodeChunk.symbol_name
      CodeChunk.start_line
    }
  }
}`;

interface GraphCallerChunk {
  "CodeChunk.file_path"?: string;
  "CodeChunk.symbol_name"?: string;
  "CodeChunk.start_line"?: number;
}

/** Callers of a named symbol, via the reverse CodeChunk.references edge. Degrades to empty when no Dgraph client is configured. */
async function callersResult(repo: string, query: TraceQuery): Promise<object> {
  const symbol = query.symbol ?? "";

  enforceTrue(symbol, apiError(400), "symbol query param required");
  const dgraph = createDgraphClient(process.env);

  if (!dgraph) {
    return { callers: [] };
  }
  const callers = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(CALLERS_QUERY, {
      $repo: repo,
      $symbol: symbol,
    });
    const targets = (res.data.target ?? []) as {
      callers?: GraphCallerChunk[];
    }[];

    return targets.flatMap((t) => t.callers ?? []);
  });

  return { callers };
}

/** Failures recorded against a source file. This kind reads the graph directly rather than through the Project facade: `failuresTouching` is a work-layer module, which `outbound` may not import. A deployment with no graph answers with an empty list rather than an error. */
async function failuresResult(
  repo: string,
  query: TraceQuery,
): Promise<object> {
  const filePath = query.path ?? "";

  enforceTrue(filePath, apiError(400), "path query param required");
  const dgraph = createDgraphClient(process.env);

  if (!dgraph) {
    return { failures: [] };
  }

  return { failures: await failuresTouching(dgraph, repo, filePath) };
}
