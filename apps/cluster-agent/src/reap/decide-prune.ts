// What a cluster may forget (FR4, specs/running-stations-in-any-k8s-cluster) — a run leaves an Agent CR + per-task pt-* clones that nothing deleted (176 CRs OOMKilled the controller on 2026-08-30). Pure: the caller lists and deletes, this decides.

/** The `pt-` prefix marks a clone minted for ONE task; `def-*` and named builtin recipes are catalog, never candidates. */
const PER_TASK_PREFIX = "pt-";

export interface PrunableAgent {
  name: string;
  /** `Succeeded` / `Failed` once terminal; absent while the controller has not stamped it (what a crashlooping controller leaves). */
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
  /** How long a terminal run's evidence is kept — generous, since run 129235d4 was diagnosed two days later from `.status.output` alone. */
  ttlMs: number;
  /** Ceiling per tick, so a first sweep over a backlog cannot storm the apiserver. */
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

  // What SURVIVES this tick is what may still be run from — #1613 showed the reverse: a run whose recipe went missing died in one second.
  const doomed = new Set(agents);
  const stillReferenced = new Set(
    input.agents
      .filter((candidate) => !doomed.has(candidate.name))
      .map((candidate) => candidate.stationRef)
      .filter((ref): ref is string => ref !== undefined),
  );

  const orphaned = (recipe: PrunableRecipe): boolean =>
    recipe.name.startsWith(PER_TASK_PREFIX) &&
    // The clone is written BEFORE the CR that names it, so "nothing references it" is briefly true mid-dispatch — the age gate closes that window.
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
