/** Whether the live-Dgraph suites should run: reachable, and not suppressed by LORE_SKIP_DGRAPH_TESTS (set by the unit script so ~two dozen suites sharing one graph cannot flake it). */

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";

export async function dgraphReachable(): Promise<boolean> {
  if (process.env.LORE_SKIP_DGRAPH_TESTS === "1") {
    return false;
  }

  try {
    return (
      await fetch(`${DGRAPH_HTTP}/health`, { signal: AbortSignal.timeout(800) })
    ).ok;
  } catch {
    return false;
  }
}
