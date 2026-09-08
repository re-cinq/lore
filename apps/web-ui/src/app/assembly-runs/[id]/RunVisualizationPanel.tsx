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

interface ReplayableStreamInput {
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
}

/** The live stream and the replay that reads back over it. They are one hook because replay consumes exactly what the stream accumulated — splitting them would let a component subscribe without being able to scrub. */
function useReplayableStream({
  run,
  runId,
  liveState,
  dispatch,
  replayCursor,
  setReplayCursor,
}: ReplayableStreamInput) {
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
type RunVisualizationInput = Pick<
  RunVisualizationPanelProps,
  "runId" | "runStatus" | "definition" | "nodes" | "reason"
>;

/** Where the run's events come from: the reducer that holds them, and the stream/replay pair that feeds it. Seeded from the visit ROWS so a run opened long after the fact renders immediately, then folded forward by whatever the stream delivers. */
function useRunSources(
  run: RunFacts,
  runId: string,
  toggles: ReturnType<typeof useViewToggles>,
) {
  const [state, dispatch] = useReducer(reduceRunEvent, undefined, () =>
    initialRunState(run.definition, run.nodes),
  );
  const { historyEvents, chipState, replay } = useReplayableStream({
    run,
    runId,
    liveState: state,
    dispatch,
    replayCursor: toggles.replayCursor,
    setReplayCursor: toggles.setReplayCursor,
  });

  return { state, historyEvents, chipState, replay };
}

/** The replay hook's own output, flattened onto the view. Kept whole under `replay` as well: the panel passes the handlers straight to the scrubber, while the individual fields are what the surrounding chrome reads. */
function replayView(replay: ReturnType<typeof useReplay>) {
  return {
    replay,
    displayState: replay.displayState,
    scrubberVisible: replay.scrubberVisible,
    replayPosition: replay.replayPosition,
  };
}

function useRunVisualization(input: RunVisualizationInput) {
  const { runId, runStatus, definition, nodes, reason } = input;
  const runIsLive = !isTerminalRunStatus(runStatus);
  const run: RunFacts = { nodes, definition, runStatus, runIsLive, reason };
  const toggles = useViewToggles();
  const { state, historyEvents, chipState, replay } = useRunSources(
    run,
    runId,
    toggles,
  );
  const nodeAndGraph = useNodeAndGraph(run, {
    selectedNodeId: toggles.selectedNodeId,
    showOutcomes: toggles.showOutcomes,
    replayActive: replay.replayActive,
    nodeStates: replay.displayState.nodeStates,
  });

  return {
    ...toggles,
    ...replayView(replay),
    ...nodeAndGraph,
    now: useNowTicker(runIsLive),
    state,
    chipState,
    historyEvents,
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
type RunDetailPage = Pick<
  RunVisualizationPanelProps,
  "runId" | "repo" | "reason" | "definition" | "agentEditHrefs" | "startedAt"
>;

/** The inspector's plain values — the page's own facts and the view's derivations, flattened into one bundle because the section reads them as a flat prop list. */
function detailProps(view: RunView, page: RunDetailPage) {
  return {
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
  };
}

function RunDetail({ view, page }: { view: RunView; page: RunDetailPage }) {
  const { visibleGraph } = view.graph;

  return (
    <RunDetailSection
      {...detailProps(view, page)}
      selectedState={view.node.selected}
      visibleNodeCount={visibleGraph.nodes.length}
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
