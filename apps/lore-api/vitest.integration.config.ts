import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/integration-tests/**/*.test.ts"],
    // Every file shares one Postgres, so files run one after another: side by side, one file's write lands in another's read.
    fileParallelism: false,
    testTimeout: 30000,
  },
});
