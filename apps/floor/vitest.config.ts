import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      // 100% gate on the pure mapping/decision logic of ai-agent-subsystem backend files (ADR-031, #683); IO adapters, composition roots, and other legacy floor files are excluded and not retroactively gated.
      include: [
        "src/work/agent/agent-catalog.ts",
        "src/work/agent/catalog-builders.ts",
        "src/work/agent/agent-events.ts",
        "src/work/agent/agent-run-events.ts",
        "src/work/agent/agent-event-bus.ts",
        "src/work/assembly-run/floor-assembly-run.ts",
        "src/work/assembly-run/llm-dispatch-gate.ts",
        "src/work/assembly-run/assembly-run-station-backend.ts",
        "src/work/assembly-run/spec-pr.ts",
        "src/work/station/agent-cr-station-backend.ts",
        "src/work/station/station-run-input.ts",
        "src/domain/agent-watcher-logic.ts",
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
