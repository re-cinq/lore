import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectCurrentRepo } from "../../features/repo/repo-detect.js";
import { ToolDeps, proxyGetApi } from "./deps.js";
import { runQueryTrace } from "../../features/spec-trace/query-trace.js";

export function registerSpecTraceTools(server: McpServer, deps: ToolDeps) {
  const { getPool } = deps;

  server.tool(
    "ingest_graph",
    "Create spec-traceability graph ingestion tasks — one per kind (specs, adrs, tests). Each is a pipeline task (id + description, visible in the UI) the agent runner picks up (specs/adrs) or you run locally with run_task_locally. Idempotent: re-running with no changes is a no-op (only changed files re-project).",
    {
      repo: z.string().optional().describe("owner/repo. Defaults to the current repo."),
      kinds: z.array(z.enum(["specs", "adrs", "tests"])).optional().describe("Which kinds to ingest. Default: all three."),
      ref: z.string().optional().describe("Branch (or commit) to ingest at. Default: the repo's default branch."),
    },
    async ({ repo, kinds, ref }) => {
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
        const result = await createIngestGraphTasks(dbPoolRef, targetRepo, { kinds, branch: ref, createdBy: "ingest_graph" });
        const lines = result.created.map((t) => `  • ${t.kind}: ${t.id}`).join("\n");
        const skippedNote = result.skipped.length ? `\nSkipped (already in flight): ${result.skipped.join(", ")}` : "";
        return { content: [{ type: "text" as const, text: `Created ${result.created.length} ingestion task(s) for ${targetRepo} (group ${result.groupId}):\n${lines}${skippedNote}\n\nRun one locally with: run_task_locally <task_id>` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error creating ingestion tasks: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore-query-trace",
    "Query the spec-traceability graph for a spec: which statements are validated/implemented/decided by what, and which are drifted or violated. Reads the main-branch graph via the Lore API.",
    {
      spec: z.string().describe("Spec file path, e.g. 'specs/auth/spec.md'."),
      statement: z.string().optional().describe("Focus one statement: its ordinal (e.g. '3') or a text substring. Omit for a coverage + needs-attention summary."),
      repo: z.string().optional().describe("owner/repo. Defaults to the current repo."),
    },
    async ({ spec, statement, repo }) => {
      const text = await runQueryTrace(
        { repo, spec, statement },
        { proxyGet: proxyGetApi, detectRepo: detectCurrentRepo },
      );
      return { content: [{ type: "text" as const, text }] };
    }
  );
}
