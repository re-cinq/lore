// Display vocabulary for a single assembly-line node inside a run.
//
// Two axes, deliberately kept apart. `status` (NodeRunStatus) is the node's
// EXECUTION state, driven by the agent event stream: did the pod start, and did
// its process exit cleanly. `outcome` is the node's recorded VERDICT from the
// walk row (success / changes_requested / failed / <kind>-failed) — what the node
// concluded and what routed the edge. A review pod exits 0 while its verdict is
// "failed", so the two disagree; the badge must trust the verdict, never the exit
// code, or a failed review renders green.

import type { NodeRunStatus } from "./run-event-reducer";

export type NodeStatusTone = "idle" | "running" | "ok" | "warn" | "err";

export interface NodeStatusVisual {
  tone: NodeStatusTone;
  label: string;
}

const VISUALS: Record<NodeRunStatus, NodeStatusVisual> = {
  idle: { tone: "idle", label: "Pending" },
  running: { tone: "running", label: "Running" },
  succeeded: { tone: "ok", label: "Succeeded" },
  failed: { tone: "err", label: "Failed" },
};

/** Tone and label for a node's execution status. Exhaustive by construction. */
export function nodeStatusVisual(status: NodeRunStatus): NodeStatusVisual {
  return VISUALS[status];
}

/** Tone and label for a recorded verdict (or an edge condition). A `<kind>-failed`
 *  infrastructure failure and a plain `failed` verdict both read as Failed. */
export function outcomeVisual(outcome: string): NodeStatusVisual {
  if (outcome.includes("failed")) {
    return { tone: "err", label: "Failed" };
  }

  if (outcome === "changes_requested") {
    return { tone: "warn", label: "Changes requested" };
  }

  return { tone: "ok", label: "Succeeded" };
}

/** The terminal's badge from the run's final result token. */
export function resultVisual(result: string): NodeStatusVisual {
  return result.includes("failed")
    ? { tone: "err", label: "Failed" }
    : { tone: "ok", label: "Completed" };
}

/** The node badge: the recorded verdict when the node has one (authoritative),
 *  otherwise its execution status (Pending while idle, Running in flight). This is
 *  what keeps a failed-verdict node from rendering as its clean process exit. */
export function nodeRunVisual(
  outcome: string | null,
  status: NodeRunStatus,
): NodeStatusVisual {
  return outcome === null ? VISUALS[status] : outcomeVisual(outcome);
}
