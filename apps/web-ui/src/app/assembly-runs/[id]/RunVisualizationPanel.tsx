"use client";

// The live-run container: owns every piece of mutable state and IO here so the sections below stay pure functions of props (DDAU / lore/no-io-in-view).
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import type { NodeModel } from "@/lib/node-models";
import type { TaskRuntimeEvent } from "@/lib/task-runtime";
import type { RunStreamFrame } from "@/lib/run-stream-types";
import styles from "./RunVisualizationPanel.module.css";
import { RunFilesSection } from "./RunFilesSection";
import { NodeInspectorPanel } from "./NodeInspectorPanel";
import { AttemptInspector } from "./AttemptInspector";
import { attemptInspectorProps, inspectorProps } from "./run-inspector-props";
import { RunGraphSection } from "./RunGraphSection";
import { RunWorkbenchLayout } from "./RunWorkbenchLayout";
import { useInspectorFocus, type InspectorFocus } from "./use-inspector-focus";
import { useResizablePanelWidth } from "./use-resizable-panel-width";
import { useRunVisualization, type RunView } from "./use-run-visualization";

export interface RunVisualizationPanelProps {
  runId: string;
  runStatus: string;
  definition: AssemblyLineDefinition | null;
  nodes: readonly AssemblyRunNode[];
  repo: string;
  reason: string | null;
  /** How the run ended, for the chip; null while it runs. Optional so a page that predates it reads as still unknown. */
  runOutcome?: string | null;
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
  /** Which engine walks the run; a node of a run on the external floor can be run again from here. */
  engine?: string;
}

export default function RunVisualizationPanel(
  props: RunVisualizationPanelProps,
) {
  const view = useRunVisualization(props, props.nodeModels);
  const focus = useInspectorFocus(view.selectedNodeId, view.node.selectedRows);
  const side = useResizablePanelWidth();

  return (
    <section className={styles.panel}>
      <RunWorkbenchLayout
        graph={<RunGraph view={view} {...graphProps(props)} />}
        {...inspectorSlots(view, props, focus)}
        below={<RunFilesSection {...filesProps(view, props)} />}
        sideWidth={side.width}
        onResizeSide={side.setWidth}
      />
    </section>
  );
}

/** The two columns about the selected node: its detail card at the side, its attempts in the center, both reading the same focus. */
function inspectorSlots(
  view: RunView,
  page: RunVisualizationPanelProps,
  focus: InspectorFocus,
) {
  const inspector = inspectorProps(view, page);

  return {
    side: (
      <NodeInspectorPanel
        {...inspector}
        selectedIteration={focus.attempt?.iteration}
        onPickAttempt={focus.pickAttempt}
      />
    ),
    center: <AttemptInspector {...attemptInspectorProps(inspector, focus)} />,
  };
}

/** The run facts the graph section shows beside the view: the definition, how the run ended, and why it is where it is. */
function graphProps(props: RunVisualizationPanelProps) {
  return {
    definition: props.definition,
    runOutcome: props.runOutcome ?? null,
    reason: props.reason,
  };
}

interface RunGraphProps {
  view: RunView;
  definition: RunVisualizationPanelProps["definition"];
  runOutcome: string | null;
  reason: string | null;
}

function RunGraph({ view, definition, runOutcome, reason }: RunGraphProps) {
  return (
    <RunGraphSection
      chipState={view.chipState}
      runOutcome={runOutcome}
      reason={reason}
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
