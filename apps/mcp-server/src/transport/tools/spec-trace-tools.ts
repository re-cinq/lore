import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectCurrentRepo } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { proxyGetApi, withReadCache, textResult } from "./deps.js";
import { runQueryTrace } from "@re-cinq/lore-server-core/features/spec-trace/query-trace.js";

/** Reads one spec's coverage. Cached for 10 minutes and keyed on the PATH alone, deliberately: the graph is reprojected by CI on push, so within a working session the same spec gives the same answer. */
async function queryTrace(args: {
  spec: string;
  statement?: string;
  repo?: string;
}): Promise<string> {
  const { spec, statement, repo } = args;

  return runQueryTrace(
    { repo, spec, statement },
    {
      proxyGet: (path: string) =>
        withReadCache(
          {
            tool: "lore-query-trace",
            args: { path },
            repo: repo || undefined,
            ttlSeconds: 600,
          },
          () => proxyGetApi(path),
          { label: false },
        ),
      detectRepo: detectCurrentRepo,
    },
  );
}

export function registerSpecTraceTools(server: McpServer) {
  server.tool(
    "lore-query-trace",
    `READ side of spec-traceability: returns per-statement coverage for a spec — which tests validate each statement and which are drifted or violated. Read-only; executes and builds nothing. The graph is (re)projected by CI — specs/adrs on push, tests via lore-tests.yml — not by an MCP tool. Instead: to enumerate or run tests locally use lore_list_tests / lore_run_test.`,
    {
      spec: z
        .string()
        .describe(
          "Spec file path relative to the repo root, e.g. 'specs/auth/spec.md'.",
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
    },
    async (args) => textResult(await queryTrace(args)),
  );
}
