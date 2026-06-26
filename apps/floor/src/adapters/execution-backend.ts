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

/**
 * The cutover routing decision for one task (#688): reads the cluster gate +
 * graded-rollout percentage from the env and the per-repo backend setting, then defers
 * to {@link decideExecutionBackend}. `LORE_AGENT_CR_BACKEND_PERCENT` is honored only when
 * it parses to a finite number; an unset/garbage value routes every eligible task.
 */
export function executionBackendForTask(args: {
  repoBackend?: string;
  taskId: string;
  env: NodeJS.ProcessEnv;
}): ExecutionBackend {
  const raw = args.env.LORE_AGENT_CR_BACKEND_PERCENT;
  const parsed = Number(raw);
  const percent = raw !== undefined && Number.isFinite(parsed) ? parsed : undefined;
  return decideExecutionBackend({
    repoBackend: args.repoBackend,
    clusterEnabled: args.env.LORE_AGENT_CR_BACKEND_ENABLED === "true",
    ...(percent !== undefined ? { percent } : {}),
    taskId: args.taskId,
  });
}

/** The per-repo opt-in: `settings.dark_factory.execution.backend` from the repo's raw
 *  settings JSON. Undefined (not set / malformed) keeps the repo on the legacy path. */
export function repoBackendFromSettings(settings: unknown): string | undefined {
  if (typeof settings !== "object" || settings === null) return undefined;
  const execution = (settings as { dark_factory?: { execution?: { backend?: unknown } } })
    .dark_factory?.execution;
  return typeof execution?.backend === "string" ? execution.backend : undefined;
}
