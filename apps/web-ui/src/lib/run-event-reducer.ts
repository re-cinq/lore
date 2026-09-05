// Pure state machine: (state, event) => state fold; seeded from walk rows, advanced by agent events; O(1) per event (spec FR4.6).

import type { AssemblyLineDefinition } from "./assembly-line-definition";
import type { AssemblyRunNode } from "./assembly-runs";
import type { AgentRunEventType, RunStreamEvent } from "./run-stream-types";
import { touchKind, type TouchCounts } from "./file-heatmap";

/** Per-node rendered-transcript ceiling (spec FR4.5). */
export const TRANSCRIPT_CAP = 500;

export type NodeRunStatus = "idle" | "running" | "succeeded" | "failed";

// Verdict-free: outcome lives on walk rows (joined by view), so event stream never overwrites verdicts (by construction).
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

// Shared sentinel: frozen deeply to prevent corruption of every idle node; shallow freeze would still allow transcript.push().
const IDLE: NodeRunState = Object.freeze({
  status: "idle",
  iteration: 0,
  transcript: Object.freeze([]),
  droppedCount: 0,
});

/** Convert walk row outcome to node status; null = running; success/changes_requested = complete (latter is verdict, not failure). */
function seedStatus(outcome: string | null): NodeRunStatus {
  if (outcome === null) {
    return "running";
  }

  return outcome.includes("failed") ? "failed" : "succeeded";
}

function idleNodeStates(
  def: AssemblyLineDefinition | null,
): Record<string, NodeRunState> {
  const nodeStates: Record<string, NodeRunState> = {};

  for (const node of def?.nodes ?? []) {
    nodeStates[node.id] = IDLE;
  }

  return nodeStates;
}

/** Sets `row`'s node to its seeded state, unless a newer-iteration row already won. */
function applyVisitRow(
  nodeStates: Record<string, NodeRunState | undefined>,
  row: AssemblyRunNode,
): void {
  const seen = nodeStates[row.nodeId];

  if (seen && seen.iteration > row.iteration) {
    return;
  }

  nodeStates[row.nodeId] = {
    status: seedStatus(row.outcome),
    iteration: row.iteration,
    transcript: [],
    droppedCount: 0,
  };
}

/** Initial run state: every definition node idle, then each visited node set from its newest row. */
export function initialRunState(
  def: AssemblyLineDefinition | null,
  visitRows: readonly AssemblyRunNode[],
): RunLiveState {
  const nodeStates = idleNodeStates(def);

  for (const row of visitRows) {
    applyVisitRow(nodeStates, row);
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

/** Is id past cursor? Bigint string comparison (length then lex); O(1) dedup vs. O(n²) with a set. */
function isNewer(id: string, cursor: string | null): boolean {
  if (cursor === null) {
    return true;
  }

  return id.length === cursor.length ? id > cursor : id.length > cursor.length;
}

function isLifecycleEvent(event: RunStreamEvent): boolean {
  return event.eventType === "init" || event.eventType === "result";
}

/** Appends `event` to the timeline when it's a lifecycle event; otherwise returns `timeline` unchanged. */
function appendTimeline(
  timeline: TimelineEntry[],
  event: RunStreamEvent,
  nodeId: string,
): TimelineEntry[] {
  if (!isLifecycleEvent(event)) {
    return timeline;
  }

  return [
    ...timeline,
    {
      id: event.id,
      nodeId,
      iteration: event.iteration,
      eventType: event.eventType,
      createdAt: event.createdAt,
    },
  ];
}

/** Apply one event; returns state unchanged (by identity) for id at/behind cursor (SSE reconnect replay = no-op). */
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

  const nodeId = event.nodeId;
  const node = state.nodeStates[nodeId] ?? IDLE;

  return {
    lastEventId: event.id,
    nodeStates: {
      ...state.nodeStates,
      [nodeId]: {
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
    timeline: appendTimeline(state.timeline, event, nodeId),
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
