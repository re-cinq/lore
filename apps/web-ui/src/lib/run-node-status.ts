// Display vocabulary: status = execution state (pod start/exit); outcome = walk verdict (success/changes/failed); badge trusts verdict, not exit code.

import type { NodeRunStatus } from "./run-event-reducer";
import { humanStation } from "./human-station";

export type NodeStatusTone =
  "idle" | "running" | "waiting" | "ok" | "warn" | "err";

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

/** Tone and label for recorded verdict; <kind>-failed infrastructure failures and plain failures both read as Failed. */
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

/** Node badge: recorded verdict (authoritative) or execution status; human stations are open but parked (no pod exists). */
export function nodeRunVisual(
  outcome: string | null,
  status: NodeRunStatus,
  nodeType?: string,
): NodeStatusVisual {
  if (outcome !== null) {
    return outcomeVisual(outcome);
  }

  // Only reached human stations are parked; unvisited ones are still Pending.
  const humanLabel = humanStation(nodeType)?.label;

  return humanLabel && status === "running"
    ? { tone: "waiting", label: humanLabel }
    : VISUALS[status];
}
