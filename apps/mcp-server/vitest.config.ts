import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["src/integration-tests/**", "dist/**", "node_modules/**"],
    // No coverage gate. The previous one named `agents/agent-crd.ts`, a file
    // that has never existed here, so it measured 0/0 and passed on an empty
    // set — protection in appearance only. Add a gate here file by file when
    // there is pure logic to hold to it, the way floor and assembly-lines do.
  },
});
