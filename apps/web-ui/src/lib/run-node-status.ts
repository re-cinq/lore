// Display vocabulary for a single assembly-line node inside a run.
//
// NodeStatusTone is deliberately NOT assembly-line-presenter's StatusTone: that
// one describes a whole run in six tones (success/danger/warning/info/running/
// muted), while a node inside a run has exactly the four states the reducer can
// produce. Collapsing them would let a node claim a tone no node can reach.

import type { NodeRunStatus } from "./run-event-reducer";

export type NodeStatusTone = "idle" | "running" | "ok" | "err";

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

/** Tone and label for a node status. Exhaustive by construction. */
export function nodeStatusVisual(status: NodeRunStatus): NodeStatusVisual {
  return VISUALS[status];
}
