import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      // 100% on the DECISIONS (status mapping, page ceiling, conflict ladder, catalog write order); Kubernetes adapters and the composition root are excluded since they need a cluster.
      include: [
        "src/transport/routes/agent-events.ts",
        "src/transport/routes/cluster.ts",
        "src/work/inputs/pod-log-batching.ts",
        "src/outbound/telemetry-sink.ts",
        "src/outbound/paired-writes.ts",
        "src/lib/k8s-errors.ts",
      ],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
