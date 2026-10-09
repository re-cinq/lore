"use client";

// The panel beside the graph (run-viz FR4.14): the selected node's detail card, or the hint to pick one. Prop-driven, no state or IO of its own (DDAU).
import Link from "next/link";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import type { NodeRunState } from "@/lib/run-event-reducer";
import type { NodeModel } from "@/lib/node-models";
import { isFloorEngine } from "@/lib/assembly-run-rows";
import RunNodeDetail from "./RunNodeDetail";
import { RunNodeButton } from "./RunNodeButton";
import styles from "./RunVisualizationPanel.module.css";

/** The selected node's detail — or the hint to pick one when nothing is selected. */
interface SelectedNodeSectionProps {
  selectedNodeId: string | null;
  runId: string;
  repo: string;
  reason: string | null;
  definition: AssemblyLineDefinition | null;
  selectedState: NodeRunState | null;
  latestRows: Map<string, AssemblyRunNode>;
  selectedAttempts: Parameters<typeof RunNodeDetail>[0]["attempts"];
  /** Which engine walks the run; a floor node can be run again from the card. */
  engine?: string;
  agentEditHrefs?: Record<string, string>;
  nodeModels?: Record<string, NodeModel>;
  visibleNodeCount: number;
  /** The attempt the center column shows, marked in the card's history. */
  selectedIteration?: number;
  onPickAttempt?: (iteration: number) => void;
}

export type NodeInspectorPanelProps = SelectedNodeSectionProps;

export function NodeInspectorPanel(props: NodeInspectorPanelProps) {
  const { selectedNodeId } = props;

  if (selectedNodeId === null) {
    return <SelectionHint nodeCount={props.visibleNodeCount} />;
  }

  return <NodeInspector {...inspectorPropsFor(props, selectedNodeId)} />;
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

/** Everything the panel shows about ONE selected node: its detail card with the actions in its header. */
interface NodeInspectorProps {
  nodeId: string;
  runId: string;
  repo: string;
  reason: string | null;
  definition: AssemblyLineDefinition | null;
  state: Parameters<typeof RunNodeDetail>[0]["state"];
  row: Parameters<typeof RunNodeDetail>[0]["row"];
  attempts: Parameters<typeof RunNodeDetail>[0]["attempts"];
  engine?: string;
  agentEditHref?: string;
  model: NodeModel | null;
  selectedIteration?: number;
  onPickAttempt?: (iteration: number) => void;
}

function NodeInspector(props: NodeInspectorProps) {
  const { nodeId } = props;

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
        selectedIteration={props.selectedIteration}
        onPickAttempt={props.onPickAttempt}
        actions={<NodeActions {...props} />}
      />
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
    attempts: props.selectedAttempts,
    agentEditHref: props.agentEditHrefs?.[nodeId],
    model: props.nodeModels?.[nodeId] ?? null,
    selectedIteration: props.selectedIteration,
    onPickAttempt: props.onPickAttempt,
  };
}

// The facts every node shares: the run, its repo, its definition and its state.
function pageFacts(props: SelectedNodeSectionProps) {
  return {
    runId: props.runId,
    repo: props.repo,
    reason: props.reason,
    definition: props.definition,
    engine: props.engine,
  };
}

/** The card header's actions: run the node again, and edit its agent. */
function NodeActions(props: NodeInspectorProps) {
  return (
    <>
      <RunNodeSlot {...props} />
      <EditAgentSlot href={props.agentEditHref} />
    </>
  );
}

/** "Run this station" on a floor run's node. The exit and fail nodes end the run, so they have no station to run. */
function RunNodeSlot({
  nodeId,
  runId,
  engine,
  definition,
}: NodeInspectorProps) {
  const endsRun = nodeId === definition?.exit || nodeId === definition?.fail;

  if (!isFloorEngine(engine) || endsRun) {
    return null;
  }

  return <RunNodeButton runId={runId} nodeId={nodeId} />;
}

/** The link to this node's agent definition, absent when the node has no editable agent. It sits inside a <summary>, so it stops propagation — without it the card toggles shut behind the click. */
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
