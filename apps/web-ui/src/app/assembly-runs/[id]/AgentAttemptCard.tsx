"use client";

// An agent attempt's record (run-viz FR4.1f): its transcript or its pod's logs, whichever the Show select asks for. Only an agent leaves either.
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import type { TaskRuntimeEvent } from "@/lib/task-runtime";
import type { InspectorKind } from "@/lib/run-attempt-select";
import FullTranscriptPanel from "./FullTranscriptPanel";
import NodeLogPanel from "./NodeLogPanel";
import styles from "./RunVisualizationPanel.module.css";

export interface AgentAttemptCardProps {
  runId: string;
  nodeId: string;
  attempt: AssemblyRunNode;
  kind: InspectorKind;
  engine?: string;
  taskEvents?: readonly TaskRuntimeEvent[];
  liveEventId?: string;
}

/** The one card the selector asks for. Keyed on the run so switching attempts refilters the transcript already walked rather than walking it again. */
export default function AgentAttemptCard(props: AgentAttemptCardProps) {
  const { runId, nodeId, attempt, kind } = props;

  if (kind === "transcript") {
    return (
      <FullTranscriptPanel
        key={runId}
        runId={runId}
        nodeId={nodeId}
        iteration={attempt.iteration}
        taskEvents={props.taskEvents}
        rows={[attempt]}
        liveEventId={props.liveEventId}
      />
    );
  }

  return <PodLogsCard {...props} />;
}

/** An agent attempt with no pod name never reached a pod — it failed before dispatch — so there are no logs to offer, and an empty panel would read as logs that failed to load. */
function PodLogsCard({ runId, attempt, engine }: AgentAttemptCardProps) {
  if (!attempt.agentCrName) {
    return (
      <p className={`meta ${styles.hint}`}>
        Attempt {attempt.iteration} never reached a pod, so it has no logs.
      </p>
    );
  }

  return (
    <NodeLogPanel
      key={attempt.agentCrName}
      assemblyLineId={runId}
      engine={engine}
      agentCrName={attempt.agentCrName}
      label={`Pod logs · attempt ${attempt.iteration}`}
      defaultOpen
    />
  );
}
