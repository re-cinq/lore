import { defineConfig } from "vitest/config";
import { workspaceSourceAliases } from "../../tools/vitest/workspace-source.js";

export default defineConfig({
  // Tests read workspace packages from source: a test never needs a build (tools/vitest/workspace-source.ts).
  resolve: { alias: workspaceSourceAliases() },
  test: {
    globals: true,
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
  },
});
