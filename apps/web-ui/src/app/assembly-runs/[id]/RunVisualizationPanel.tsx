"use client";

// The live-run container: owns every piece of mutable state and IO here so the sections below stay pure functions of props (DDAU / lore/no-io-in-view).
import { useCallback, useEffect, useReducer, useState } from "react";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import {
  reduceRunEvent,
  initialRunState,
  withVisitRows,
  type RunLiveState,
} from "@/lib/run-event-reducer";
import type { RunStreamEvent, RunStreamFrame } from "@/lib/run-stream-types";
import styles from "./RunVisualizationPanel.module.css";
import { isTerminalRunStatus } from "@/lib/run-stream-presenter";
import { useRunStream } from "./use-run-history";
import {
  useNowTicker,
  useRunGraph,
  useSelectedNode,
} from "./run-visualization-hooks";
import { RunDetailSection } from "./RunVisualizationSections";
import { RunGraphSection } from "./RunGraphSection";

export interface RunVisualizationPanelProps {
  runId: string;
  runStatus: string;
  definition: AssemblyLineDefinition | null;
  nodes: readonly AssemblyRunNode[];
  repo: string;
  reason: string | null;
  // nodeId → agents-editor href for each agent node the catalog holds; resolved server-side, the panel only renders what it is handed.
  agentEditHrefs?: Record<string, string>;
  /** The page's fold for the stream's state families; the panel owns the socket, the page owns run/node/task state. */
  onFrame?: (frame: RunStreamFrame) => void;
}

/** What the viewer has selected or expanded. None of it is derived from the run, so it survives every live event. */
function useViewToggles() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [showOutcomes, setShowOutcomes] = useState(false);
  const toggleShowAllFiles = useCallback(
    () => setShowAllFiles((shown) => !shown),
    [],
  );

  return {
    selectedNodeId,
    setSelectedNodeId,
    showAllFiles,
    toggleShowAllFiles,
    showOutcomes,
    setShowOutcomes,
  };
}

/** The five run facts every derivation reads; named once so each hook's own parameters are only what it adds. */
interface RunFacts {
  nodes: RunVisualizationPanelProps["nodes"];
  definition: RunVisualizationPanelProps["definition"];
  runStatus: RunVisualizationPanelProps["runStatus"];
  runIsLive: boolean;
  reason: RunVisualizationPanelProps["reason"];
}

interface NodeAndGraphView {
  selectedNodeId: string | null;
  showOutcomes: boolean;
  nodeStates: ReturnType<typeof initialRunState>["nodeStates"];
}

/** The selected node resolves FIRST: the graph needs its taken edges to decide which paths to draw, so the two cannot be swapped or run independently. */
function useNodeAndGraph(run: RunFacts, view: NodeAndGraphView) {
  const node = useSelectedNode({
    ...run,
    selectedNodeId: view.selectedNodeId,
    nodeStates: view.nodeStates,
  });
  const graph = useRunGraph({
    ...run,
    selectedNodeId: view.selectedNodeId,
    showOutcomes: view.showOutcomes,
    nodeStates: view.nodeStates,
    takenEdges: node.takenEdges,
  });

  return { node, graph };
}

type RunVisualizationInput = Pick<
  RunVisualizationPanelProps,
  "runId" | "runStatus" | "definition" | "nodes" | "reason" | "onFrame"
>;

/** What the panel's reducer folds: an agent event from the stream, or the visit rows the page re-seeds it from when a node_status frame lands. */
type PanelAction = RunStreamEvent | { visitRows: readonly AssemblyRunNode[] };

function reducePanel(state: RunLiveState, action: PanelAction): RunLiveState {
  return "visitRows" in action
    ? withVisitRows(state, action.visitRows)
    : reduceRunEvent(state, action);
}

/** Re-seeds node status whenever the page hands the panel new visit rows (a `node_status` frame landed). */
function useVisitRowReseed(
  dispatch: (action: PanelAction) => void,
  visitRows: readonly AssemblyRunNode[],
): void {
  useEffect(() => dispatch({ visitRows }), [dispatch, visitRows]);
}

/** Where the run's events come from: the reducer that holds them and the stream (or its polling fallback) that feeds it. Seeded from the visit ROWS so a run opened long after the fact renders immediately, then folded forward by whatever the stream delivers — and re-seeded when the page hands it new rows. */
function useRunSources(
  run: RunFacts,
  runId: string,
  onFrame: RunVisualizationPanelProps["onFrame"],
) {
  const [state, dispatch] = useReducer(reducePanel, undefined, () =>
    initialRunState(run.definition, run.nodes),
  );

  useVisitRowReseed(dispatch, run.nodes);
  const { chipState } = useRunStream({
    runId,
    runStatus: run.runStatus,
    runIsLive: run.runIsLive,
    lastEventId: state.lastEventId ?? "0",
    dispatch,
    onFrame,
  });

  return { state, chipState };
}

function useRunVisualization(input: RunVisualizationInput) {
  const { runId, runStatus, definition, nodes, reason, onFrame } = input;
  const runIsLive = !isTerminalRunStatus(runStatus);
  const run: RunFacts = { nodes, definition, runStatus, runIsLive, reason };
  const toggles = useViewToggles();
  const { state, chipState } = useRunSources(run, runId, onFrame);
  const nodeAndGraph = useNodeAndGraph(run, {
    selectedNodeId: toggles.selectedNodeId,
    showOutcomes: toggles.showOutcomes,
    nodeStates: state.nodeStates,
  });

  return {
    ...toggles,
    ...nodeAndGraph,
    now: useNowTicker(runIsLive),
    state,
    chipState,
  };
}

type RunView = ReturnType<typeof useRunVisualization>;

interface RunGraphProps {
  view: RunView;
  definition: RunVisualizationPanelProps["definition"];
}

function RunGraph({ view, definition }: RunGraphProps) {
  return (
    <RunGraphSection
      chipState={view.chipState}
      graph={view.graph.visibleGraph}
      definition={definition}
      onSelectNode={view.setSelectedNodeId}
      hasRunData={view.graph.hasRunData}
      showOutcomes={view.showOutcomes}
      onToggleOutcomes={() => view.setShowOutcomes((shown) => !shown)}
    />
  );
}

/** Takes the run's own props as `page` rather than threading eight arguments: none of them is derived from the run, they are what the route already knew. */
type RunDetailPage = Pick<
  RunVisualizationPanelProps,
  "runId" | "repo" | "reason" | "definition" | "agentEditHrefs"
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
      fileTouches={view.state.fileTouches}
    />
  );
}

export default function RunVisualizationPanel(
  props: RunVisualizationPanelProps,
) {
  const view = useRunVisualization(props);

  return (
    <section className={styles.panel}>
      <RunGraph view={view} definition={props.definition} />
      <RunDetail view={view} page={props} />
    </section>
  );
}
