// The files an agent node's pod downloads before its agent starts, as references relative to an agent-files endpoint — never content, so an input of any size never rides the Agent object. The executing cluster prefixes its own endpoint, since only it knows an address its pods can reach.

import type { LoreTaskSpec } from "@re-cinq/lore-shared";

/** One file a recipe declares: where the pod writes it, and what the Floor serves for it. */
export interface RecipeInput {
  path: string;
  source: string;
}

export type InputFiles = NonNullable<LoreTaskSpec["files"]>;

/** A run's inputs keyed by its assembly run, since the Floor resolves what a source means (e.g. `plan` → the run's plan) at the moment the pod asks. */
export function inputFilesFor(
  inputs: readonly RecipeInput[] | undefined,
  assemblyLineId: string,
): InputFiles {
  return (inputs ?? []).map(({ path, source }) => ({
    path,
    ref: `runs/${assemblyLineId}/${source}`,
  }));
}
