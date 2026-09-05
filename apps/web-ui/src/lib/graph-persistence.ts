// Pure, deterministic graph-state persistence for D3 spec-graph view.

/** A node's captured resting position plus whether the user has pinned it. */
export type NodePosition = {
  x: number;
  y: number;
  pinned: boolean;
};

/** D3 simulation node: id, drifting x/y, optional fixed fx/fy when pinned. */
export type PositionedNode = {
  id: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
};

/** Restorable graph snapshot: version, positions, expanded specs. */
export type GraphState = {
  version: number;
  positions: Record<string, NodePosition | undefined>;
  expanded: string[];
};

/** Schema version stamped on every captured snapshot. */
export const STATE_VERSION = 1;

function nodePosition(node: PositionedNode): NodePosition {
  return {
    x: node.fx ?? node.x ?? 0,
    y: node.fy ?? node.y ?? 0,
    pinned: node.fx != null || node.fy != null,
  };
}

/** Snapshot nodes and expandedIds; prefer fixed coords when pinned. */
export function captureGraphState(
  nodes: PositionedNode[],
  expandedIds: string[],
): GraphState {
  const positions: Record<string, NodePosition> = {};

  for (const node of nodes) {
    positions[node.id] = nodePosition(node);
  }

  return {
    version: STATE_VERSION,
    positions,
    expanded: [...expandedIds],
  };
}

/** Restore nodes to positions captured in state; mutate in place. */
export function applyGraphState(
  state: GraphState,
  nodes: PositionedNode[],
): void {
  nodes.forEach((node) => {
    const saved = state.positions[node.id];

    if (!saved) {
      return;
    }
    node.x = saved.x;
    node.y = saved.y;

    if (saved.pinned) {
      node.fx = saved.x;
      node.fy = saved.y;
    }
  });
}

/** Serializes a captured `state` to a JSON string for persistence. */
export function serializeGraphState(state: GraphState): string {
  return JSON.stringify(state);
}

/** True when value is stamped with current STATE_VERSION. */
function isGraphState(value: unknown): value is GraphState {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === STATE_VERSION
  );
}

/** Parse JSON string back into GraphState or null on corrupt/version mismatch. */
export function parseGraphState(raw: string | null): GraphState | null {
  try {
    const parsed: unknown = JSON.parse(raw as string);

    return isGraphState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
