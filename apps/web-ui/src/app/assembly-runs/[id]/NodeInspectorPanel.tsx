"use client";

// The inspector beside the graph (run-viz FR4.14): everything about the selected node — detail card, brief, pod logs, transcript — or the hint to pick one. Prop-driven, no state or IO of its own (DDAU).
import Link from "next/link";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import type { NodeRunState } from "@/lib/run-event-reducer";
import type { NodeModel } from "@/lib/node-models";
import type { TaskRuntimeEvent } from "@/lib/task-runtime";
import FullTranscriptPanel from "./FullTranscriptPanel";
import NodeLogPanel from "./NodeLogPanel";
import NodeInputCard from "./NodeInputCard";
import RunNodeDetail from "./RunNodeDetail";
import { RerunNodeButton } from "./RerunNodeButton";
import { RunStationButton, type RunState } from "./RunStationButton";
import styles from "./RunVisualizationPanel.module.css";

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
  /** Whether this run may be run again from here: false for a run on the external floor, which only the floor can re-run. */
  runActions: boolean;
  /** Which engine walks the run; it decides what the node's pod logs can say. */
  engine?: string;
  /** Whether the run is still open; a station run then retires it first. */
  runState: RunState;
  agentEditHrefs?: Record<string, string>;
  nodeModels?: Record<string, NodeModel>;
  taskEvents?: readonly TaskRuntimeEvent[];
  /** The newest agent event the run's channel delivered; the transcript follows it. */
  liveEventId?: string;
  visibleNodeCount: number;
}

export type NodeInspectorPanelProps = SelectedNodeSectionProps;

export function NodeInspectorPanel(props: NodeInspectorPanelProps) {
  const { selectedNodeId } = props;

  if (selectedNodeId === null) {
    return <SelectionHint nodeCount={props.visibleNodeCount} />;
  }

  return (
    <>
      <NodeInspector {...inspectorPropsFor(props, selectedNodeId)} />
      <SelectedTranscript props={props} nodeId={selectedNodeId} />
    </>
  );
}

function SelectedTranscript({
  props,
  nodeId,
}: {
  props: SelectedNodeSectionProps;
  nodeId: string;
}) {
  return (
    // Keyed on the run so a run change resets the loaded transcript by construction, not by a flag someone has to remember to clear.
    <FullTranscriptPanel
      key={props.runId}
      runId={props.runId}
      nodeId={nodeId}
      taskEvents={props.taskEvents}
      rows={props.selectedRows}
      liveEventId={props.liveEventId}
      nodeStatus={props.selectedState?.status}
    />
  );
}

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
  runState: RunState;
  attempts: Parameters<typeof RunNodeDetail>[0]["attempts"];
  inputs: Parameters<typeof NodeInputCard>[0]["inputs"];
  retrySource: { nodeId: string; iteration: number } | null;
  runActions: boolean;
  engine?: string;
  agentEditHref?: string;
  model: NodeModel | null;
}

function NodeInspector(props: NodeInspectorProps) {
  const { nodeId, runId, rows } = props;

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
        model={props.model}
        actions={nodeActions(props)}
      />
      <NodeInputCard inputs={props.inputs} />
      <AttemptLogPanels runId={runId} rows={rows} engine={props.engine} />
    </section>
  );
}

/** Narrows the section's props down to the one selected node the inspector renders. */
function inspectorPropsFor(
  props: SelectedNodeSectionProps,
  nodeId: string,
): NodeInspectorProps {
  return {
    nodeId,
    ...pageFacts(props),
    state: props.selectedState ?? undefined,
    row: props.latestRows.get(nodeId),
    rows: props.selectedRows,
    attempts: props.selectedAttempts,
    inputs: props.nodeInputs,
    agentEditHref: props.agentEditHrefs?.[nodeId],
    model: props.nodeModels?.[nodeId] ?? null,
  };
}

// The facts every node shares: the run, its repo, its definition and its state.
function pageFacts(props: SelectedNodeSectionProps) {
  return {
    runId: props.runId,
    repo: props.repo,
    reason: props.reason,
    definition: props.definition,
    retrySource: props.retrySource,
    runActions: props.runActions,
    engine: props.engine,
    runState: props.runState,
  };
}

type RetrySource = { nodeId: string; iteration: number };

/** What a viewer can DO to this node: run it, retry from it when an exact fork exists, edit its agent. Every control sits inside a <summary>, so each stops propagation — without it the card toggles shut behind the click. */
function nodeActions({
  runId,
  nodeId,
  runState,
  retrySource,
  runActions,
  agentEditHref,
}: NodeInspectorProps): React.ReactNode {
  return (
    <>
      <EditAgentSlot href={agentEditHref} />
      <RerunSlot runId={runId} retrySource={retrySource} />
      {runActions && (
        <RunStationButton runId={runId} nodeId={nodeId} runState={runState} />
      )}
    </>
  );
}

/** One log panel per attempt that actually ran a pod. An attempt with no Agent CR name never reached a pod — a service-runtime node, or one that failed before dispatch — so there are no logs to offer, and an empty panel would read as logs that failed to load. */
interface AttemptLogPanelsProps {
  runId: string;
  rows: NodeInspectorProps["rows"];
  engine?: string;
}

function AttemptLogPanels({ runId, rows, engine }: AttemptLogPanelsProps) {
  return rows
    .filter((attempt) => attempt.agentCrName)
    .map((attempt) => (
      <NodeLogPanel
        key={attempt.agentCrName as string}
        assemblyLineId={runId}
        engine={engine}
        agentCrName={attempt.agentCrName as string}
        label={`Pod logs · attempt ${attempt.iteration}`}
      />
    ));
}

/** The link to this node's agent definition, absent when the node has no editable agent. */
function EditAgentSlot({ href }: { href: string | undefined }) {
  if (href === undefined) {
    return null;
  }

  return (
    <Link
      className="btn-secondary"
      href={href}
      onClick={(event) => event.stopPropagation()}
    >
      Edit agent
    </Link>
  );
}

/** The retry control, absent when no attempt of this node can be resumed from. */
function RerunSlot({
  runId,
  retrySource,
}: {
  runId: string;
  retrySource: RetrySource | null;
}) {
  if (retrySource === null) {
    return null;
  }

  return (
    <RerunNodeButton
      runId={runId}
      resumeNodeId={retrySource.nodeId}
      resumeIteration={retrySource.iteration}
    />
  );
}
