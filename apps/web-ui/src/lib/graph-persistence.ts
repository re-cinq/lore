/**
 * Pure, deterministic graph-state persistence for the D3 spec-graph view.
 * `captureGraphState` snapshots every node's resting position (preferring its
 * pinned/fixed coords over the drifting simulation coords), whether it is
 * pinned, and which specs are expanded — enough to restore the previous
 * topology on reload. `applyGraphState` replays that snapshot back onto live
 * simulation nodes, and `serializeGraphState` / `parseGraphState` carry it to
 * and from a JSON string. Value-in/value-out, no side effects: the localStorage
 * read/write that persists this snapshot lives at the component edge, not here.
 */

/** A node's captured resting position plus whether the user has pinned it. */
export type NodePosition = {
  x: number;
  y: number;
  pinned: boolean;
};

/** A node as the D3 simulation holds it: an id, drifting `x`/`y` coords, and
 * optional fixed `fx`/`fy` coords set when the user pins it. Structural so any
 * simulation node (e.g. the component's `SimNode`) satisfies it. */
export type PositionedNode = {
  id: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
};

/** A restorable snapshot of the graph: a version tag, every node's position
 * keyed by id, and the ids of the currently expanded specs. */
export type GraphState = {
  version: number;
  positions: Record<string, NodePosition>;
  expanded: string[];
};

/** The schema version stamped on every captured snapshot, so `parseGraphState`
 * can reject older or mismatched shapes. */
export const STATE_VERSION = 1;

/**
 * The restorable snapshot of `nodes` and `expandedIds`. Each node's position
 * prefers its fixed `fx`/`fy` (the pinned location) over the drifting `x`/`y`,
 * falling back to 0, and is marked `pinned` when either fixed coord is set.
 * `expandedIds` is copied so the snapshot does not alias the caller's array.
 */
export function captureGraphState(
  nodes: PositionedNode[],
  expandedIds: string[],
): GraphState {
  const positions: Record<string, NodePosition> = {};

  for (const node of nodes) {
    positions[node.id] = {
      x: node.fx ?? node.x ?? 0,
      y: node.fy ?? node.y ?? 0,
      pinned: node.fx != null || node.fy != null,
    };
  }

  return {
    version: STATE_VERSION,
    positions,
    expanded: [...expandedIds],
  };
}

/**
 * Restores `nodes` to the positions captured in `state`, mutating each node in
 * place. A node is moved only when `state.positions` holds an entry for its id;
 * nodes with no saved entry are left untouched.
 */
export function applyGraphState(
  state: GraphState,
  nodes: PositionedNode[],
): void {
  for (const node of nodes) {
    const saved = state.positions[node.id];

    if (saved) {
      node.x = saved.x;
      node.y = saved.y;

      if (saved.pinned) {
        node.fx = saved.x;
        node.fy = saved.y;
      }
    }
  }
}

/** Serializes a captured `state` to a JSON string for persistence. */
export function serializeGraphState(state: GraphState): string {
  return JSON.stringify(state);
}

/** True when `value` is a non-null object stamped with the current
 * `STATE_VERSION` — the gate `parseGraphState` uses to accept a parsed blob. */
function isGraphState(value: unknown): value is GraphState {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === STATE_VERSION
  );
}

/**
 * Parses a JSON string back into a `GraphState`, returning `null` for `null`
 * input, corrupt (non-JSON) text, and any blob that is not an object stamped
 * with the current `STATE_VERSION` (e.g. a snapshot from an older schema).
 */
export function parseGraphState(raw: string | null): GraphState | null {
  try {
    const parsed: unknown = JSON.parse(raw as string);

    return isGraphState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
