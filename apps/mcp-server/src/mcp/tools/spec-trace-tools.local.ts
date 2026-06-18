import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToolDeps } from "./deps.js";

export function registerSpecTraceLocalTools(server: McpServer, _deps: ToolDeps) {
  server.tool(
    "lore_list_tests",
    `Enumerate the current repo's tests by running its declared 'list' command from .lore/test-commands.yml in your local checkout; returns a JSON array of test descriptors {id, name, file, startLine?, endLine?, suite?, spec?} where 'id' is the runner-native selector you pass to lore_run_test; file paths are returned repo-relative (the manifest's path_prefix_strip is removed) and the list command runs in the manifest's declared 'cwd' subdir (for monorepos), defaulting to the repo root. Use this to discover what tests exist and their selectors before executing one. For running a single test and seeing the code it covers, use lore_run_test; to read already-computed spec coverage from the built graph (no execution), use lore-query-trace; to (re)build that graph, use lore_ingest_graph.
This tool executes an arbitrary shell command, so it runs ONLY in a trusted local sandbox (your dev machine, CI, or a claude-runner pod). When LORE_DB_HOST is set (the shared cluster server), it refuses without running anything and returns "Test commands run only in a trusted sandbox — run in CI or locally." It takes no input (repo root and manifest are auto-resolved from the cwd's git toplevel). No DB, no network, no writes. If the repo has no .lore/test-commands.yml it returns "No test-command manifest declared for this repo."; on any other failure it returns "Error: {message}". Never throws.`,
    {},
    async () => {
      try {
        const { listTestsTool, loadTestCommandManifest } = await import("../../features/spec-trace/spec-trace-tools.js");
        const { getRepoRoot } = await import("../../features/pipeline/runner.local.js");
        const root = getRepoRoot() || process.cwd();
        const text = await listTestsTool(process.env, loadTestCommandManifest(root), root);
        return { content: [{ type: "text" as const, text }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_run_test",
    `Run a single test by its runner-native selector by substituting it into the current repo's 'run' command from .lore/test-commands.yml and executing in your local checkout; returns a JSON object {passed: boolean, covered: [{file, startLine, endLine}]} giving the pass/fail outcome plus the code ranges that test exercised. Covered file paths are returned repo-relative (the manifest's path_prefix_strip is removed) and the run command executes in the manifest's declared 'cwd' subdir, defaulting to the repo root. Use this to run ONE test and learn what it covers. To first discover the available tests and their selectors, use lore_list_tests; to read coverage already computed in the spec-traceability graph without running anything, use lore-query-trace; to (re)build that graph, use lore_ingest_graph.
This tool executes an arbitrary shell command, so it runs ONLY in a trusted local sandbox (your dev machine, CI, or a claude-runner pod). When LORE_DB_HOST is set (the shared cluster server), it refuses without running anything and returns "Test commands run only in a trusted sandbox — run in CI or locally." No DB, no network, no writes. If the repo has no .lore/test-commands.yml it returns "No test-command manifest declared for this repo."; on any other failure it returns "Error: {message}". Never throws.`,
    {
      selector: z.string().describe("Runner-native test id for the single test to run, taken from an 'id' field in lore_list_tests output; substituted into the manifest's run command at the {selector} placeholder. Format is runner-specific, e.g. pytest 'tests/test_api.py::TestAuth::test_login', vitest 'src/auth.test.ts > logs in', or Go 'TestLogin'. Required, no default."),
    },
    async ({ selector }) => {
      try {
        const { runTestTool, loadTestCommandManifest } = await import("../../features/spec-trace/spec-trace-tools.js");
        const { getRepoRoot } = await import("../../features/pipeline/runner.local.js");
        const root = getRepoRoot() || process.cwd();
        const text = await runTestTool(process.env, loadTestCommandManifest(root), selector, root);
        return { content: [{ type: "text" as const, text }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );
}
