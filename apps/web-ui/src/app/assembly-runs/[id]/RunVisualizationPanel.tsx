"use client";

// The live-run container: owns every piece of mutable state and IO here so the sections below stay pure functions of props (DDAU / lore/no-io-in-view).
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import type { NodeModel } from "@/lib/node-models";
import type { TaskRuntimeEvent } from "@/lib/task-runtime";
import type { RunStreamFrame } from "@/lib/run-stream-types";
import styles from "./RunVisualizationPanel.module.css";
import { CenterColumn, SideColumn } from "./RunWorkbenchColumns";
import { useDiffDrawer } from "./use-diff-drawer";
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
  const drawer = useDiffDrawer();

  return (
    <section className={styles.panel}>
      <RunWorkbenchLayout
        graph={<RunGraph view={view} {...graphProps(props)} />}
        {...inspectorSlots({ view, page: props, focus, drawer })}
        sideWidth={side.width}
        onResizeSide={side.setWidth}
      />
    </section>
  );
}

/** What the workbench's two columns read: the run's view, the page's facts, the attempt in focus and the open diff. */
interface ColumnSources {
  view: RunView;
  page: RunVisualizationPanelProps;
  focus: InspectorFocus;
  drawer: ReturnType<typeof useDiffDrawer>;
}

/** The side column (detail card, then files touched) and the center column (open diff, then the attempt on show), both reading the same focus. */
function inspectorSlots(sources: ColumnSources) {
  return { side: sideSlot(sources), center: centerSlot(sources) };
}

function sideSlot({ view, page, focus, drawer }: ColumnSources) {
  return (
    <SideColumn
      inspector={{
        ...inspectorProps(view, page),
        selectedIteration: focus.attempt?.iteration,
        onPickAttempt: focus.pickAttempt,
      }}
      files={{
        touches: view.state.fileTouches,
        showAll: view.showAllFiles,
        onToggleShowAll: view.toggleShowAllFiles,
        onOpenFile: drawer.openDiff,
        activePath: drawer.openDiffPath,
      }}
    />
  );
}

function centerSlot({ view, page, focus, drawer }: ColumnSources) {
  return (
    <CenterColumn
      diff={{
        runId: page.runId,
        path: drawer.openDiffPath,
        prNumber: page.prNumber ?? null,
        onClose: drawer.closeDiff,
      }}
      attempts={attemptInspectorProps(inspectorProps(view, page), focus)}
    />
  );
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
