// The assembly-line run behind a feature, shaped for the planning wizard's poll
// payload, so the wizard can watch the working node instead of staring at a
// spinner.
//
// WHICH run that is comes from the server, which resolves it by the feature's
// subject key. It used to be resolved here from a task id, which could only ever
// find a run some task had started for that round — a finalize run is a different
// task on a different blueprint, so pressing "Create spec PR" started work this
// module had no way to name.
//
// The definition is resolved here (server-side, no IO) rather than in the client:
// definitionForRun is pure, and a round that has not recorded a node row yet still
// needs a graph to draw, which only the declared builtin can supply.

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
  /** What the run has spent so far, or null when it has reported nothing yet. */
  tokens: RunTokens | null;
  /**
   * Set when `definition` was OMITTED because the client said it already holds
   * this run's graph — not because the run has none. The two are different
   * answers and a client that conflated them would blank the graph every tick.
   */
  definitionUnchanged?: boolean;
}

/** Shape a run + its visit rows into the poll payload, resolving the graph to draw.
 *  Pure — definitionForRun does no IO. */
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

/** The run to visualize, given the line id lore-api already resolved for the
 *  round. Preferred over `fetchFeatureRun`: from round 2 a resumed round mints no
 *  task, so only the server — which knows the OWNING task — can name the line.
 *  Never throws; the wizard's poll must keep reporting the round's status even
 *  when run visualization is unavailable. */
export async function fetchFeatureRunById(
  assemblyLineId: string | null | undefined,
  /** The run whose graph the caller already holds, if any — see
   *  {@link graphIsCacheable}. Naming the RUN (not just "yes") is what keeps a
   *  retry's new clone from being mistaken for the one already on screen. */
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

    // Omit the graph the caller already has. Only for THIS run, and never for a
    // synthetic graph, which changes as visit rows land.
    return haveGraphForRun === run.id && graphIsCacheable(payload)
      ? { ...payload, definition: null, definitionUnchanged: true }
      : payload;
  } catch {
    return null;
  }
}
