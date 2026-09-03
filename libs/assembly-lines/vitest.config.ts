import { defineConfig } from "vitest/config";

// Excludes dist/** (compiled duplicates) so the suite doesn't need `npm run build` first to avoid stale compiled tests — matches shared/agent/mcp configs.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      // Scope the gate to new pure/port-injected logic, file by file, as added (ADR-031 Wave 2) — legacy kernel files are not retroactively boiled to 100%.
      include: [
        "src/node-outcome.ts",
        "src/failure-reason.ts",
        "src/github-action-handler.ts",
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
