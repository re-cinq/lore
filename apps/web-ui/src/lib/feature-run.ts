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
  fetchAssemblyLineRunNodes,
  fetchLatestRunForTask,
  type AssemblyLineRun,
  type AssemblyLineRunNode,
} from "./assembly-line-runs";
import { definitionForRun } from "./run-graph-definition";

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
}

/** Shape a run + its visit rows into the poll payload, resolving the graph to draw.
 *  Pure — definitionForRun does no IO. */
export function toFeatureRunPayload(
  run: AssemblyLineRun,
  nodes: AssemblyLineRunNode[],
): FeatureRunPayload {
  const { definition, synthetic } = definitionForRun(run.definitionName, nodes);

  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    repo: run.repo,
    reason: run.reason,
    definition,
    synthetic,
    nodes,
  };
}

/** The run to visualize for a planning round, or null when the round has no task
 *  yet, no run row yet (pre-0025 DBs included), or the lookup fails. Never throws:
 *  the wizard's poll must keep reporting the round's status even when run
 *  visualization is unavailable. */
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

    return toFeatureRunPayload(run, await fetchAssemblyLineRunNodes(run.id));
  } catch {
    return null;
  }
}

/** The nodes that run AFTER the author accepts. Planning rounds are `analyze`; these
 *  are the spec work the accept starts on the same line (FR6.26). */
const SPEC_NODES = new Set(["analyse-specs", "write", "push"]);

export interface SpecPhase {
  running: boolean;
  /** When the working node started — what an elapsed timer must count from. */
  since?: string;
}

/**
 * Whether the spec work is in flight, read from the LINE rather than from whether
 * the author recently pressed a button.
 *
 * A local flag could only be cleared by the feature leaving the planning phase, so a
 * line that finished without producing a PR left "Writing the spec…" on screen
 * indefinitely — timed, worse, from the last ROUND's creation, which read as 80+
 * minutes of a 15 minute budget while nothing was running at all.
 */
export function specPhaseOf(
  run: { status: string; nodes: AssemblyLineRunNode[] } | null | undefined,
): SpecPhase {
  if (!run || run.status !== "running") {
    return { running: false };
  }
  const open = run.nodes.filter((node) => node.outcome === null);
  const working = open[open.length - 1];

  return working && SPEC_NODES.has(working.nodeId)
    ? { running: true, since: working.startedAt }
    : { running: false };
}
