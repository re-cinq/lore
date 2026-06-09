import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToolDeps } from "./deps.js";

export function registerSpecTraceLocalTools(server: McpServer, _deps: ToolDeps) {
  server.tool(
    "list_tests",
    "Enumerate the repo's tests via its declared test-command manifest (.lore/test-commands.yml), feeding the spec-traceability graph. Runs the project's own list command in your local sandbox; the shared cluster server refuses and tells you to run in CI or locally.",
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
    "run_test",
    "Run one test by its runner-native id via the repo's test-command manifest; returns pass/fail + the covered code chunks. Executes in your local sandbox; the shared cluster server refuses and tells you to run in CI or locally.",
    {
      selector: z.string().describe("Runner-native test id from list_tests (e.g. pytest path::Class::test, vitest file+name, Go TestX)."),
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
