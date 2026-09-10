"use client";

// The live-run container: owns every piece of mutable state and IO here so the sections below stay pure functions of props (DDAU / lore/no-io-in-view).
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import type { NodeModel } from "@/lib/node-models";
import type { TaskRuntimeEvent } from "@/lib/task-runtime";
import { autoSelectNodeId, effectiveSelection } from "@/lib/run-auto-select";
import {
  reduceRunEvent,
  initialRunState,
  withVisitRows,
  type RunLiveState,
} from "@/lib/run-event-reducer";
import { formatNodeMeta, nodeBadgeMeta } from "@/lib/run-node-badge";
import { latestRowByNode } from "@/lib/run-replay-view";
import type { RunStreamEvent, RunStreamFrame } from "@/lib/run-stream-types";
import styles from "./RunVisualizationPanel.module.css";
import { isTerminalRunStatus } from "@/lib/run-stream-presenter";
import { useRunStream } from "./use-run-history";
import {
  useNowTicker,
  useRunGraph,
  useSelectedNode,
} from "./run-visualization-hooks";
import { RunFilesSection } from "./RunFilesSection";
import { NodeInspectorPanel } from "./NodeInspectorPanel";
import { RunGraphSection } from "./RunGraphSection";
import { RunWorkbenchLayout } from "./RunWorkbenchLayout";

export interface RunVisualizationPanelProps {
  runId: string;
  runStatus: string;
  definition: AssemblyLineDefinition | null;
  nodes: readonly AssemblyRunNode[];
  repo: string;
  reason: string | null;
  // nodeId → agents-editor href for each agent node the catalog holds; resolved server-side, the panel only renders what it is handed.
  agentEditHrefs?: Record<string, string>;
  /** nodeId → the model an agent node runs on, resolved server-side against the catalog. */
  nodeModels?: Record<string, NodeModel>;
  /** The task's status transitions, folded into the selected node's transcript. */
  taskEvents?: readonly TaskRuntimeEvent[];
  /** The page's fold for the stream's state families; the panel owns the socket, the page owns run/node/task state. */
  onFrame?: (frame: RunStreamFrame) => void;
  /** The run's pull request, which the per-file diff drawer reads; null when the run opened none. */
  prNumber?: number | null;
}

export default function RunVisualizationPanel(
  props: RunVisualizationPanelProps,
) {
  const view = useRunVisualization(props, props.nodeModels);

  return (
    <section className={styles.panel}>
      <RunWorkbenchLayout
        graph={<RunGraph view={view} definition={props.definition} />}
        inspector={<NodeInspectorPanel {...inspectorProps(view, props)} />}
        below={<RunFilesSection {...filesProps(view, props)} />}
      />
    </section>
  );
}

type RunVisualizationInput = Pick<
  RunVisualizationPanelProps,
  "runId" | "runStatus" | "definition" | "nodes" | "reason" | "onFrame"
>;

function useRunVisualization(
  input: RunVisualizationInput,
  nodeModels: RunVisualizationPanelProps["nodeModels"],
) {
  const focus = useRunFocus(input);
  const { run, toggles, sources, selectedNodeId } = focus;
  const nodeAndGraph = useNodeAndGraph(run, {
    selectedNodeId,
    showOutcomes: toggles.showOutcomes,
    nodeStates: sources.state.nodeStates,
  });

  return {
    ...toggles,
    ...nodeAndGraph,
    ...sources,
    ...useNodeMetaLine(focus, nodeModels),
    selectedNodeId,
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
      selectedNodeId={view.selectedNodeId}
      nodeMeta={view.nodeMeta}
      hasRunData={view.graph.hasRunData}
      showOutcomes={view.showOutcomes}
      onToggleOutcomes={() => view.setShowOutcomes((shown) => !shown)}
    />
  );
}

/** Takes the run's own props as `page` rather than threading eight arguments: none of them is derived from the run, they are what the route already knew. */
type RunDetailPage = Pick<
  RunVisualizationPanelProps,
  | "runId"
  | "repo"
  | "reason"
  | "definition"
  | "agentEditHrefs"
  | "nodeModels"
  | "taskEvents"
>;

/** The inspector's plain values — the page's own facts and the view's derivations, flattened into one bundle because the panel reads them as a flat prop list. */
function inspectorProps(view: RunView, page: RunDetailPage) {
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
    nodeModels: page.nodeModels,
    taskEvents: page.taskEvents,
    selectedState: view.node.selected,
    visibleNodeCount: visibleNodeCount(view),
  };
}

/** The files strip's plain values: the touches the reducer folded and the run the drawer reads diffs for. */
function filesProps(view: RunView, page: RunVisualizationPanelProps) {
  return {
    touches: view.state.fileTouches,
    showAll: view.showAllFiles,
    onToggleShowAll: view.toggleShowAllFiles,
    runId: page.runId,
    prNumber: page.prNumber ?? null,
  };
}

/** The run's state and the node in focus: the reducer, the rows, the click-or-automatic selection. */
function useRunFocus(input: RunVisualizationInput) {
  const { runId, runStatus, definition, nodes, reason, onFrame } = input;
  const runIsLive = !isTerminalRunStatus(runStatus);
  const run: RunFacts = { nodes, definition, runStatus, runIsLive, reason };
  const toggles = useViewToggles();
  const sources = useRunSources(run, runId, onFrame);
  const latestRows = useLatestRows(nodes);
  const selectedNodeId = useSelection(
    run,
    sources.state,
    toggles.selectedNodeId,
    latestRows,
  );

  return { run, toggles, sources, latestRows, selectedNodeId };
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

/** The ticking clock and the facts line it feeds. */
function useNodeMetaLine(
  focus: ReturnType<typeof useRunFocus>,
  nodeModels: RunVisualizationPanelProps["nodeModels"],
) {
  const now = useNowTicker({ live: focus.run.runIsLive });
  const nodeMeta = useNodeMeta(
    focus.sources.state,
    focus.latestRows,
    nodeModels,
    now,
  );

  return { now, nodeMeta };
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
  nodeStates: RunLiveState["nodeStates"];
}

/** What the panel's reducer folds: an agent event from the stream, or the visit rows the page re-seeds it from when a node_status frame lands. */
type PanelAction = RunStreamEvent | { visitRows: readonly AssemblyRunNode[] };

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

/** Newest row per node, memoized on the rows themselves so the selection and the facts line share one map. */
function useLatestRows(nodes: readonly AssemblyRunNode[]) {
  return useMemo(() => latestRowByNode(nodes), [nodes]);
}

/** The node the inspector shows: the viewer's click while it names a node the graph has, else the automatic choice (running → failed → last finished). */
function useSelection(
  run: RunFacts,
  state: RunLiveState,
  userPick: string | null,
  latestRows: Map<string, AssemblyRunNode>,
): string | null {
  return useMemo(() => {
    const known = new Set([
      ...(run.definition?.nodes ?? []).map((node) => node.id),
      ...Object.keys(state.nodeStates),
    ]);
    const auto = autoSelectNodeId(run.definition, state.nodeStates, latestRows);

    return effectiveSelection(userPick, auto, known);
  }, [run.definition, state.nodeStates, userPick, latestRows]);
}

/** The facts line for every node the run knows. */
function useNodeMeta(
  state: RunLiveState,
  latestRows: Map<string, AssemblyRunNode>,
  nodeModels: RunVisualizationPanelProps["nodeModels"],
  now: string,
): Record<string, string> {
  return useMemo(() => {
    const ids = new Set([
      ...Object.keys(state.nodeStates),
      ...latestRows.keys(),
    ]);

    const sources = { state, latestRows, models: nodeModels, now };

    return Object.fromEntries(
      [...ids].map((id) => [id, metaLineFor(id, sources)]),
    );
  }, [state, latestRows, nodeModels, now]);
}

function visibleNodeCount(view: RunView): number {
  const { visibleGraph } = view.graph;

  return visibleGraph.nodes.length;
}

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

/** What every node's facts line is read from. */
interface MetaSources {
  state: RunLiveState;
  latestRows: Map<string, AssemblyRunNode>;
  models: RunVisualizationPanelProps["nodeModels"];
  now: string;
}

/** One node's facts line: model · duration · visits, as the graph draws it. */
function metaLineFor(id: string, sources: MetaSources): string {
  const { state, latestRows, models, now } = sources;

  return formatNodeMeta(
    nodeBadgeMeta({
      row: latestRows.get(id),
      state: state.nodeStates[id],
      model: models?.[id],
      now,
    }),
  );
}
