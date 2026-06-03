import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["src/integration-tests/**", "dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["src/routes.ts", "src/routes/**/*.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
