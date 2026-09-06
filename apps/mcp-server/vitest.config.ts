import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["src/integration-tests/**", "dist/**", "node_modules/**"],
    // No coverage gate: the previous one named a file that never existed, so it measured 0/0 and passed on an empty set. Add one file by file when there is pure logic to hold to it.
  },
});
