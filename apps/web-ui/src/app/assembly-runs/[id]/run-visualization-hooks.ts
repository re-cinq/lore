// Derived-state hooks for RunVisualizationPanel: each takes the panel's raw state and memoizes one view of it (the ticking clock, the executed-path graph, the replay scrub, the selected node's detail).
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import {
  initialRunState,
  replayTo,
  type NodeRunState,
} from "@/lib/run-event-reducer";
import { takenEdgeKeys } from "@/lib/run-taken-edges";
import { latestRowByNode, replayRunData } from "@/lib/run-replay-view";
import { deriveVisibleGraph, type RunData } from "@/lib/graph-view-model";
import type { RunStreamEvent } from "@/lib/run-stream-types";
import { stepViews } from "@/lib/step-presenter";
import { retryResumeSource } from "./retry-resume";
import {
  cursorForEventId,
  scrubberPositionLabel,
} from "@/lib/run-stream-presenter";
import {
  buildRunData,
  computeGraphMode,
  computeHasRunData,
  computeReplayActive,
  computeScrubberVisible,
  pickDisplayState,
  pickSelectedState,
} from "./run-visualization-selectors";

/** The timeline's right edge is `now` — without a clock a stalled node's last tick would look identical to a live one. Ticks once a second while the run is live. */
export function useNowTicker(live: boolean): string {
  const [now, setNow] = useState(() => new Date().toISOString());

  useEffect(() => {
    if (!live) {
      return;
    }

    const id = setInterval(() => setNow(new Date().toISOString()), 1000);

    return () => clearInterval(id);
  }, [live]);

  return now;
}

/** The graph the page draws: which nodes ran, what each was told, and — while scrubbing — the replayed view instead, since a verdict must not show before the cursor reaches the event that produced it. */
interface RunGraphInput {
  nodes: readonly AssemblyRunNode[];
  definition: AssemblyLineDefinition | null;
  runStatus: string;
  runIsLive: boolean;
  selectedNodeId: string | null;
  showOutcomes: boolean;
  replayActive: boolean;
  nodeStates: Readonly<Record<string, NodeRunState>>;
  takenEdges: RunData["taken"];
}

/** The graph as drawn. A run with no rows yet passes `null` run data on purpose — the definition alone renders as the plain shape of the line, rather than as every node wrongly reporting "not started". */
function useVisibleGraph(
  definition: AssemblyLineDefinition | null,
  hasRunData: boolean,
  runData: RunData,
  showOutcomes: boolean,
) {
  const graphMode = computeGraphMode(hasRunData, showOutcomes);

  return useMemo(
    () =>
      deriveVisibleGraph(definition, hasRunData ? runData : null, graphMode),
    [definition, hasRunData, runData, graphMode],
  );
}

/** Fork source for "retry this node", or null to hide the button — a live run, an unvisited node, the entry node, or a prefix that cannot be named (see retry-resume.ts). */
function useRetrySource(
  nodes: readonly AssemblyRunNode[],
  runIsLive: boolean,
  selectedNodeId: string | null,
) {
  return useMemo(
    () =>
      runIsLive || selectedNodeId === null
        ? null
        : retryResumeSource(nodes, selectedNodeId),
    [runIsLive, nodes, selectedNodeId],
  );
}

type RunDataInput = Pick<
  RunGraphInput,
  | "replayActive"
  | "definition"
  | "nodes"
  | "nodeStates"
  | "takenEdges"
  | "runStatus"
> & { latestRows: ReturnType<typeof latestRowByNode> };

/** What the graph draws. While scrubbing, this is rebuilt from the REPLAYED state rather than the live rows: the two disagree by design, and the cursor's answer is the one on screen. */
function useRunData(input: RunDataInput): RunData {
  const { replayActive, definition, nodes, nodeStates } = input;
  const { latestRows, takenEdges, runStatus } = input;

  return useMemo<RunData>(
    () =>
      replayActive
        ? replayRunData(definition, nodes, nodeStates)
        : buildRunData({
            nodes,
            nodeStates,
            latestRows,
            takenEdges,
            runStatus,
          }),
    [
      replayActive,
      definition,
      nodes,
      latestRows,
      nodeStates,
      takenEdges,
      runStatus,
    ],
  );
}

export function useRunGraph(input: RunGraphInput) {
  const { nodes, definition, nodeStates, showOutcomes } = input;
  const hasRunData = computeHasRunData(nodes.length, nodeStates);
  const latestRows = useMemo(() => latestRowByNode(nodes), [nodes]);
  const retrySource = useRetrySource(
    nodes,
    input.runIsLive,
    input.selectedNodeId,
  );
  const runData = useRunData({ ...input, latestRows });

  return {
    hasRunData,
    visibleGraph: useVisibleGraph(
      definition,
      hasRunData,
      runData,
      showOutcomes,
    ),
    retrySource,
    latestRows,
  };
}

/** Scrubbing a finished run. A terminal run renders state AS OF the cursor by folding history through the SAME reducer live mode uses, based on the all-idle state — never the visit-row seed, which would show verdicts the cursor has not reached. */
interface ReplayInput {
  runIsLive: boolean;
  runStatus: string;
  definition: AssemblyLineDefinition | null;
  historyEvents: RunStreamEvent[];
  liveState: ReturnType<typeof initialRunState>;
  replayCursor: number | null;
  setReplayCursor: (cursor: number | null) => void;
}

/** Seeks to the event with this id. An id the history does not hold leaves the cursor alone rather than resetting it — a stale link should not silently jump the scrubber to the start. */
function useSeek(
  historyEvents: RunStreamEvent[],
  setReplayCursor: (cursor: number | null) => void,
) {
  return useCallback(
    (id: string) => {
      const cursor = cursorForEventId(historyEvents, id);

      if (cursor !== null) {
        setReplayCursor(cursor);
      }
    },
    [historyEvents, setReplayCursor],
  );
}

/** What the scrubber itself shows. A null cursor means "follow the end", so it reads as the full history length rather than as position zero. */
function scrubberView(
  runStatus: string,
  historyEvents: RunStreamEvent[],
  replayCursor: number | null,
  runIsLive: boolean,
) {
  return {
    scrubberVisible: computeScrubberVisible(runStatus, historyEvents.length),
    replayPosition: scrubberPositionLabel(
      historyEvents,
      replayCursor ?? historyEvents.length,
    ),
    replayActive: computeReplayActive(
      runIsLive,
      replayCursor,
      historyEvents.length,
    ),
  };
}

export function useReplay({
  runIsLive,
  runStatus,
  definition,
  historyEvents,
  liveState,
  replayCursor,
  setReplayCursor,
}: ReplayInput) {
  const replayState = useMemo(
    () =>
      replayTo(
        initialRunState(definition, []),
        historyEvents,
        replayCursor ?? historyEvents.length,
      ),
    [definition, historyEvents, replayCursor],
  );

  return {
    displayState: pickDisplayState(runIsLive, liveState, replayState),
    ...scrubberView(runStatus, historyEvents, replayCursor, runIsLive),
    onCursorChange: setReplayCursor,
    onBackToLive: () => setReplayCursor(null),
    onSeek: useSeek(historyEvents, setReplayCursor),
  };
}

interface SelectedNodeInput {
  nodes: readonly AssemblyRunNode[];
  definition: AssemblyLineDefinition | null;
  reason: string | null;
  selectedNodeId: string | null;
  nodeStates: Readonly<Record<string, NodeRunState>>;
}

/** What each visit was GIVEN, per attempt. A visit with no recorded input contributes nothing rather than an empty entry — the inspector lists inputs, and a blank row reads as "given nothing" rather than "not recorded". */
function useNodeInputs(selectedRows: readonly AssemblyRunNode[]) {
  return useMemo(
    () =>
      selectedRows.flatMap((node) =>
        node.input ? [{ iteration: node.iteration, ...node.input }] : [],
      ),
    [selectedRows],
  );
}

/** Everything the inspector needs about the selected node. Its walk rows are the source for the attempt history and the per-attempt pod logs; what each visit was GIVEN is per-visit state like its outcome, and rides those rows rather than the event stream, since no pod echoes its own prompt. */
export function useSelectedNode({
  nodes,
  definition,
  reason,
  selectedNodeId,
  nodeStates,
}: SelectedNodeInput) {
  const selected = pickSelectedState(nodeStates, selectedNodeId);
  const selectedRows = useMemo(
    () => nodes.filter((node) => node.nodeId === selectedNodeId),
    [nodes, selectedNodeId],
  );
  const nodeInputs = useNodeInputs(selectedRows);
  const selectedAttempts = useMemo(
    () => stepViews(definition, selectedRows, reason),
    [definition, selectedRows, reason],
  );
  const takenEdges = useMemo(
    () => takenEdgeKeys(definition, nodes),
    [definition, nodes],
  );

  return {
    selected,
    selectedRows,
    nodeInputs,
    selectedAttempts,
    takenEdges,
  };
}
