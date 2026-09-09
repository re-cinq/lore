import { defineConfig } from "vitest/config";

// Probes the local Dgraph the same way the container-gated integration suites do, so the config can react.
async function dgraphReachable(): Promise<boolean> {
  const url = process.env.DGRAPH_HTTP ?? "http://localhost:8081";

  try {
    return (await fetch(`${url}/health`, { signal: AbortSignal.timeout(800) }))
      .ok;
  } catch {
    return false;
  }
}

// Excludes dist/** so the suite doesn't need npm run build first (matches agent/mcp configs); setupFiles installs the No-LLM guard.
export default defineConfig(async () => {
  const dgraphUp = await dgraphReachable();

  return {
    test: {
      globals: true,
      environment: "node",
      setupFiles: ["./vitest.setup.ts"],
      exclude: ["dist/**", "node_modules/**"],
      // ~2 dozen suites share ONE real Dgraph; serialize files when it's reachable (local dev) to avoid flaky races, else full parallelism.
      fileParallelism: !dgraphUp,
      // A cold/contended Dgraph can exceed the 5s default; use the repo's integration ceiling (cf. lore-api/vitest.integration.config.ts).
      testTimeout: 30000,
      hookTimeout: 30000,
    },
  };
});
