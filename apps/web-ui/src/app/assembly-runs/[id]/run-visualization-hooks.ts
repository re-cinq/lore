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
} from "./run-stream-presenter";
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
export function useRunGraph({
  nodes,
  definition,
  runStatus,
  runIsLive,
  selectedNodeId,
  showOutcomes,
  replayActive,
  nodeStates,
  takenEdges,
}: {
  nodes: readonly AssemblyRunNode[];
  definition: AssemblyLineDefinition | null;
  runStatus: string;
  runIsLive: boolean;
  selectedNodeId: string | null;
  showOutcomes: boolean;
  replayActive: boolean;
  nodeStates: Readonly<Record<string, NodeRunState>>;
  takenEdges: RunData["taken"];
}) {
  const hasRunData = computeHasRunData(nodes.length, nodeStates);
  const latestRows = useMemo(() => latestRowByNode(nodes), [nodes]);
  // Fork source for "retry this node" — null hides the button (live run, unvisited node, entry node, or an unnameable prefix; see retry-resume.ts).
  const retrySource = useMemo(
    () =>
      runIsLive || selectedNodeId === null
        ? null
        : retryResumeSource(nodes, selectedNodeId),
    [runIsLive, nodes, selectedNodeId],
  );
  const runData = useMemo<RunData>(
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
  const graphMode = computeGraphMode(hasRunData, showOutcomes);
  const visibleGraph = useMemo(
    () =>
      deriveVisibleGraph(definition, hasRunData ? runData : null, graphMode),
    [definition, hasRunData, runData, graphMode],
  );

  return { hasRunData, visibleGraph, retrySource, latestRows };
}

/** Scrubbing a finished run. A terminal run renders state AS OF the cursor by folding history through the SAME reducer live mode uses, based on the all-idle state — never the visit-row seed, which would show verdicts the cursor has not reached. */
export function useReplay({
  runIsLive,
  runStatus,
  definition,
  historyEvents,
  liveState,
  replayCursor,
  setReplayCursor,
}: {
  runIsLive: boolean;
  runStatus: string;
  definition: AssemblyLineDefinition | null;
  historyEvents: RunStreamEvent[];
  liveState: ReturnType<typeof initialRunState>;
  replayCursor: number | null;
  setReplayCursor: (cursor: number | null) => void;
}) {
  const replayState = useMemo(
    () =>
      replayTo(
        initialRunState(definition, []),
        historyEvents,
        replayCursor ?? historyEvents.length,
      ),
    [definition, historyEvents, replayCursor],
  );
  const onSeek = useCallback(
    (id: string) => {
      const cursor = cursorForEventId(historyEvents, id);

      if (cursor !== null) {
        setReplayCursor(cursor);
      }
    },
    [historyEvents, setReplayCursor],
  );

  return {
    displayState: pickDisplayState(runIsLive, liveState, replayState),
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
    onCursorChange: setReplayCursor,
    onBackToLive: () => setReplayCursor(null),
    onSeek,
  };
}

/** Everything the inspector needs about the selected node. Its walk rows are the source for the attempt history and the per-attempt pod logs; what each visit was GIVEN is per-visit state like its outcome, and rides those rows rather than the event stream, since no pod echoes its own prompt. */
export function useSelectedNode({
  nodes,
  definition,
  reason,
  selectedNodeId,
  nodeStates,
}: {
  nodes: readonly AssemblyRunNode[];
  definition: AssemblyLineDefinition | null;
  reason: string | null;
  selectedNodeId: string | null;
  nodeStates: Readonly<Record<string, NodeRunState>>;
}) {
  const selected = pickSelectedState(nodeStates, selectedNodeId);
  const selectedRows = useMemo(
    () => nodes.filter((node) => node.nodeId === selectedNodeId),
    [nodes, selectedNodeId],
  );
  const nodeInputs = useMemo(
    () =>
      selectedRows.flatMap((node) =>
        node.input ? [{ iteration: node.iteration, ...node.input }] : [],
      ),
    [selectedRows],
  );
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
