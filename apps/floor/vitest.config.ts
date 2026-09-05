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
        "src/jobs/agent/agent-catalog.ts",
        "src/jobs/agent/agent-events.ts",
        "src/jobs/agent/agent-run-events.ts",
        "src/jobs/agent/agent-event-bus.ts",
        "src/jobs/assembly-run/floor-assembly-run.ts",
        "src/jobs/assembly-run/llm-dispatch-gate.ts",
        "src/jobs/assembly-run/assembly-run-station-backend.ts",
        "src/jobs/assembly-run/spec-pr.ts",
        "src/jobs/station/agent-cr-station-backend.ts",
        "src/jobs/lib/agent-watcher-logic.ts",
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
