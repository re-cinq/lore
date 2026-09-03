import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["src/integration-tests/**", "dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      // Scope the gate to new pure logic, file by file, as each is added (IO route shells + k8s adapters stay out, like the floor's).
      include: ["src/features/agents/agent-crd.ts"],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
