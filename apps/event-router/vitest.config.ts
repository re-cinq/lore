import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      // 100% on this service's decision logic. The excluded files are the IO
      // shells and composition roots — the reconnect loop and live Watch
      // (`k8s-watch.ts`), the pool, the hapi wiring, the boot — which cannot be
      // exercised without a cluster and a database. Same split the Floor's
      // config makes, and the reason `agent-reporting.ts` exists apart from the
      // connection that feeds it.
      include: [
        "src/delivery/routes/events.ts",
        "src/listeners/agent-reporting.ts",
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
