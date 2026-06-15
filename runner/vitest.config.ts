import { defineConfig } from "vitest/config";

// Excludes dist/** (compiled duplicates of the src tests) so the suite no longer
// requires `npm run build` first to avoid running stale compiled tests — matches
// the shared/agent/mcp configs.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
  },
});
