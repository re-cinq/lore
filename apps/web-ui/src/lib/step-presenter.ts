// Turns the walk rows into an execution-ordered step list — what ran, in what
// order, the branch each step took, and why a step is in its state. Pure, so the
// ordering and transition rules stay unit-testable away from the DB and React.

import type { AssemblyLineDefinition } from "./assembly-line-definition";
import type { AssemblyRunNode } from "./assembly-runs";
import { layerByLongestPath } from "./dag-layout";
import { chosenEdge } from "./run-taken-edges";

export type StepTone = "ok" | "warn" | "err" | "running" | "idle";

export interface StepView {
  nodeId: string;
  iteration: number;
  tone: StepTone;
  label: string;
  outcome: string | null;
  agentCrName: string | null;
  commitSha: string | null;
  durationSeconds: number | null;
  /** The branch this step took, e.g. `success → validate` or `failed ↩ implement`. */
  transition: string | null;
  /** Run-level reason surfaced against the step that produced the failure. */
  reason: string | null;
}

const TONES: { tone: StepTone; label: string }[] = [
  { tone: "ok", label: "Succeeded" },
  { tone: "warn", label: "Changes requested" },
  { tone: "err", label: "Failed" },
];

function toneOf(outcome: string | null): { tone: StepTone; label: string } {
  if (outcome === null) {
    return { tone: "running", label: "Running" };
  }

  if (outcome === "success") {
    return TONES[0];
  }

  if (outcome === "changes_requested") {
    return TONES[1];
  }

  return outcome.includes("failed")
    ? TONES[2]
    : { tone: "idle", label: outcome };
}

function transitionOf(
  definition: AssemblyLineDefinition | null,
  layers: Map<string, number>,
  node: AssemblyRunNode,
): string | null {
  const edge = chosenEdge(definition, node.nodeId, node.outcome);

  if (!edge) {
    return null;
  }

  const loops = (layers.get(edge.to) ?? 0) <= (layers.get(edge.from) ?? 0);

  return `${edge.on} ${loops ? "↩" : "→"} ${edge.to}`;
}

/**
 * The steps in execution order (nodes arrive `ORDER BY id`). Each carries its
 * state, the branch it took, and — for a failing step — the run's reason.
 */
export function stepViews(
  definition: AssemblyLineDefinition | null,
  nodes: readonly AssemblyRunNode[],
  runReason: string | null = null,
): StepView[] {
  const layers = definition
    ? layerByLongestPath(definition)
    : new Map<string, number>();

  return nodes.map((node) => {
    const { tone, label } = toneOf(node.outcome);

    return {
      nodeId: node.nodeId,
      iteration: node.iteration,
      tone,
      label,
      outcome: node.outcome,
      agentCrName: node.agentCrName,
      commitSha: node.commitSha,
      durationSeconds: node.durationSeconds,
      transition: transitionOf(definition, layers, node),
      reason: tone === "err" ? runReason : null,
    };
  });
}
