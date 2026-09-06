// The retention reap for the two high-volume telemetry tables — agent_run_events.pruneOld existed since ADR-037 with NO CALLER (nothing was ever pruned); pod_log_chunks ships with the reap wired from day one to avoid repeating that.

export const RETENTION_DAYS = 14;

export interface PrunableStore {
  pruneOld(olderThanDays: number): Promise<number>;
}

export interface RetentionDeps {
  runEvents: PrunableStore;
  podLogs: PrunableStore;
  days?: number;
}

// Prune both, and say what went; each store is pruned independently — one failing must not leave the other unpruned.
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
