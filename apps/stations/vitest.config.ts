import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      // 100% on the routing/latch logic. The pool, the hapi wiring, the boot and
      // the moved stations themselves are excluded — the stations keep the tests
      // they arrived with, and the rest cannot run without a database.
      include: ["src/delivery/routes/stations.ts"],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
