import { defineConfig } from "vitest/config";
import { workspaceSourceAliases } from "../../tools/vitest/workspace-source.js";

export default defineConfig({
  // Tests read workspace packages from source: a test never needs a build (tools/vitest/workspace-source.ts).
  resolve: { alias: workspaceSourceAliases() },
  test: {
    globals: true,
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      // 100% coverage on routing/latch only; pool/work/boot excluded (need database).
      include: ["src/transport/routes/stations.ts"],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
