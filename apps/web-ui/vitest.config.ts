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
        // IO / config glue — not unit-testable without a live DB / auth / GitHub.
        // The container/presentational split keeps render logic in *View.tsx
        // (covered) and confines IO to these files and the page.tsx containers.
        "src/lib/db.ts",
        "src/lib/trace-api.ts",
        "src/lib/webhook-api.ts",
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
        // App Router containers (data fetching only → return <XView .../>) + layouts
        // + the next-auth session provider wrapper.
        "src/app/**/page.tsx",
        "src/app/**/layout.tsx",
        "src/app/SessionWrapper.tsx",
        // D3/SVG visualization shells: imperative canvas rendering + fetch IO, not
        // unit-testable in jsdom. Their pure geometry/state/grouping logic lives in
        // the covered src/lib/* modules (ring-exclusion, segment-clip, anchor-spacing,
        // graph-persistence, spec-grouping).
        "src/app/repos/[owner]/[repo]/graph/SpecGraphD3.tsx",
        "src/app/repos/[owner]/[repo]/graph/TestPreview.tsx",
        "src/app/repos/[owner]/[repo]/graph/IngestButtons.tsx",
        // Feature-planning UI shells: the polling wizard, the sandboxed-iframe
        // mockup renderer, and the schema-driven gap renderer are interactive /
        // IO render shells like the graph components above. Their pure logic is
        // covered in feature-status.ts + lib/feature-api.ts.
        "src/app/repos/[owner]/[repo]/features/**/*.tsx",
        // Infinite-scroll pager: an IntersectionObserver + fetch shell (browser
        // APIs absent in jsdom), like the graph/feature shells above. The query
        // it pages is covered in events/pagination.ts; the row markup in
        // EventsView/EventRow tests.
        "src/app/repos/[owner]/[repo]/events/InfiniteEvents.tsx",
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
