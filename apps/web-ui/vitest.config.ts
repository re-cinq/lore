import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        // IO glue (not unit-testable without live DB/auth/GitHub).
        "src/lib/api/schema.d.ts",
        "src/lib/db.ts",
        "src/lib/trace-api.ts",
        "src/lib/webhook-api.ts",
        "src/lib/task-runtime.ts",
        "src/lib/auth.ts",
        "src/lib/auth-options.ts",
        "src/lib/session.ts",
        "src/lib/github.ts",
        "src/lib/api-error.ts",
        "src/lib/theme/fonts.ts",
        "src/lib/theme/theme-script.ts",
        "src/middleware.ts",
        // Next.js API route handlers (server endpoints → DB/GitHub IO).
        "src/app/api/**",
        // App Router containers + layouts + next-auth session provider.
        "src/app/**/page.tsx",
        "src/app/**/layout.tsx",
        "src/app/SessionWrapper.tsx",
        // D3/SVG visualization shells (imperative canvas, not jsdom-testable; pure logic in src/lib/*).
        "src/app/repos/[owner]/[repo]/graph/SpecGraphD3.tsx",
        "src/app/repos/[owner]/[repo]/graph/TestPreview.tsx",
        "src/app/repos/[owner]/[repo]/graph/IngestButtons.tsx",
        // Split out of the SpecGraphD3.tsx shell above, so the same exemption follows them; the pure halves it also yielded (spec-graph-ring-layout, spec-graph-node-links) stay measured.
        "src/app/repos/[owner]/[repo]/graph/SpecGraphOverlays.tsx",
        "src/app/repos/[owner]/[repo]/graph/spec-graph-canvas-draw.ts",
        "src/app/repos/[owner]/[repo]/graph/spec-graph-canvas-draw-edges.ts",
        "src/app/repos/[owner]/[repo]/graph/spec-graph-canvas-draw-leaves.ts",
        "src/app/repos/[owner]/[repo]/graph/spec-graph-controller-interaction.ts",
        "src/app/repos/[owner]/[repo]/graph/spec-graph-controller-nodes.ts",
        "src/app/repos/[owner]/[repo]/graph/spec-graph-controller-rings.ts",
        "src/app/repos/[owner]/[repo]/graph/spec-graph-controller-types.ts",
        "src/app/repos/[owner]/[repo]/graph/spec-graph-data-prep.ts",
        "src/app/repos/[owner]/[repo]/graph/spec-graph-focus-state.ts",
        "src/app/repos/[owner]/[repo]/graph/spec-graph-seed-layout.ts",
        "src/app/repos/[owner]/[repo]/graph/spec-graph-simulation.ts",
        "src/app/repos/[owner]/[repo]/graph/spec-graph-spacing.ts",
        "src/app/repos/[owner]/[repo]/graph/spec-graph-visual.ts",
        // Feature-planning UI shells (interactive/IO like graph shells; pure logic in feature-status.ts).
        "src/app/repos/[owner]/[repo]/features/**/*.tsx",
        // Infinite-scroll pager (IntersectionObserver + fetch shell; query logic in events/pagination.ts).
        "src/app/repos/[owner]/[repo]/events/InfiniteEvents.tsx",
        // Pod-log panel (fetch + polling shell; pure logic in node-pod-logs-presenter.ts).
        "src/app/assembly-runs/[id]/NodeLogPanel.tsx",
        // Type shapes + constants mirroring the /trace API JSON (no logic).
        "src/lib/spec-graph.ts",
        // Test / type-only files.
        "src/**/*.test.{ts,tsx}",
        "src/**/*.d.ts",
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        statements: 95,
        branches: 90,
      },
    },
  },
});
