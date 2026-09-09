import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectCurrentRepo } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { proxyGetApi, withReadCache, textResult } from "./deps.js";
import {
  runQueryTrace,
  type QueryTraceArgs,
} from "@re-cinq/lore-server-core/features/spec-trace/query-trace.js";

/** Reads one spec's coverage, the call graph around a symbol, or the tests covering a source span. */
function queryTrace(args: QueryTraceArgs): Promise<string> {
  return runQueryTrace(args, {
    proxyGet: traceGet(args),
    detectRepo: detectCurrentRepo,
  });
}

// A spec read is stable between CI reprojections; a run's overlay changes under it mid-run, so that read goes uncached.
function traceGet(args: QueryTraceArgs) {
  return args.tests_covering ? proxyGetApi : cachedTraceGet(args.repo);
}

const QUERY_TRACE_INPUT = {
  spec: z
    .string()
    .optional()
    .describe(
      "Spec file path relative to the repo root, e.g. 'specs/auth/spec.md'. Omit when asking a call-graph or tests-covering question instead.",
    ),
  tests_covering: z
    .string()
    .optional()
    .describe(
      "Source file path whose covering tests you want, e.g. 'src/auth/token.ts'. Answers 'which tests exercise this code', the mirror of the spec read.",
    ),
  ranges: z
    .string()
    .optional()
    .describe(
      "Line spans narrowing `tests_covering`, e.g. '10-20,30-40'. Omit for the whole file.",
    ),
  assembly_run_id: z
    .string()
    .optional()
    .describe(
      "Assembly run uuid. Reads that run's branch overlay — the coverage its own commits produced — falling back to main for files the branch never touched.",
    ),
  callers_of: z
    .string()
    .optional()
    .describe(
      "Symbol name to walk the call graph INWARD from — what calls it. Names a symbol, not a spec.",
    ),
  callees_of: z
    .string()
    .optional()
    .describe(
      "Symbol name to walk the call graph OUTWARD from — what it calls. Names a symbol, not a spec.",
    ),
  depth: z
    .number()
    .optional()
    .describe(
      "How many call-graph hops to walk for `callers_of`/`callees_of`. Defaults to 1.",
    ),
  statement: z
    .string()
    .optional()
    .describe(
      "1-based ordinal (e.g. '3') or unique text substring to narrow to a single statement. Omit for whole-spec summary.",
    ),
  repo: z
    .string()
    .optional()
    .describe(
      "Target repo as 'owner/repo'. Defaults to the repo detected from cwd git remote.",
    ),
};

export function registerSpecTraceTools(server: McpServer) {
  server.tool(
    "lore-query-trace",
    `READ side of spec-traceability: returns per-statement coverage for a spec — which tests validate each statement and which are drifted or violated. Read-only; executes and builds nothing. The graph is (re)projected by CI — specs/adrs on push, tests via lore-tests.yml — not by an MCP tool. Instead: to enumerate or run tests locally use lore_list_tests / lore_run_test.`,
    QUERY_TRACE_INPUT,
    async (args) => textResult(await queryTrace(args)),
  );
}

/** Cached for 10 minutes and keyed on the PATH alone, deliberately: the graph is reprojected by CI on push, so within a working session the same spec gives the same answer. */
function cachedTraceGet(repo: string | undefined) {
  return (path: string) =>
    withReadCache(
      {
        tool: "lore-query-trace",
        args: { path },
        repo: repo || undefined,
        ttlSeconds: 600,
      },
      () => proxyGetApi(path),
      { label: false },
    );
}
