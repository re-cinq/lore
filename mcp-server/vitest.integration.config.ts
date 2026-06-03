import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/integration-tests/**/*.test.ts"],
    testTimeout: 30000,
  },
});
