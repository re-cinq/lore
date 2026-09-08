"use client";

// The detail half of RunVisualizationPanel: the selected node's inspector, timeline, and file heatmap. Prop-driven, no state or IO of its own (DDAU).
import Link from "next/link";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import { initialRunState, type NodeRunState } from "@/lib/run-event-reducer";
import FileHeatmapView from "./FileHeatmapView";
import FullTranscriptPanel from "./FullTranscriptPanel";
import NodeLogPanel from "./NodeLogPanel";
import NodeInputCard from "./NodeInputCard";
import RunNodeDetail from "./RunNodeDetail";
import RunTimelineView from "./RunTimelineView";
import { RerunNodeButton } from "./RerunNodeButton";
import styles from "./RunVisualizationPanel.module.css";

/** What to say when nothing is selected: how to inspect a node, or that there is nothing to inspect. */
function SelectionHint({ nodeCount }: { nodeCount: number }) {
  return (
    <p className={styles.hint}>
      {nodeCount > 0
        ? "Select a node in the graph to inspect its detail, transcript, and pod logs."
        : "No node executions recorded."}
    </p>
  );
}

/** Everything the panel shows about ONE selected node: its detail card, what the visit was given, and a pod-log panel per attempt that produced a CR. */
interface NodeInspectorProps {
  nodeId: string;
  runId: string;
  repo: string;
  reason: string | null;
  definition: AssemblyLineDefinition | null;
  state: Parameters<typeof RunNodeDetail>[0]["state"];
  row: Parameters<typeof RunNodeDetail>[0]["row"];
  rows: readonly AssemblyRunNode[];
  attempts: Parameters<typeof RunNodeDetail>[0]["attempts"];
  inputs: Parameters<typeof NodeInputCard>[0]["inputs"];
  retrySource: { nodeId: string; iteration: number } | null;
  agentEditHref?: string;
}

/** What a viewer can DO to this node. Both controls sit inside a <summary>, so each stops propagation — without it the card toggles shut behind the click. Returns undefined when there is nothing to offer, so the detail card renders no empty action row. */
function nodeActions(
  runId: string,
  retrySource: { nodeId: string; iteration: number } | null,
  agentEditHref: string | undefined,
): React.ReactNode {
  if (retrySource === null && agentEditHref === undefined) {
    return undefined;
  }

  return (
    <>
      {agentEditHref !== undefined ? (
        <Link
          className="btn-secondary"
          href={agentEditHref}
          onClick={(event) => event.stopPropagation()}
        >
          Edit agent
        </Link>
      ) : null}
      {retrySource !== null ? (
        <RerunNodeButton
          runId={runId}
          resumeNodeId={retrySource.nodeId}
          resumeIteration={retrySource.iteration}
        />
      ) : null}
    </>
  );
}

/** One log panel per attempt that actually ran a pod. An attempt with no Agent CR name never reached a pod — a service-runtime node, or one that failed before dispatch — so there are no logs to offer, and an empty panel would read as logs that failed to load. */
function AttemptLogPanels({
  runId,
  rows,
}: {
  runId: string;
  rows: NodeInspectorProps["rows"];
}) {
  return rows
    .filter((attempt) => attempt.agentCrName)
    .map((attempt) => (
      <NodeLogPanel
        key={attempt.agentCrName as string}
        assemblyLineId={runId}
        agentCrName={attempt.agentCrName as string}
        label={`Pod logs · attempt ${attempt.iteration}`}
      />
    ));
}

function NodeInspector(props: NodeInspectorProps) {
  const { nodeId, runId, rows, retrySource, agentEditHref } = props;

  return (
    <section className={styles.inspector} aria-label={`${nodeId} inspector`}>
      <RunNodeDetail
        nodeId={nodeId}
        state={props.state}
        row={props.row}
        definition={props.definition}
        reason={props.reason}
        repo={props.repo}
        attempts={props.attempts}
        actions={nodeActions(runId, retrySource, agentEditHref)}
      />
      <NodeInputCard inputs={props.inputs} />
      <AttemptLogPanels runId={runId} rows={rows} />
    </section>
  );
}

/** Everything shown about the currently selected node — or the hint to pick one when nothing is selected. */
interface SelectedNodeSectionProps {
  selectedNodeId: string | null;
  runId: string;
  repo: string;
  reason: string | null;
  definition: AssemblyLineDefinition | null;
  selectedState: NodeRunState | null;
  latestRows: Map<string, AssemblyRunNode>;
  selectedRows: readonly AssemblyRunNode[];
  selectedAttempts: Parameters<typeof RunNodeDetail>[0]["attempts"];
  nodeInputs: Parameters<typeof NodeInputCard>[0]["inputs"];
  retrySource: { nodeId: string; iteration: number } | null;
  agentEditHrefs?: Record<string, string>;
  visibleNodeCount: number;
}

export function SelectedNodeSection(props: SelectedNodeSectionProps) {
  const { selectedNodeId, runId } = props;

  if (selectedNodeId === null) {
    return <SelectionHint nodeCount={props.visibleNodeCount} />;
  }

  return (
    <>
      <NodeInspector
        nodeId={selectedNodeId}
        runId={runId}
        repo={props.repo}
        reason={props.reason}
        definition={props.definition}
        state={props.selectedState ?? undefined}
        row={props.latestRows.get(selectedNodeId)}
        rows={props.selectedRows}
        attempts={props.selectedAttempts}
        inputs={props.nodeInputs}
        retrySource={props.retrySource}
        agentEditHref={props.agentEditHrefs?.[selectedNodeId]}
      />
      {/* Keyed on the run so a run change resets the loaded transcript by construction, not by a flag someone has to remember to clear. */}
      <FullTranscriptPanel key={runId} runId={runId} nodeId={selectedNodeId} />
    </>
  );
}

type RunDetailSectionProps = SelectedNodeSectionProps & {
  timeline: ReturnType<typeof initialRunState>["timeline"];
  fileTouches: ReturnType<typeof initialRunState>["fileTouches"];
  startedAt: string | null;
  now: string;
  onSeek: ((id: string) => void) | undefined;
  showAllFiles: boolean;
  toggleShowAllFiles: () => void;
};

/** Everything below the graph: the selected node's inspector, the timeline, and the file heatmap. */
export function RunDetailSection({
  timeline,
  fileTouches,
  startedAt,
  now,
  onSeek,
  showAllFiles,
  toggleShowAllFiles,
  ...inspector
}: RunDetailSectionProps) {
  return (
    <>
      <SelectedNodeSection {...inspector} />
      <RunTimelineView
        ticks={timeline}
        runStartedAt={startedAt}
        now={now}
        onSeek={onSeek}
      />
      <FileHeatmapView
        touches={fileTouches}
        showAll={showAllFiles}
        onToggleShowAll={toggleShowAllFiles}
      />
    </>
  );
}
