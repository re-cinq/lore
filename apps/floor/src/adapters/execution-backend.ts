// The two-gate execution-backend router (ADR-031). A task runs on the new
// ai-agent-subsystem `Agent` path only when BOTH gates are on — the cluster env
// (`LORE_AGENT_CR_BACKEND_ENABLED`) AND the per-repo `settings.execution.backend`
// — mirroring the dark-factory two-gate. It is a binary on/off per repo: both
// gates on → agent-cr, otherwise the legacy LoreTask path. Pure + deterministic.

export type ExecutionBackend = "agent-cr" | "loretask";

export function decideExecutionBackend(args: {
  /** Per-repo `settings.execution.backend`. */
  repoBackend?: string;
  /** Cluster gate: `LORE_AGENT_CR_BACKEND_ENABLED === "true"`. */
  clusterEnabled: boolean;
}): ExecutionBackend {
  if (!args.clusterEnabled) return "loretask";
  if (args.repoBackend !== "agent-cr") return "loretask";
  return "agent-cr";
}

/**
 * The cutover routing decision (#688): reads the cluster gate from the env and the
 * per-repo backend setting, then defers to {@link decideExecutionBackend}.
 */
export function executionBackendForTask(args: {
  repoBackend?: string;
  env: NodeJS.ProcessEnv;
}): ExecutionBackend {
  return decideExecutionBackend({
    repoBackend: args.repoBackend,
    clusterEnabled: args.env.LORE_AGENT_CR_BACKEND_ENABLED === "true",
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
