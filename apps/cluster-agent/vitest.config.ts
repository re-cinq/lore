import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      // 100% on the routing decisions — status mapping, the page ceiling, the
      // tail clamp. The Kubernetes adapters and the composition root are
      // excluded: they cannot run without a cluster.
      include: ["src/delivery/routes/cluster.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
