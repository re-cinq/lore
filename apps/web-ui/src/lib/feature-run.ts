// Assembly-line run for a feature, shaped for planning wizard poll payload; server resolves which run by feature subject key.

import type { AssemblyLineDefinition } from "./assembly-line-definition";
import {
  fetchAssemblyRun,
  fetchAssemblyRunNodes,
  fetchRunTokens,
  type AssemblyRun,
  type AssemblyRunNode,
} from "./assembly-runs";
import { definitionForRun } from "./run-graph-definition";
import type { RunTokens } from "./run-tokens";
import { graphIsCacheable } from "./run-graph-cache";

/** Exactly the props RunVisualizationPanel needs, serialized over the poll route. */
export interface FeatureRunPayload {
  id: string;
  status: string;
  startedAt: string | null;
  repo: string;
  reason: string | null;
  definition: AssemblyLineDefinition | null;
  /** True when the graph was inferred from visit rows — the caller hides edge labels. */
  synthetic: boolean;
  nodes: AssemblyRunNode[];
  /** Run's token cost so far, or null if unreported. */
  tokens: RunTokens | null;
  /** True when definition omitted because client already holds this run's graph. */
  definitionUnchanged?: boolean;
}

/** Shape run + nodes into poll payload; pure. */
export function toFeatureRunPayload(
  run: AssemblyRun,
  nodes: AssemblyRunNode[],
  tokens: RunTokens | null = null,
): FeatureRunPayload {
  const { definition, synthetic } = definitionForRun(
    run.blueprintName,
    nodes,
    run.graph,
  );

  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    repo: run.repo,
    reason: run.reason,
    definition,
    synthetic,
    nodes,
    tokens,
  };
}

/** Fetch run to visualize by line id (resolved by lore-api). */
export async function fetchFeatureRunById(
  assemblyLineId: string | null | undefined,
  /** Run whose graph caller already holds (avoid re-shipping clone). */
  haveGraphForRun?: string | null,
): Promise<FeatureRunPayload | null> {
  if (!assemblyLineId) {
    return null;
  }

  try {
    const run = await fetchAssemblyRun(assemblyLineId);

    if (!run) {
      return null;
    }

    const payload = toFeatureRunPayload(
      run,
      await fetchAssemblyRunNodes(run.id),
      await fetchRunTokens(run.id),
    );

    // Omit graph caller already has (not for synthetic graphs).
    return haveGraphForRun === run.id && graphIsCacheable(payload)
      ? { ...payload, definition: null, definitionUnchanged: true }
      : payload;
  } catch {
    return null;
  }
}
