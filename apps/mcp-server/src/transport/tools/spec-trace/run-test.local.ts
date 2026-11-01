import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { textResult } from "../shared/deps.js";
import { localManifest } from "./shared/local-manifest.js";

const runTest = async ({
  selector,
}: {
  selector: string;
}): Promise<ReturnType<typeof textResult>> => {
  try {
    const { runTestTool } =
      await import("../../../work/spec-trace/spec-trace-tools.js");
    const { root, manifest } = await localManifest();

    return textResult(await runTestTool(process.env, manifest, selector, root));
  } catch (err) {
    return textResult(`Error: ${errorMessage(err)}`);
  }
};

const RUN_TEST_INPUT = {
  selector: z
    .string()
    .describe(
      "Runner-native test id from lore_list_tests output; substituted into the manifest's run command at the {selector} placeholder. Format is runner-specific, e.g. 'tests/test_api.py::TestAuth::test_login' (pytest) or 'src/auth.test.ts > logs in' (vitest).",
    ),
};

export function registerRunTestTool(server: McpServer) {
  server.tool(
    "lore_run_test",
    `Runs a single test by selector using the repo's .lore/test-commands.yml 'run' command; returns {passed: boolean, covered: [{file, startLine, endLine}]}. Use to execute ONE test and see what code it covers. Instead: to discover selectors first use lore_list_tests; to read built-graph coverage without executing use lore-query-trace.
Trusted-sandbox only — executes a shell command in your local checkout. The shared cluster server refuses and returns "Test commands run only in a trusted sandbox — run in CI or locally."`,
    RUN_TEST_INPUT,
    runTest,
  );
}
