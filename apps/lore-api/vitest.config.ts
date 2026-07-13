import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["src/integration-tests/**", "dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["src/api/routes.ts", "src/api/routes/**/*.ts"],
    },
  },
});
