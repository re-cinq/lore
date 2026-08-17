// The assembly-line run behind a feature-planning round, shaped for the planning
// wizard's poll payload. A planning round is a task, and that task's newest
// assembly line is what the running card visualizes — so the wizard can watch the
// analyze node work instead of staring at a spinner.
//
// The definition is resolved here (server-side, no IO) rather than in the client:
// definitionForRun is pure, and a round that has not recorded a node row yet still
// needs a graph to draw, which only the declared builtin can supply.

import type { AssemblyLineDefinition } from "./assembly-line-definition";
import {
  fetchAssemblyLineRun,
  fetchAssemblyLineRunNodes,
  fetchLatestRunForTask,
  fetchRunTokens,
  type AssemblyLineRun,
  type AssemblyLineRunNode,
} from "./assembly-line-runs";
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
  nodes: AssemblyLineRunNode[];
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
  run: AssemblyLineRun,
  nodes: AssemblyLineRunNode[],
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

/**
 * Which task's assembly line the wizard should draw. Pure.
 *
 * Two eras have to work at once. A LEGACY feature mints a task per round, and that
 * round's own line is the one to show — so the round's own task wins whenever it
 * has one. On the MERGED line a refine is a resume: the API answers
 * `task_id: null` and nothing attaches one, so from round 2 onward the latest round
 * names no task, `fetchFeatureRun` was handed null, and the run graph silently
 * vanished for the rest of the feature's life.
 *
 * The fallback is the line's OWNING task — the earliest round that named one, which
 * is how `resolveDispatch` in lore-api finds the same line. An empty string is
 * treated as absent: it is not a task id, and passing it on would resolve nothing
 * while hiding the real owner.
 */
export function runTaskIdFor(input: {
  latestIterationTaskId?: string | null;
  owningTaskId?: string | null;
}): string | null {
  return input.latestIterationTaskId || input.owningTaskId || null;
}

/** The run to visualize for a planning round, or null when the round has no task
 *  yet, no run row yet (pre-0025 DBs included), or the lookup fails. Never throws:
 *  the wizard's poll must keep reporting the round's status even when run
 *  visualization is unavailable. */
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
    const run = await fetchAssemblyLineRun(assemblyLineId);

    if (!run) {
      return null;
    }

    const payload = toFeatureRunPayload(
      run,
      await fetchAssemblyLineRunNodes(run.id),
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

export async function fetchFeatureRun(
  taskId: string | null | undefined,
): Promise<FeatureRunPayload | null> {
  if (!taskId) {
    return null;
  }

  try {
    const run = await fetchLatestRunForTask(taskId);

    if (!run) {
      return null;
    }

    return toFeatureRunPayload(
      run,
      await fetchAssemblyLineRunNodes(run.id),
      await fetchRunTokens(run.id),
    );
  } catch {
    return null;
  }
}
