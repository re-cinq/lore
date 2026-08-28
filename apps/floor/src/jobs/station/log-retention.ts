/**
 * The retention reap for the two high-volume telemetry tables.
 *
 * `agent_run_events.pruneOld` has existed since ADR-037 with the 14-day window
 * documented in the ADR and the migration — and NO CALLER, so nothing has ever
 * been pruned. `pod_log_chunks` is the same shape and a bigger one (raw stdout,
 * every node type, not just the agents), so it ships with the reap wired rather
 * than repeating that.
 *
 * Pure decision, injected stores: what "old" means and what the sweep reports
 * are testable without a pool.
 */

export const RETENTION_DAYS = 14;

export interface PrunableStore {
  pruneOld(olderThanDays: number): Promise<number>;
}

export interface RetentionDeps {
  runEvents: PrunableStore;
  podLogs: PrunableStore;
  days?: number;
}

/**
 * Prune both, and say what went. Each store is pruned independently — one
 * failing must not leave the other unpruned, since the whole point is that
 * neither grows without bound.
 */
export async function pruneTelemetry(deps: RetentionDeps): Promise<string> {
  const days = deps.days ?? RETENTION_DAYS;
  const [runEvents, podLogs] = await Promise.allSettled([
    deps.runEvents.pruneOld(days),
    deps.podLogs.pruneOld(days),
  ]);

  const describe = (name: string, result: PromiseSettledResult<number>) =>
    result.status === "fulfilled"
      ? `${name} ${result.value}`
      : `${name} FAILED (${(result.reason as Error).message})`;

  return `pruned older than ${days}d — ${describe("agent_run_events", runEvents)}, ${describe("pod_log_chunks", podLogs)}`;
}
