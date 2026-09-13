import { defineConfig } from "vitest/config";
import { workspaceSourceAliases } from "../../tools/vitest/workspace-source.js";

export default defineConfig({
  // Tests read workspace packages from source: a test never needs a build (tools/vitest/workspace-source.ts).
  resolve: { alias: workspaceSourceAliases() },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["src/integration-tests/**", "dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["src/transport/route-list.ts", "src/transport/routes/**/*.ts"],
    },
  },
});
