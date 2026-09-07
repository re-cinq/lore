"use client";

// The live-run container: owns every piece of mutable state and IO here so the sections below stay pure functions of props (DDAU / lore/no-io-in-view).
import { useCallback, useReducer, useState } from "react";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import { reduceRunEvent, initialRunState } from "@/lib/run-event-reducer";
import type { RunStreamEvent } from "@/lib/run-stream-types";
import styles from "./RunVisualizationPanel.module.css";
import { isTerminalRunStatus } from "@/lib/run-stream-presenter";
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

/** What the viewer has selected or expanded. None of it is derived from the run, so it survives every live event and every replay seek. */
function useViewToggles() {
  const [replayCursor, setReplayCursor] = useState<number | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [showOutcomes, setShowOutcomes] = useState(false);
  const toggleShowAllFiles = useCallback(
    () => setShowAllFiles((shown) => !shown),
    [],
  );

  return {
    replayCursor,
    setReplayCursor,
    selectedNodeId,
    setSelectedNodeId,
    showAllFiles,
    toggleShowAllFiles,
    showOutcomes,
    setShowOutcomes,
  };
}

/** The live stream and the replay that reads back over it. They are one hook because replay consumes exactly what the stream accumulated — splitting them would let a component subscribe without being able to scrub. */
function useReplayableStream({
  run,
  runId,
  liveState,
  dispatch,
  replayCursor,
  setReplayCursor,
}: {
  run: Parameters<typeof useReplay>[0] extends infer R
    ? Omit<
        R,
        "historyEvents" | "liveState" | "replayCursor" | "setReplayCursor"
      >
    : never;
  runId: string;
  liveState: ReturnType<typeof reduceRunEvent>;
  dispatch: (event: RunStreamEvent) => void;
  replayCursor: number | null;
  setReplayCursor: (cursor: number | null) => void;
}) {
  const onEvent = useCallback(
    (event: RunStreamEvent) => dispatch(event),
    [dispatch],
  );
  const { historyEvents, chipState } = useRunStream({
    runId,
    runStatus: run.runStatus,
    runIsLive: run.runIsLive,
    lastEventId: liveState.lastEventId ?? "0",
    dispatch: onEvent,
  });
  const replay = useReplay({
    ...run,
    historyEvents,
    liveState,
    replayCursor,
    setReplayCursor,
  });

  return { historyEvents, chipState, replay };
}

/** The five run facts every derivation reads; named once so each hook's own parameters are only what it adds. */
interface RunFacts {
  nodes: RunVisualizationPanelProps["nodes"];
  definition: RunVisualizationPanelProps["definition"];
  runStatus: RunVisualizationPanelProps["runStatus"];
  runIsLive: boolean;
  reason: RunVisualizationPanelProps["reason"];
}

/** The selected node resolves FIRST: the graph needs its taken edges to decide which paths to draw, so the two cannot be swapped or run independently. */
function useNodeAndGraph(
  run: RunFacts,
  view: {
    selectedNodeId: string | null;
    showOutcomes: boolean;
    replayActive: boolean;
    nodeStates: ReturnType<typeof useReplay>["displayState"]["nodeStates"];
  },
) {
  const node = useSelectedNode({
    ...run,
    selectedNodeId: view.selectedNodeId,
    nodeStates: view.nodeStates,
  });
  const graph = useRunGraph({
    ...run,
    selectedNodeId: view.selectedNodeId,
    showOutcomes: view.showOutcomes,
    replayActive: view.replayActive,
    nodeStates: view.nodeStates,
    takenEdges: node.takenEdges,
  });

  return { node, graph };
}

/** Composes the view's state. The ORDER is the content: replay resolves first because the selected node is read out of the displayed state, and the graph is built from both — each step consumes the previous one's output, so they cannot be reordered or run in parallel. */
function useRunVisualization({
  runId,
  runStatus,
  definition,
  nodes,
  reason,
}: Pick<
  RunVisualizationPanelProps,
  "runId" | "runStatus" | "definition" | "nodes" | "reason"
>) {
  const runIsLive = !isTerminalRunStatus(runStatus);
  const run: RunFacts = { nodes, definition, runStatus, runIsLive, reason };
  const now = useNowTicker(runIsLive);
  const [state, dispatch] = useReducer(reduceRunEvent, undefined, () =>
    initialRunState(definition, nodes),
  );
  const toggles = useViewToggles();
  const { replayCursor, selectedNodeId, showOutcomes } = toggles;
  const { historyEvents, chipState, replay } = useReplayableStream({
    run,
    runId,
    liveState: state,
    dispatch,
    replayCursor,
    setReplayCursor: toggles.setReplayCursor,
  });
  const { displayState, scrubberVisible, replayPosition, replayActive } =
    replay;
  const { node, graph } = useNodeAndGraph(run, {
    selectedNodeId,
    showOutcomes,
    replayActive,
    nodeStates: displayState.nodeStates,
  });

  return {
    ...toggles,
    now,
    state,
    replay,
    node,
    graph,
    chipState,
    historyEvents,
    displayState,
    scrubberVisible,
    replayPosition,
  };
}

type RunView = ReturnType<typeof useRunVisualization>;

function RunGraph({
  view,
  definition,
}: {
  view: RunView;
  definition: RunVisualizationPanelProps["definition"];
}) {
  return (
    <RunGraphSection
      chipState={view.chipState}
      graph={view.graph.visibleGraph}
      definition={definition}
      onSelectNode={view.setSelectedNodeId}
      hasRunData={view.graph.hasRunData}
      showOutcomes={view.showOutcomes}
      onToggleOutcomes={() => view.setShowOutcomes((shown) => !shown)}
      replay={{
        show: view.scrubberVisible,
        historyEventCount: view.historyEvents.length,
        cursor: view.replayCursor,
        position: view.replayPosition,
        onCursorChange: view.replay.onCursorChange,
        onBackToLive: view.replay.onBackToLive,
      }}
    />
  );
}

/** Takes the run's own props as `page` rather than threading eight arguments: none of them is derived from the run, they are what the route already knew. */
function RunDetail({
  view,
  page,
}: {
  view: RunView;
  page: Pick<
    RunVisualizationPanelProps,
    "runId" | "repo" | "reason" | "definition" | "agentEditHrefs" | "startedAt"
  >;
}) {
  return (
    <RunDetailSection
      {...{
        selectedNodeId: view.selectedNodeId,
        runId: page.runId,
        repo: page.repo,
        reason: page.reason,
        definition: page.definition,
        latestRows: view.graph.latestRows,
        selectedRows: view.node.selectedRows,
        selectedAttempts: view.node.selectedAttempts,
        nodeInputs: view.node.nodeInputs,
        retrySource: view.graph.retrySource,
        agentEditHrefs: page.agentEditHrefs,
        startedAt: page.startedAt,
        now: view.now,
        showAllFiles: view.showAllFiles,
        toggleShowAllFiles: view.toggleShowAllFiles,
      }}
      selectedState={view.node.selected}
      visibleNodeCount={view.graph.visibleGraph.nodes.length}
      timeline={view.displayState.timeline}
      fileTouches={view.displayState.fileTouches}
      onSeek={resolveOnSeek(view.scrubberVisible, view.replay.onSeek)}
    />
  );
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
  const view = useRunVisualization({
    runId,
    runStatus,
    definition,
    nodes,
    reason,
  });

  return (
    <section className={styles.panel}>
      <RunGraph view={view} definition={definition} />
      <RunDetail
        view={view}
        page={{ runId, repo, reason, definition, agentEditHrefs, startedAt }}
      />
    </section>
  );
}
