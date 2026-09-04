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
function NodeInspector({
  nodeId,
  runId,
  repo,
  reason,
  definition,
  state,
  row,
  rows,
  attempts,
  inputs,
  retrySource,
  agentEditHref,
}: {
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
}) {
  const actions =
    retrySource !== null || agentEditHref !== undefined ? (
      <>
        {agentEditHref !== undefined ? (
          // Inside a <summary>: without stopPropagation the card would also toggle shut behind the navigation.
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
    ) : undefined;

  return (
    <section className={styles.inspector} aria-label={`${nodeId} inspector`}>
      <RunNodeDetail
        nodeId={nodeId}
        state={state}
        row={row}
        definition={definition}
        reason={reason}
        repo={repo}
        attempts={attempts}
        actions={actions}
      />
      <NodeInputCard inputs={inputs} />
      {rows
        .filter((attempt) => attempt.agentCrName)
        .map((attempt) => (
          <NodeLogPanel
            key={attempt.agentCrName as string}
            assemblyLineId={runId}
            agentCrName={attempt.agentCrName as string}
            label={`Pod logs · attempt ${attempt.iteration}`}
          />
        ))}
    </section>
  );
}

/** Everything shown about the currently selected node — or the hint to pick one when nothing is selected. */
export function SelectedNodeSection({
  selectedNodeId,
  runId,
  repo,
  reason,
  definition,
  selectedState,
  latestRows,
  selectedRows,
  selectedAttempts,
  nodeInputs,
  retrySource,
  agentEditHrefs,
  visibleNodeCount,
}: {
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
}) {
  if (selectedNodeId === null) {
    return <SelectionHint nodeCount={visibleNodeCount} />;
  }

  return (
    <>
      <NodeInspector
        nodeId={selectedNodeId}
        runId={runId}
        repo={repo}
        reason={reason}
        definition={definition}
        state={selectedState ?? undefined}
        row={latestRows.get(selectedNodeId)}
        rows={selectedRows}
        attempts={selectedAttempts}
        inputs={nodeInputs}
        retrySource={retrySource}
        agentEditHref={agentEditHrefs?.[selectedNodeId]}
      />
      {/* Keyed on the run so a run change resets the loaded transcript by construction, not by a flag someone has to remember to clear. */}
      <FullTranscriptPanel key={runId} runId={runId} nodeId={selectedNodeId} />
    </>
  );
}

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
}: Parameters<typeof SelectedNodeSection>[0] & {
  timeline: ReturnType<typeof initialRunState>["timeline"];
  fileTouches: ReturnType<typeof initialRunState>["fileTouches"];
  startedAt: string | null;
  now: string;
  onSeek: ((id: string) => void) | undefined;
  showAllFiles: boolean;
  toggleShowAllFiles: () => void;
}) {
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
