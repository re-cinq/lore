// The node_status/run_status fold shared by every page that follows a run's stream in place (run-live-reducer.ts, plan-run-live-reducer.ts).
import { toAssemblyRunNode, type AssemblyRunNode } from "./assembly-run-rows";
import type {
  RunStreamFrame,
  NodeStatusFrame,
  RunStatusFrame,
} from "./run-stream-types";

/** One APPLY branch, narrowed to `type`'s frame shape; any other frame passes `state` through untouched. */
export function ifFrame<T extends RunStreamFrame["type"], S>(
  type: T,
  apply: (state: S, frame: Extract<RunStreamFrame, { type: T }>) => S,
): (state: S, frame: RunStreamFrame) => S {
  return (state, frame) =>
    frame.type === type
      ? apply(state, frame as Extract<RunStreamFrame, { type: T }>)
      : state;
}

/** Replaces the element `matches` picks out, or appends when none does — visit order is arrival order. */
export function upsertBy<T>(
  rows: T[],
  next: T,
  matches: (row: T) => boolean,
): T[] {
  const index = rows.findIndex(matches);

  if (index === -1) {
    return [...rows, next];
  }

  return rows.map((row, at) => (at === index ? next : row));
}

/** Replaces a node_status frame's visit in place by `(nodeId, iteration)`. */
export function foldNodeStatus(
  nodes: readonly AssemblyRunNode[],
  frame: NodeStatusFrame,
): AssemblyRunNode[] {
  const node = toAssemblyRunNode(frame.node);

  return upsertBy(
    [...nodes],
    node,
    (row) => row.nodeId === node.nodeId && row.iteration === node.iteration,
  );
}

/** The `node_status` APPLY branch every state shaped `{ nodes }` shares verbatim. */
export function nodeStatusBranch<S extends { nodes: AssemblyRunNode[] }>(): (
  state: S,
  frame: RunStreamFrame,
) => S {
  return ifFrame(
    "node_status",
    (state, frame) =>
      ({ ...state, nodes: foldNodeStatus(state.nodes, frame) }) as S,
  );
}

export interface RunStatusFacts {
  status: string;
  outcome: string | null;
  reason: string | null;
}

/** A run_status frame's own facts, with no `startedAt`/`finishedAt` reconstruction — that is `run-live-reducer`'s business. */
export function runStatusFacts(frame: RunStatusFrame): RunStatusFacts {
  const { status, outcome, reason } = frame.run;

  return { status, outcome, reason };
}
