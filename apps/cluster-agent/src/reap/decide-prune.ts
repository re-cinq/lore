/**
 * What a cluster may forget (FR4 of specs/running-stations-in-any-k8s-cluster).
 *
 * A run leaves three objects behind — the Agent CR and the per-task `pt-*`
 * AgentDefinition and Station it ran on — and nothing deleted any of them. The
 * controller's informer caches every one: 176 Agent CRs, each carrying up to
 * `maxOutputBytes` (256KiB) of run output, measured 40MiB of raw JSON and
 * OOMKilled the controller every nine minutes (2026-08-30). The Station's
 * `successfulRunsHistoryLimit` cannot bound it, because that limit is per
 * Station and Lore mints a Station per task: the denominator grows with the
 * numerator.
 *
 * This lives in the cluster-agent because the Floor cannot reach a satellite's
 * cluster (#1651) — a Floor-side reaper would tidy central and let every
 * satellite rot. The cluster-agent already creates exactly these objects and
 * already reclaims the per-task token beside them.
 *
 * Pure: the caller lists and deletes, this decides.
 */

/** The `pt-` prefix marks a clone minted for ONE task. `def-*` and the named
 *  builtin recipes are catalog, not litter, and are never candidates. */
const PER_TASK_PREFIX = "pt-";

export interface PrunableAgent {
  name: string;
  /** `Succeeded` / `Failed` once terminal; absent while the controller has not
   *  stamped it — which is exactly what a crashlooping controller leaves. */
  phase?: string;
  createdAt: Date;
  /** The Station the run named, which is the clone it would orphan. */
  stationRef?: string;
}

export interface PrunableRecipe {
  name: string;
  createdAt: Date;
}

export interface PruneInput {
  agents: PrunableAgent[];
  stations: PrunableRecipe[];
  definitions: PrunableRecipe[];
  now: Date;
  /** How long a terminal run's evidence is kept. Generous on purpose: run
   *  129235d4 was diagnosed two days later from `.status.output` alone, after
   *  its pod logs and telemetry were gone. */
  ttlMs: number;
  /** Ceiling per tick, so a first sweep over a backlog cannot storm the
   *  apiserver and a bug cannot cascade. */
  maxPerTick: number;
}

export interface PrunePlan {
  agents: string[];
  stations: string[];
  definitions: string[];
}

const isTerminal = (phase?: string): boolean =>
  phase === "Succeeded" || phase === "Failed";

export function decidePrune(input: PruneInput): PrunePlan {
  const expired = (createdAt: Date): boolean =>
    input.now.getTime() - createdAt.getTime() > input.ttlMs;

  const agents = input.agents
    .filter(
      (candidate) =>
        isTerminal(candidate.phase) && expired(candidate.createdAt),
    )
    .slice(0, input.maxPerTick)
    .map((candidate) => candidate.name);

  // What SURVIVES this tick is what may still be run from. A clone referenced
  // by any remaining CR stays: #1613's residual damage showed the other way
  // round — a run whose recipe had gone missing died in one second.
  const doomed = new Set(agents);
  const stillReferenced = new Set(
    input.agents
      .filter((candidate) => !doomed.has(candidate.name))
      .map((candidate) => candidate.stationRef)
      .filter((ref): ref is string => ref !== undefined),
  );

  const orphaned = (recipe: PrunableRecipe): boolean =>
    recipe.name.startsWith(PER_TASK_PREFIX) &&
    // The clone is written BEFORE the CR that names it, so "nothing references
    // it" is briefly true of a task mid-dispatch. The age gate is what closes
    // that window.
    expired(recipe.createdAt) &&
    !stillReferenced.has(recipe.name);

  return {
    agents,
    stations: input.stations
      .filter(orphaned)
      .slice(0, input.maxPerTick)
      .map((recipe) => recipe.name),
    definitions: input.definitions
      .filter(orphaned)
      .slice(0, input.maxPerTick)
      .map((recipe) => recipe.name),
  };
}
