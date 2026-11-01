import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { textResult } from "../shared/deps.js";
import { localManifest } from "./shared/local-manifest.js";

const listTests = async (): Promise<ReturnType<typeof textResult>> => {
  try {
    const { listTestsTool } =
      await import("../../../work/spec-trace/spec-trace-tools.js");
    const { root, manifest } = await localManifest();

    return textResult(await listTestsTool(process.env, manifest, root));
  } catch (err) {
    return textResult(`Error: ${errorMessage(err)}`);
  }
};

export function registerListTestsTool(server: McpServer) {
  server.tool(
    "lore_list_tests",
    `Runs the repo's .lore/test-commands.yml 'list' command and returns a JSON array of test descriptors {id, name, file, startLine?, endLine?, suite?, spec?}; 'id' is the selector to pass to lore_run_test. Use to discover available tests before running one. Instead: to run a test and see coverage use lore_run_test; to read built-graph coverage without executing use lore-query-trace.
Trusted-sandbox only — executes a shell command in your local checkout. The shared cluster server refuses and returns "Test commands run only in a trusted sandbox — run in CI or locally."`,
    {},
    listTests,
  );
}
