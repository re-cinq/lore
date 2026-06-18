import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectCurrentRepo } from "../../features/repo/repo-detect.js";
import { ToolDeps, proxyGetApi, withReadCache } from "./deps.js";
import { runQueryTrace } from "../../features/spec-trace/query-trace.js";

export function registerSpecTraceTools(server: McpServer, deps: ToolDeps) {
  const { getPool } = deps;

  server.tool(
    "lore_ingest_graph",
    `Builds (or rebuilds) the spec-traceability graph by creating one zero-LLM ingestion pipeline task per requested kind (specs, adrs, tests) and returning the created task ids grouped under a single group id. Each created task is a normal pipeline task — the agent runner picks up specs/adrs automatically; tests are run locally via lore_run_task_locally. This is the WRITE/build side of spec-traceability: use it to populate or refresh the graph. To READ a spec's coverage and drifted/violated statements from the already-built main-branch graph, use lore-query-trace instead; to enumerate or execute the repo's tests in your local checkout, use lore_list_tests / lore_run_test. Runs against the shared-DB-only backend (requires a direct DB via LORE_DB_HOST); it does not proxy over LORE_API_URL and returns a "Database not available" message when no pool is configured. Side effect: inserts one pipeline.tasks row per non-skipped kind (each recording a pending task event). Idempotent — a kind that already has an in-flight task (pending/queued/running/running-local) for this repo is skipped so re-runs never stack duplicates, and for the specs/adrs kinds the downstream projection re-processes only content-changed files unless force=true (the tests kind always re-runs the full suite — force does not apply). Returns the count, the group id, a "  • {kind}: {task_id}" line per created task, and a "Skipped (already in flight)" note when any kind was skipped; never throws — every outcome is returned as text.`,
    {
      repo: z.string().optional().describe("Target repo as 'owner/repo', e.g. 're-cinq/lore'. When omitted, defaults to the repo detected from the current working directory's git remote; if no repo is given and none can be detected, the tool returns a no-repo message."),
      kinds: z.array(z.enum(["specs", "adrs", "tests"])).optional().describe("Which graph source kinds to ingest, as an array of any of 'specs', 'adrs', 'tests', e.g. ['specs','adrs']. When omitted or empty, all three are ingested. One pipeline task is created per kind."),
      ref: z.string().optional().describe("Git branch name or commit SHA to ingest at, e.g. 'main' or a 40-char SHA. When omitted, defaults to the repo's default branch. Passed through to the created task as its branch."),
      force: z.boolean().optional().describe("When true, the specs/adrs projection re-processes every file even if its content hash is unchanged, bypassing the no-op skip (e.g. after changing the parser/segmenter). Has no effect on the tests kind, which always re-runs the full suite. Defaults to false (only content-changed spec/adr files re-project)."),
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
    `Reads the spec-traceability graph for one spec and returns, as human-readable text, how each of its statements is covered: which tests validate it, which code/ADRs implement or decide it, and which statements are drifted (the linked test/code moved or the link rotted) or violated (a linked test is currently failing). This is the READ side of spec-traceability — it executes nothing and builds nothing. To (re)build or refresh the graph use lore_ingest_graph instead; to enumerate or run the repo's tests in your local checkout use lore_list_tests / lore_run_test. Reads the already-built main-branch graph from the shared backend over the Lore API (proxies a GET to LORE_API_URL; in local stdio mode requires LORE_API_URL + LORE_INGEST_TOKEN, configured by install.sh) and read-through caches each result for ~10 minutes, so repeat queries are instant and survive a brief backend outage by serving the last good copy. Read-only, no mutations. Never throws — a missing spec, an empty graph, or an unreachable backend is returned as explanatory text.`,
    {
      spec: z.string().describe("Spec file path relative to the repo root, e.g. 'specs/auth/spec.md'. Required — selects which spec's statements to report on."),
      statement: z.string().optional().describe("Narrow the report to a single statement: pass its 1-based ordinal as a string (e.g. '3') or a unique text substring of the statement. When omitted, returns a whole-spec summary — per-statement coverage plus a 'needs attention' list of drifted/violated statements."),
      repo: z.string().optional().describe("Target repo as 'owner/repo', e.g. 're-cinq/lore'. When omitted, defaults to the repo detected from the current working directory's git remote."),
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
