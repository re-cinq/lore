"use client";

// The live-run container: owns every piece of mutable state and IO here so the sections below stay pure functions of props (DDAU / lore/no-io-in-view).
import { useCallback, useReducer, useState } from "react";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import { reduceRunEvent, initialRunState } from "@/lib/run-event-reducer";
import type { RunStreamEvent } from "@/lib/run-stream-types";
import styles from "./RunVisualizationPanel.module.css";
import { isTerminalRunStatus } from "./run-stream-presenter";
import { useRunStream } from "./use-run-history";
import {
  useNowTicker,
  useReplay,
  useRunGraph,
  useSelectedNode,
} from "./run-visualization-hooks";
import { resolveOnSeek } from "./run-visualization-selectors";
import { RunDetailSection } from "./RunVisualizationSections";
import { RunGraphSection } from "./RunGraphSection";

export interface RunVisualizationPanelProps {
  runId: string;
  runStatus: string;
  startedAt: string | null;
  definition: AssemblyLineDefinition | null;
  nodes: readonly AssemblyRunNode[];
  repo: string;
  reason: string | null;
  // nodeId → agents-editor href for each agent node the catalog holds; resolved server-side, the panel only renders what it is handed.
  agentEditHrefs?: Record<string, string>;
}

export default function RunVisualizationPanel({
  runId,
  runStatus,
  startedAt,
  definition,
  nodes,
  repo,
  reason,
  agentEditHrefs,
}: RunVisualizationPanelProps) {
  const runIsLive = !isTerminalRunStatus(runStatus);
  // The five values every derivation below needs; named once so each hook takes what it adds.
  const run = { nodes, definition, runStatus, runIsLive, reason };
  const now = useNowTicker(runIsLive);
  const [state, dispatch] = useReducer(reduceRunEvent, undefined, () =>
    initialRunState(definition, nodes),
  );
  const [replayCursor, setReplayCursor] = useState<number | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const onEvent = useCallback((event: RunStreamEvent) => dispatch(event), []);
  const { historyEvents, chipState } = useRunStream({
    runId,
    runStatus,
    runIsLive,
    lastEventId: state.lastEventId ?? "0",
    dispatch: onEvent,
  });
  const toggleShowAllFiles = useCallback(
    () => setShowAllFiles((shown) => !shown),
    [],
  );

  const replay = useReplay({
    ...run,
    historyEvents,
    liveState: state,
    replayCursor,
    setReplayCursor,
  });
  const { displayState, scrubberVisible, replayPosition, replayActive } =
    replay;
  const node = useSelectedNode({
    ...run,
    selectedNodeId,
    nodeStates: displayState.nodeStates,
  });
  const [showOutcomes, setShowOutcomes] = useState(false);
  const graph = useRunGraph({
    ...run,
    selectedNodeId,
    showOutcomes,
    replayActive,
    nodeStates: displayState.nodeStates,
    takenEdges: node.takenEdges,
  });

  return (
    <section className={styles.panel}>
      <RunGraphSection
        chipState={chipState}
        graph={graph.visibleGraph}
        definition={definition}
        onSelectNode={setSelectedNodeId}
        hasRunData={graph.hasRunData}
        showOutcomes={showOutcomes}
        onToggleOutcomes={() => setShowOutcomes((shown) => !shown)}
        replay={{
          show: scrubberVisible,
          historyEventCount: historyEvents.length,
          cursor: replayCursor,
          position: replayPosition,
          onCursorChange: replay.onCursorChange,
          onBackToLive: replay.onBackToLive,
        }}
      />
      <RunDetailSection
        {...{
          selectedNodeId,
          runId,
          repo,
          reason,
          definition,
          latestRows: graph.latestRows,
          selectedRows: node.selectedRows,
          selectedAttempts: node.selectedAttempts,
          nodeInputs: node.nodeInputs,
          retrySource: graph.retrySource,
          agentEditHrefs,
          startedAt,
          now,
          showAllFiles,
          toggleShowAllFiles,
        }}
        selectedState={node.selected}
        visibleNodeCount={graph.visibleGraph.nodes.length}
        timeline={displayState.timeline}
        fileTouches={displayState.fileTouches}
        onSeek={resolveOnSeek(scrubberVisible, replay.onSeek)}
      />
    </section>
  );
}
