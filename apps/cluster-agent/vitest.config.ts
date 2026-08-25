import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      // 100% on the DECISIONS — status mapping, the page ceiling, the tail
      // clamp, the conflict ladder, the order a catalog pair is written in.
      // The Kubernetes adapters and the composition root are excluded: they
      // cannot run without a cluster.
      //
      // `paired-writes.ts` and `k8s-errors.ts` are on this list because they
      // used to be inline in the excluded composition root, and both shipped a
      // defect while they were: no conflict retry, and a write order that
      // contradicted its own sibling's comment. Decision logic behind an
      // exclusion is decision logic nobody tests.
      include: [
        "src/delivery/routes/cluster.ts",
        "src/kernel/paired-writes.ts",
        "src/kernel/k8s-errors.ts",
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
