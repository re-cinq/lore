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
      // adapters (kube-agent-api.ts) and composition roots are
      // excluded — the pure mapping + decision logic is what's enforced. Other floor
      // files aren't gated yet (legacy code is not retroactively boiled to 100%).
      // The agent-watcher orchestration shell (agent-watcher.ts) is IO-bound and
      // excluded, as loretask-watcher is; its extracted pure logic is gated here.
      // Paths track the jobs/ layout after the #730 re-slice + #731 LoreTask removal
      // (execution-backend / routing-station-backend were deleted with the router).
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
        "src/jobs/watcher/agent-watcher-logic.ts",
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
