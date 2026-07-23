// The single state machine the live stream and the replay view share: a pure
// (state, event) => state fold, seeded from the persisted per-node walk rows and
// advanced by the agent event stream.
//
// Per-event work is bounded by the node count and TRANSCRIPT_CAP, both fixed, so
// a long run costs the same per event as a short one (spec FR4.6). The state
// objects of untouched nodes are carried over by reference rather than rebuilt,
// which is what keeps that true.

import type { AssemblyLineDefinition } from "./assembly-line-definition";
import type { AssemblyLineRunNode } from "./assembly-line-runs";
import type { AgentRunEventType, RunStreamEvent } from "./run-stream-types";
import { touchKind, type TouchCounts } from "./file-heatmap";

/** Per-node rendered-transcript ceiling (spec FR4.5). */
export const TRANSCRIPT_CAP = 500;

export type NodeRunStatus = "idle" | "running" | "succeeded" | "failed";

// Deliberately verdict-free: the recorded outcome lives on the walk rows
// (AssemblyLineRunNode) and is joined in by the view layer, so the event stream
// can never overwrite a verdict — a review that exits 0 with a "failed" verdict
// cannot masquerade as succeeded, by construction rather than by carry rules.
export interface NodeRunState {
  status: NodeRunStatus;
  iteration: number;
  readonly transcript: readonly RunStreamEvent[];
  /** Events evicted by the cap; non-zero once the transcript is partial. */
  droppedCount: number;
}

export interface TimelineEntry {
  id: string;
  nodeId: string;
  iteration: number | null;
  eventType: AgentRunEventType;
  createdAt: string;
}

export interface RunLiveState {
  /** The newest applied event id — the SSE `Last-Event-ID` cursor. */
  lastEventId: string | null;
  nodeStates: Record<string, NodeRunState>;
  fileTouches: Record<string, TouchCounts>;
  timeline: TimelineEntry[];
}

// Shared sentinel: every unseen node returns this same object, so a mutation of
// it would corrupt every idle node at once. Frozen deeply — Object.freeze is
// shallow, and freezing only the wrapper would still leave transcript.push()
// silently working, which is the exact failure this guards against.
const IDLE: NodeRunState = Object.freeze({
  status: "idle",
  iteration: 0,
  transcript: Object.freeze([]),
  droppedCount: 0,
});

/**
 * A walk row's outcome as a node status. A null outcome means the node is still
 * in flight; `success` and `changes_requested` both mean it ran to completion —
 * the second is a verdict the edge acts on, not a node failure.
 */
function seedStatus(outcome: string | null): NodeRunStatus {
  if (outcome === null) {
    return "running";
  }

  return outcome.includes("failed") ? "failed" : "succeeded";
}

/**
 * The state a run starts from: every definition node idle, then each node the
 * walk has already visited set from its newest row.
 */
export function initialRunState(
  def: AssemblyLineDefinition | null,
  visitRows: readonly AssemblyLineRunNode[],
): RunLiveState {
  const nodeStates: Record<string, NodeRunState> = {};

  for (const node of def?.nodes ?? []) {
    nodeStates[node.id] = IDLE;
  }

  for (const row of visitRows) {
    const seen = nodeStates[row.nodeId];

    if (seen && seen.iteration > row.iteration) {
      continue;
    }

    nodeStates[row.nodeId] = {
      status: seedStatus(row.outcome),
      iteration: row.iteration,
      transcript: [],
      droppedCount: 0,
    };
  }

  return {
    lastEventId: null,
    nodeStates,
    fileTouches: {},
    timeline: [],
  };
}

function nextStatus(
  event: RunStreamEvent,
  current: NodeRunStatus,
): NodeRunStatus {
  if (event.eventType === "init") {
    return "running";
  }

  if (event.eventType === "result") {
    return event.isError ? "failed" : "succeeded";
  }

  return current;
}

function appendCapped(
  node: NodeRunState,
  event: RunStreamEvent,
): Pick<NodeRunState, "transcript" | "droppedCount"> {
  const grown = [...node.transcript, event];
  const overflow = Math.max(0, grown.length - TRANSCRIPT_CAP);

  return {
    transcript: overflow === 0 ? grown : grown.slice(overflow),
    droppedCount: node.droppedCount + overflow,
  };
}

function withFileTouches(
  touches: Record<string, TouchCounts>,
  paths: readonly string[],
  toolName: string | null,
): Record<string, TouchCounts> {
  const kind = touchKind(toolName);

  if (kind === null || paths.length === 0) {
    return touches;
  }

  const next = { ...touches };

  for (const path of paths) {
    const prev = next[path] ?? { reads: 0, writes: 0 };

    next[path] =
      kind === "read"
        ? { reads: prev.reads + 1, writes: prev.writes }
        : { reads: prev.reads, writes: prev.writes + 1 };
  }

  return next;
}

/**
 * Is `id` past the cursor? Ids are string-encoded bigints from an identity
 * column, so they are digit strings without leading zeros: longer means larger,
 * and equal length orders lexicographically. Comparing this way rather than
 * keeping a set of applied ids is what makes de-duplication O(1) in both time
 * and memory — a per-event copy of a growing set made the fold quadratic.
 */
function isNewer(id: string, cursor: string | null): boolean {
  if (cursor === null) {
    return true;
  }

  return id.length === cursor.length ? id > cursor : id.length > cursor.length;
}

/**
 * Apply one event. Returns the state unchanged (by identity) for an id at or
 * behind the cursor, so an SSE reconnect that replays overlapping events is a
 * no-op.
 */
export function reduceRunEvent(
  state: RunLiveState,
  event: RunStreamEvent,
): RunLiveState {
  if (!isNewer(event.id, state.lastEventId)) {
    return state;
  }

  if (event.nodeId === null) {
    return { ...state, lastEventId: event.id };
  }

  const node = state.nodeStates[event.nodeId] ?? IDLE;
  const isLifecycle =
    event.eventType === "init" || event.eventType === "result";

  return {
    lastEventId: event.id,
    nodeStates: {
      ...state.nodeStates,
      [event.nodeId]: {
        status: nextStatus(event, node.status),
        iteration: event.iteration ?? node.iteration,
        ...appendCapped(node, event),
      },
    },
    fileTouches: withFileTouches(
      state.fileTouches,
      event.filePaths,
      event.toolName,
    ),
    timeline: isLifecycle
      ? [
          ...state.timeline,
          {
            id: event.id,
            nodeId: event.nodeId,
            iteration: event.iteration,
            eventType: event.eventType,
            createdAt: event.createdAt,
          },
        ]
      : state.timeline,
  };
}

/** Fold the first `cursor` events onto `base`; the whole list when omitted. */
export function replayTo(
  base: RunLiveState,
  events: readonly RunStreamEvent[],
  cursor: number = events.length,
): RunLiveState {
  return events
    .slice(0, cursor)
    .reduce((state, event) => reduceRunEvent(state, event), base);
}
