import { defineConfig } from "vitest/config";

// Excludes dist/** (compiled duplicates of the src tests) so the suite does not
// require `npm run build` first to avoid running stale compiled tests.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
  },
});
