import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { textResult } from "./deps.js";

export function registerSpecTraceLocalTools(server: McpServer) {
  server.tool(
    "lore_list_tests",
    `Runs the repo's .lore/test-commands.yml 'list' command and returns a JSON array of test descriptors {id, name, file, startLine?, endLine?, suite?, spec?}; 'id' is the selector to pass to lore_run_test. Use to discover available tests before running one. Instead: to run a test and see coverage use lore_run_test; to read built-graph coverage without executing use lore-query-trace.
Trusted-sandbox only — executes a shell command in your local checkout. The shared cluster server refuses and returns "Test commands run only in a trusted sandbox — run in CI or locally."`,
    {},
    async () => {
      try {
        const { listTestsTool, loadTestCommandManifest } =
          await import("../../features/spec-trace/spec-trace-tools.js");
        const { getRepoRoot } =
          await import("../../features/pipeline/runner.local.js");
        const root = getRepoRoot() || process.cwd();
        const text = await listTestsTool(
          process.env,
          loadTestCommandManifest(root),
          root,
        );

        return textResult(text);
      } catch (err) {
        return textResult(`Error: ${errorMessage(err)}`);
      }
    },
  );

  server.tool(
    "lore_run_test",
    `Runs a single test by selector using the repo's .lore/test-commands.yml 'run' command; returns {passed: boolean, covered: [{file, startLine, endLine}]}. Use to execute ONE test and see what code it covers. Instead: to discover selectors first use lore_list_tests; to read built-graph coverage without executing use lore-query-trace.
Trusted-sandbox only — executes a shell command in your local checkout. The shared cluster server refuses and returns "Test commands run only in a trusted sandbox — run in CI or locally."`,
    {
      selector: z
        .string()
        .describe(
          "Runner-native test id from lore_list_tests output; substituted into the manifest's run command at the {selector} placeholder. Format is runner-specific, e.g. 'tests/test_api.py::TestAuth::test_login' (pytest) or 'src/auth.test.ts > logs in' (vitest).",
        ),
    },
    async ({ selector }) => {
      try {
        const { runTestTool, loadTestCommandManifest } =
          await import("../../features/spec-trace/spec-trace-tools.js");
        const { getRepoRoot } =
          await import("../../features/pipeline/runner.local.js");
        const root = getRepoRoot() || process.cwd();
        const text = await runTestTool(
          process.env,
          loadTestCommandManifest(root),
          selector,
          root,
        );

        return textResult(text);
      } catch (err) {
        return textResult(`Error: ${errorMessage(err)}`);
      }
    },
  );
}
