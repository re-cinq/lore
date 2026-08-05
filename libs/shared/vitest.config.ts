import { defineConfig } from "vitest/config";

// Probe the local Dgraph exactly the way the container-gated integration suites
// do (src/spec-trace/*, the memory stores), so the config can react to it.
async function dgraphReachable(): Promise<boolean> {
  const url = process.env.DGRAPH_HTTP ?? "http://localhost:8081";

  try {
    return (await fetch(`${url}/health`, { signal: AbortSignal.timeout(800) }))
      .ok;
  } catch {
    return false;
  }
}

// Excludes dist/** (compiled duplicates of the src tests) so the suite no longer
// requires `npm run build` first to avoid running stale compiled tests — matches
// the agent/mcp configs. setupFiles installs the global No-LLM guard.
export default defineConfig(async () => {
  const dgraphUp = await dgraphReachable();

  return {
    test: {
      globals: true,
      environment: "node",
      setupFiles: ["./vitest.setup.ts"],
      exclude: ["dist/**", "node_modules/**"],
      // ~two dozen container-gated suites write to ONE real Dgraph. Running their
      // files in parallel races on that single container (throughput + the schema
      // applier), which flakes them non-deterministically. When a Dgraph is
      // reachable (local dev) serialize files so they can't contend; in CI no
      // Dgraph is reachable, those suites skip, and full parallelism is kept.
      fileParallelism: !dgraphUp,
      // The real Dgraph round-trips (schema apply + per-test mutations/queries)
      // can exceed the 5s default on a cold/contended container; use the repo's
      // integration ceiling (cf. apps/lore-api/vitest.integration.config.ts).
      // Unit tests finish in ms — the ceiling only bounds a genuine hang.
      testTimeout: 30000,
      hookTimeout: 30000,
    },
  };
});
