import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/integration-tests/**/*.test.ts"],
    // One Postgres for every file: run side by side, one file's write lands in
    // another's read (the catalog tail saw a row a seeding test wrote, twice on
    // 2026-10-02), so the files run one after another.
    fileParallelism: false,
    testTimeout: 30000,
  },
});
