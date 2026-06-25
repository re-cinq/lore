import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      // 100% on the new ai-agent-subsystem backend logic (ADR-031, #683). The IO
      // adapter (kube-agent-api.ts) and composition roots are excluded — the pure
      // mapping + decision logic is what's enforced. Other floor files aren't gated
      // yet (legacy code is not retroactively boiled to 100%).
      include: ["src/adapters/agent-backend.ts", "src/adapters/execution-backend.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
