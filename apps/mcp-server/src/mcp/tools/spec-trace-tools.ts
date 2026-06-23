import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectCurrentRepo } from "../../features/repo/repo-detect.js";
import { ToolDeps, proxyGetApi, withReadCache } from "./deps.js";
import { runQueryTrace } from "../../features/spec-trace/query-trace.js";

export function registerSpecTraceTools(server: McpServer, deps: ToolDeps) {
  const { getPool } = deps;

  server.tool(
    "lore_ingest_graph",
    `WRITE side of spec-traceability: creates one ingestion pipeline task per requested kind (specs, adrs, tests) and returns the created task ids under a single group id. Idempotent — in-flight tasks for a kind are skipped. Instead: to READ spec coverage from the built graph use lore-query-trace; to enumerate or run tests locally use lore_list_tests / lore_run_test.`,
    {
      repo: z.string().optional().describe("Target repo as 'owner/repo'. Defaults to the repo detected from cwd git remote."),
      kinds: z.array(z.enum(["specs", "adrs", "tests"])).optional().describe("Which kinds to ingest. Defaults to all three."),
      ref: z.string().optional().describe("Branch name or commit SHA. Defaults to the repo's default branch."),
      force: z.boolean().optional().describe("When true, re-processes all specs/adrs files even if content is unchanged. Has no effect on the tests kind."),
    },
    async ({ repo, kinds, ref, force }) => {
      try {
        const targetRepo = repo || detectCurrentRepo();
        if (!targetRepo) {
          return { content: [{ type: "text" as const, text: "No repo specified and could not detect the current repo (run inside a git repo or pass `repo`)." }] };
        }
        const dbPoolRef = getPool();
        if (!dbPoolRef) {
          return { content: [{ type: "text" as const, text: "Database not available — cannot create ingestion tasks." }] };
        }
        const { createIngestGraphTasks } = await import("../../features/spec-trace/ingest-graph-tasks.js");
        const result = await createIngestGraphTasks(dbPoolRef, targetRepo, { kinds, branch: ref, createdBy: "lore_ingest_graph", force });
        const lines = result.created.map((t) => `  • ${t.kind}: ${t.id}`).join("\n");
        const skippedNote = result.skipped.length ? `\nSkipped (already in flight): ${result.skipped.join(", ")}` : "";
        return { content: [{ type: "text" as const, text: `Created ${result.created.length} ingestion task(s) for ${targetRepo} (group ${result.groupId}):\n${lines}${skippedNote}\n\nRun one locally with: lore_run_task_locally <task_id>` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error creating ingestion tasks: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore-query-trace",
    `READ side of spec-traceability: returns per-statement coverage for a spec — which tests validate each statement and which are drifted or violated. Read-only; executes and builds nothing. Instead: to rebuild the graph use lore_ingest_graph; to enumerate or run tests locally use lore_list_tests / lore_run_test.`,
    {
      spec: z.string().describe("Spec file path relative to the repo root, e.g. 'specs/auth/spec.md'."),
      statement: z.string().optional().describe("1-based ordinal (e.g. '3') or unique text substring to narrow to a single statement. Omit for whole-spec summary."),
      repo: z.string().optional().describe("Target repo as 'owner/repo'. Defaults to the repo detected from cwd git remote."),
    },
    async ({ spec, statement, repo }) => {
      const cachedGet = (path: string) =>
        withReadCache(
          { tool: "lore-query-trace", args: { path }, repo: repo || undefined, ttlSeconds: 600 },
          () => proxyGetApi(path),
          { label: false },
        );
      const text = await runQueryTrace(
        { repo, spec, statement },
        { proxyGet: cachedGet, detectRepo: detectCurrentRepo },
      );
      return { content: [{ type: "text" as const, text }] };
    }
  );
}
