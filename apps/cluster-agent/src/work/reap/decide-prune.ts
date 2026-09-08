import type { PrunableAgent, PrunableRecipe } from "../../domain/prunable.js";

export type { PrunableAgent, PrunableRecipe };

// What a cluster may forget (FR4, specs/running-stations-in-any-k8s-cluster) — a run leaves an Agent CR + per-task pt-* clones that nothing deleted (176 CRs OOMKilled the controller on 2026-08-30). Pure: the caller lists and deletes, this decides.

/** The `pt-` prefix marks a clone minted for ONE task; `def-*` and named builtin recipes are catalog, never candidates. */
const PER_TASK_PREFIX = "pt-";

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

/** Whether a per-task recipe can go. Keyed on what SURVIVES this tick, not on what is being deleted — #1613 was the reverse, and a run whose recipe went missing died in one second. The age gate closes a second window: a clone is written BEFORE the CR that names it, so "nothing references it" is briefly true mid-dispatch. */
function orphanTest(
  input: PruneInput,
  doomedAgents: string[],
  expired: (createdAt: Date) => boolean,
): (recipe: PrunableRecipe) => boolean {
  const doomed = new Set(doomedAgents);
  const stillReferenced = new Set(
    input.agents
      .filter((candidate) => !doomed.has(candidate.name))
      .map((candidate) => candidate.stationRef)
      .filter((ref): ref is string => ref !== undefined),
  );

  return (recipe) =>
    recipe.name.startsWith(PER_TASK_PREFIX) &&
    expired(recipe.createdAt) &&
    !stillReferenced.has(recipe.name);
}

// The orphaned recipes to remove this tick, capped. Bounded per tick rather than swept whole: a large backlog is cleared over several ticks, so one sweep cannot spend its budget deleting and starve the claim loop beside it.
function prunableNames(
  recipes: PrunableRecipe[],
  orphaned: (recipe: PrunableRecipe) => boolean,
  maxPerTick: number,
): string[] {
  return recipes
    .filter(orphaned)
    .slice(0, maxPerTick)
    .map((recipe) => recipe.name);
}

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
  const orphaned = orphanTest(input, agents, expired);

  return {
    agents,
    stations: prunableNames(input.stations, orphaned, input.maxPerTick),
    definitions: prunableNames(input.definitions, orphaned, input.maxPerTick),
  };
}
