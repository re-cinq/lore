import { defineConfig } from "vitest/config";

// Mirrors the shared/mcp-server configs: node env, dist excluded so the suite never runs stale compiled copies.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
  },
});
