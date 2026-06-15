import { defineConfig } from "vitest/config";

// Excludes dist/** (compiled duplicates of the src tests) so the suite no longer
// requires `npm run build` first to avoid running stale compiled tests — matches
// the agent/mcp configs. setupFiles installs the global No-LLM guard.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
