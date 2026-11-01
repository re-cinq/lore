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
    // Gated on the tool folder only; the rest of the adapter has no gate yet.
    coverage: {
      include: ["src/transport/tools/**/*.ts"],
      exclude: ["src/transport/tools/**/*.test.ts", "src/transport/tools/**/test-*.ts"],
      thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
    },
  },
});
