"use client";

// The live-run container: owns every piece of mutable state and IO here so the sections below stay pure functions of props (DDAU / lore/no-io-in-view).
import type { ReactNode } from "react";
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
import {
  useFocusAttempt,
  useInspectorFocus,
  type InspectorFocus,
} from "./use-inspector-focus";
import { RunFocusContext, type FocusAttempt } from "./run-focus-context";
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
  /** The page's header, drawn above the graph. Handed in because the page owns the live run it reads. */
  header?: ReactNode;
  /** Everything about the run itself, drawn under the graph: its facts, the issue it works on, its definition of done and its options. */
  runDetails?: ReactNode;
  /** The task's cost table or the note that the run has none, drawn after the attempt. */
  taskContext?: ReactNode;
}

export default function RunVisualizationPanel(
  props: RunVisualizationPanelProps,
) {
  const view = useRunVisualization(props, props.nodeModels);
  const focus = useInspectorFocus(view.selectedNodeId, view.node.selectedRows);
  const side = useResizablePanelWidth();
  const drawer = useDiffDrawer();

  return (
    <FocusProvider
      focusAttempt={useFocusAttempt(view.setSelectedNodeId, focus)}
    >
      <RunWorkbenchLayout
        graph={<GraphWithHeader view={view} {...graphProps(props)} />}
        {...inspectorSlots({ view, page: props, focus, drawer })}
        sideWidth={side.width}
        onResizeSide={side.setWidth}
      />
    </FocusProvider>
  );
}

/** The panel's section, telling the cards inside it how to show one attempt of a node (run-viz FR4.4n). */
function FocusProvider({
  focusAttempt,
  children,
}: {
  focusAttempt: FocusAttempt;
  children: ReactNode;
}) {
  return (
    <RunFocusContext.Provider value={focusAttempt}>
      <section className={styles.panel}>{children}</section>
    </RunFocusContext.Provider>
  );
}

/** What the workbench's two columns read: the run's view, the page's facts, the attempt in focus and the open diff. */
interface ColumnSources {
  view: RunView;
  page: RunVisualizationPanelProps;
  inspector: ReturnType<typeof inspectorProps>;
  focus: InspectorFocus;
  drawer: ReturnType<typeof useDiffDrawer>;
}

/** The side column (detail card, then files touched) and the center column (open diff, then the attempt on show), both reading the same focus. */
function inspectorSlots(sources: Omit<ColumnSources, "inspector">) {
  const withInspector = {
    ...sources,
    inspector: inspectorProps(sources.view, sources.page),
  };

  return { side: sideSlot(withInspector), center: centerSlot(withInspector) };
}

function sideSlot({ view, inspector, focus, drawer }: ColumnSources) {
  return (
    <SideColumn
      inspector={{
        ...inspector,
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

function centerSlot({ page, inspector, focus, drawer }: ColumnSources) {
  return (
    <CenterColumn
      runDetails={page.runDetails}
      taskContext={page.taskContext}
      diff={{
        runId: page.runId,
        path: drawer.openDiffPath,
        prNumber: page.prNumber ?? null,
        onClose: drawer.closeDiff,
      }}
      attempts={attemptInspectorProps(inspector, focus)}
    />
  );
}

/** The run facts the graph section shows beside the view: the definition, how the run ended, and why it is where it is. */
function graphProps(props: RunVisualizationPanelProps) {
  return {
    header: props.header,
    definition: props.definition,
    runOutcome: props.runOutcome ?? null,
    reason: props.reason,
  };
}

interface RunGraphProps {
  view: RunView;
  /** The page's header, above the graph it introduces. */
  header?: ReactNode;
  definition: RunVisualizationPanelProps["definition"];
  runOutcome: string | null;
  reason: string | null;
}

/** The page's header and, under it, the graph it introduces. */
function GraphWithHeader({ header, ...graph }: RunGraphProps) {
  return (
    <>
      {header}
      <RunGraph {...graph} />
    </>
  );
}

function RunGraph({ view, ...facts }: Omit<RunGraphProps, "header">) {
  return (
    <RunGraphSection
      chipState={view.chipState}
      runOutcome={facts.runOutcome}
      reason={facts.reason}
      graph={view.graph.visibleGraph}
      definition={facts.definition}
      onSelectNode={view.setSelectedNodeId}
      selectedNodeId={view.selectedNodeId}
      nodeMeta={view.nodeMeta}
      hasRunData={view.graph.hasRunData}
      showOutcomes={view.showOutcomes}
      onToggleOutcomes={() => view.setShowOutcomes((shown) => !shown)}
    />
  );
}
