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
import { parseRanges } from "@re-cinq/lore-shared";
import { projectFor } from "../../../outbound/project-boot.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";

// kind: Set check (404 unknown); path: bounded to 1024 chars.
const TraceQuery = z.object({
  path: z.string().max(1024).optional(),
  ranges: z.string().max(200).optional(),
  branch: z.string().max(255).optional(),
  symbol: z.string().max(255).optional(),
  direction: z.enum(["callers", "callees"]).optional(),
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

const TraceSectionSchema = z.object({
  uid: z.string(),
  heading: z.string(),
  ordinal: z.number(),
  level: z.number().optional(),
});

const TraceLinkRefSchema = z.object({
  kind: z.enum(["test", "code", "adr"]),
  label: z.string(),
  path: z.string().optional(),
  line: z.number().optional(),
  detail: z.string().optional(),
});

const TraceStatementSchema = z.object({
  uid: z.string(),
  ordinal: z.number(),
  text: z.string(),
  kind: z.string().optional(),
  testability: z.string().optional(),
  state: z.enum(["tested", "untested", "narrative"]),
  sectionUid: z.string().optional(),
  links: z.array(TraceLinkRefSchema),
  drifted: z.boolean().optional(),
  violated: z.boolean().optional(),
});

const TraceCoverageSchema = z.object({
  testable: z.number(),
  covered: z.number(),
  untestable: z.number(),
  ratio: z.number(),
});

export const TraceDocumentSchema = z.object({
  filePath: z.string(),
  title: z.string(),
  description: z.string(),
  sections: z.array(TraceSectionSchema),
  statements: z.array(TraceStatementSchema),
  coverage: TraceCoverageSchema,
});

const AdrSummarySchema = z.object({
  filePath: z.string(),
  title: z.string(),
  description: z.string(),
  status: z
    .object({
      status: z.enum([
        "draft",
        "in-progress",
        "shipped",
        "rejected",
        "retired",
      ]),
      label: z.string(),
    })
    .nullable(),
});

const SpecSummarySchema = AdrSummarySchema.extend({
  coverage: TraceCoverageSchema,
});

const SpecGraphSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.enum([
        "Feature",
        "Spec",
        "Section",
        "Statement",
        "AcceptanceCriterion",
        "TestChunk",
        "CodeChunk",
        "File",
        "ADR",
      ]),
      label: z.string(),
      path: z.string().optional(),
      line: z.number().optional(),
      endLine: z.number().optional(),
      detail: z.string().optional(),
    }),
  ),
  links: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      kind: z.enum([
        "in_feature",
        "in_spec",
        "in_section",
        "has_statement",
        "validated_by",
        "implemented_by",
        "covers",
        "decided_by",
      ]),
    }),
  ),
});

// Every projection served by `/trace/{kind}` (FR12/FR13: multiplexed routes declare a union that every real response satisfies).
export const TraceReadSchema = z.union([
  z.object({ specs: z.array(z.string()) }),
  z.object({ summaries: z.array(SpecSummarySchema) }),
  z.object({ adrs: z.array(z.string()) }),
  z.object({ summaries: z.array(AdrSummarySchema) }),
  TraceDocumentSchema,
  z.object({ source: z.string().nullable() }),
  SpecGraphSchema,
  z.object({
    sections: z.array(
      z.object({
        uid: z.string(),
        heading: z.string(),
        total: z.number(),
        tested: z.number(),
      }),
    ),
    statements: z.array(
      z.object({
        uid: z.string(),
        sectionUid: z.string(),
        tested: z.boolean(),
        text: z.string(),
      }),
    ),
  }),
  z.object({
    tests: z.array(
      z.object({
        testFile: z.string(),
        statement: z.string().optional(),
        origin: z.enum(["main", "overlay"]),
        ranges: z.array(z.tuple([z.number(), z.number()])),
      }),
    ),
  }),
  z.object({
    failures: z.array(
      z.object({
        stationRunId: z.string(),
        nodeId: z.string(),
        iteration: z.number(),
        failureClass: z.string(),
        failureDetail: z.string(),
        commit: z.string(),
        occurredAt: z.string(),
        resolvedByCommit: z.string().optional(),
      }),
    ),
  }),
  z.object({
    callers: z.array(
      z.object({
        filePath: z.string(),
        symbol: z.string(),
        startLine: z.number(),
      }),
    ),
  }),
]);

type ProjectResult = Awaited<ReturnType<typeof projectFor>>;
type Trace = ProjectResult["trace"];

// Kinds answerable without a ?path=; each handler shapes its own response body.
const NO_PATH_KINDS: Partial<
  Record<string, (trace: Trace, query: TraceQuery) => Promise<object>>
> = {
  specs: async (trace) => ({ specs: await trace.specs() }),
  "spec-summaries": async (trace) => ({
    summaries: await trace.specSummaries(),
  }),
  adrs: async (trace) => ({ adrs: await trace.adrs() }),
  "adr-summaries": async (trace) => ({ summaries: await trace.adrSummaries() }),
  callers: callersResult,
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
  "failures-touching": async (trace, filePath) => ({
    failures: await trace.failuresTouching(filePath),
  }),
  graph: (trace, filePath) => trace.graph(filePath),
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
  const { req } = request.raw;

  refuseDeepDepth(kind, req.url);

  try {
    return h.response(await traceResult(request, kind, query));
  } catch (err) {
    rethrowBoom(err);

    return h
      .response({ error: err instanceof Error ? err.message : String(err) })
      .code(500);
  }
}

/** Refuses depth > 1 for callers before the project is built, so the error is a 400, not a 500. */
function refuseDeepDepth(kind: string, rawUrl = ""): void {
  if (kind !== "callers") {
    return;
  }
  const params = new URLSearchParams(rawQuery(rawUrl));
  const depth = Number(params.get("depth") ?? "1");

  enforceTrue(
    Number.isInteger(depth) && depth === 1,
    apiError(400, {
      message: "only one hop is supported; depth > 1 is not yet walked",
    }),
    "only one hop is supported; depth > 1 is not yet walked",
  );
}

function rawQuery(rawUrl: string): string {
  const qmark = rawUrl.indexOf("?");

  return qmark >= 0 ? rawUrl.slice(qmark + 1) : "";
}

/** The body for one {kind}: the no-path handlers shape their own, the rest need the ?path= the guard below demands. */
async function traceResult(
  request: Request,
  kind: string,
  query: TraceQuery,
): Promise<object> {
  const repo = `${request.params.owner}/${request.params.repo}`;
  const trace = (await projectFor(repo)).trace;
  const noPathHandler = NO_PATH_KINDS[kind];

  if (noPathHandler) {
    return noPathHandler(trace, query);
  }
  const filePath = query.path ?? "";

  enforceTrue(filePath, apiError(400), "path query param required");

  return PATH_KINDS[kind](trace, filePath, query);
}

/** Callers (or, with `direction=callees`, callees) of a named symbol, over the CodeChunk.references edge the code projection writes. One hop only; depth > 1 is refused in serveTrace before this runs. A deployment with no graph answers with an empty list. */
async function callersResult(trace: Trace, query: TraceQuery): Promise<object> {
  const symbol = query.symbol ?? "";

  enforceTrue(symbol, apiError(400), "symbol query param required");

  return { callers: await trace.callers(symbol, query.direction) };
}
