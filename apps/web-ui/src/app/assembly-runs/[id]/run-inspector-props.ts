import { isFloorEngine } from "@/lib/assembly-run-rows";
import type { RunLiveState } from "@/lib/run-event-reducer";
import type { RunVisualizationPanelProps } from "./RunVisualizationPanel";
import { runStateOf } from "./RunStationButton";
import type { useRunGraph, useSelectedNode } from "./run-visualization-hooks";
import { transcriptFeed } from "./run-visualization-selectors";

/** Takes the run's own props as `page` rather than threading eight arguments: none of them is derived from the run, they are what the route already knew. */
export type RunDetailPage = Pick<
  RunVisualizationPanelProps,
  | "runId"
  | "runStatus"
  | "repo"
  | "reason"
  | "definition"
  | "agentEditHrefs"
  | "nodeModels"
  | "taskEvents"
  | "engine"
>;

interface InspectorView {
  selectedNodeId: string | null;
  state: RunLiveState;
  graph: ReturnType<typeof useRunGraph>;
  node: ReturnType<typeof useSelectedNode>;
}

/** The inspector's plain values — the page's own facts and the view's derivations, flattened into one bundle because the panel reads them as a flat prop list. */
export function inspectorProps(view: InspectorView, page: RunDetailPage) {
  return {
    ...pageFacts(page),
    ...viewFacts(view, page.engine),
    ...transcriptFeed(view.state, page.taskEvents),
  };
}

function pageFacts(page: RunDetailPage) {
  return {
    runId: page.runId,
    repo: page.repo,
    reason: page.reason,
    definition: page.definition,
    engine: page.engine,
    runState: runStateOf(page.runStatus),
    agentEditHrefs: page.agentEditHrefs,
    nodeModels: page.nodeModels,
  };
}

function viewFacts(view: InspectorView, engine: string | undefined) {
  const onFloor = isFloorEngine(engine);
  const { nodes } = view.graph.visibleGraph;

  return {
    selectedNodeId: view.selectedNodeId,
    latestRows: view.graph.latestRows,
    selectedRows: view.node.selectedRows,
    selectedAttempts: view.node.selectedAttempts,
    nodeInputs: view.node.nodeInputs,
    retrySource: onFloor ? null : view.graph.retrySource,
    runActions: !onFloor,
    selectedState: view.node.selected,
    visibleNodeCount: nodes.length,
  };
}
