// The panel's derived view (run-viz FR4.14): the reducer the stream feeds, the click-or-automatic node selection, the graph and the facts line — every hook RunVisualizationPanel reads, kept apart from the markup it renders.
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import { autoSelectNodeId, effectiveSelection } from "@/lib/run-auto-select";
import {
  reduceRunEvent,
  initialRunState,
  withVisitRows,
  type RunLiveState,
} from "@/lib/run-event-reducer";
import { formatNodeMeta, nodeBadgeMeta } from "@/lib/run-node-badge";
import { latestRowByNode } from "@/lib/run-replay-view";
import type { RunStreamEvent } from "@/lib/run-stream-types";
import { isTerminalRunStatus } from "@/lib/run-stream-presenter";
import { useRunStream } from "./use-run-history";
import {
  useNowTicker,
  useRunGraph,
  useSelectedNode,
} from "./run-visualization-hooks";
import type { RunVisualizationPanelProps } from "./RunVisualizationPanel";

type RunVisualizationInput = Pick<
  RunVisualizationPanelProps,
  "runId" | "runStatus" | "definition" | "nodes" | "reason" | "onFrame"
>;

export function useRunVisualization(
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

export type RunView = ReturnType<typeof useRunVisualization>;

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
