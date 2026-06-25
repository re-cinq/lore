// The two-gate execution-backend router (ADR-031). A task runs on the new
// ai-agent-subsystem `Agent` path only when BOTH gates are on — the cluster env
// (`LORE_AGENT_CR_BACKEND_ENABLED`) AND the per-repo `settings.execution.backend`
// — mirroring the dark-factory two-gate. A graded percentage rollout (keyed on a
// stable hash of the task id) is applied on top (wired by the cutover, #688).
// Default: the legacy LoreTask path. Pure + deterministic.

export type ExecutionBackend = "agent-cr" | "loretask";

/** Stable 0–99 bucket for a task id (djb2), for percentage rollout. */
export function bucketFor(taskId: string): number {
  let hash = 5381;
  for (let i = 0; i < taskId.length; i++) {
    hash = ((hash << 5) + hash + taskId.charCodeAt(i)) >>> 0;
  }
  return hash % 100;
}

export function decideExecutionBackend(args: {
  /** Per-repo `settings.execution.backend`. */
  repoBackend?: string;
  /** Cluster gate: `LORE_AGENT_CR_BACKEND_ENABLED === "true"`. */
  clusterEnabled: boolean;
  /** Graded rollout 0–100 (#688). Omit to route every eligible task. */
  percent?: number;
  taskId?: string;
}): ExecutionBackend {
  if (!args.clusterEnabled) return "loretask";
  if (args.repoBackend !== "agent-cr") return "loretask";
  if (args.percent !== undefined && args.taskId !== undefined) {
    if (bucketFor(args.taskId) >= args.percent) return "loretask";
  }
  return "agent-cr";
}
