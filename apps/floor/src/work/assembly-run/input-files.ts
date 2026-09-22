// The files an agent node's pod downloads before its agent starts, as references to the Floor's agent-files endpoint — never content, so an input of any size never rides the Agent object.

import type { LoreTaskSpec } from "@re-cinq/lore-shared";

/** One file a recipe declares: where the pod writes it, and what the Floor serves for it. */
export interface RecipeInput {
  path: string;
  source: string;
}

export type InputFiles = NonNullable<LoreTaskSpec["files"]>;

/** The credential a pod already holds for its event sink; the same key authenticates its downloads. */
const AGENT_FILES_SECRET = "agent-events-auth";

/** A run's inputs keyed by its assembly run, since the Floor resolves what a source means (e.g. `plan` → the run's plan) at the moment the pod asks. No endpoint on this Floor: nothing to download. */
export function inputFilesFor(
  inputs: readonly RecipeInput[] | undefined,
  assemblyLineId: string,
  agentFilesUrl: string | undefined,
): InputFiles {
  if (!agentFilesUrl) {
    return [];
  }

  return (inputs ?? []).map(({ path, source }) => ({
    path,
    url: `${agentFilesUrl}/runs/${assemblyLineId}/${source}`,
    headersSecret: AGENT_FILES_SECRET,
  }));
}
