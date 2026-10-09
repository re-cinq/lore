"use client";

// The center column (run-viz FR4.1f): one attempt of the selected node at a time — the selector row, then its transcript OR its pod logs, then what it was started with. Prop-driven, no state or IO of its own (DDAU).
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import type { StepView } from "@/lib/step-presenter";
import type { TaskRuntimeEvent } from "@/lib/task-runtime";
import type { InspectorKind } from "@/lib/run-attempt-select";
import { AttemptSelectorRow } from "./AttemptSelectorRow";
import FullTranscriptPanel from "./FullTranscriptPanel";
import NodeLogPanel from "./NodeLogPanel";
import NodeInputCard, { type NodeInputView } from "./NodeInputCard";
import NodeNeedsCard from "./NodeNeedsCard";
import styles from "./RunVisualizationPanel.module.css";

export interface AttemptInspectorProps {
  runId: string;
  nodeId: string | null;
  /** Which engine walks the run; it decides what a missing pod means. */
  engine?: string;
  attempts: readonly StepView[];
  /** The attempt on show; null while no node is selected or the node has not run. */
  attempt: AssemblyRunNode | null;
  inputs: readonly NodeInputView[];
  taskEvents?: readonly TaskRuntimeEvent[];
  liveEventId?: string;
  kind: InspectorKind;
  onKindChange: (kind: InspectorKind) => void;
  onPickAttempt: (iteration: number) => void;
}

export function AttemptInspector(props: AttemptInspectorProps) {
  const { nodeId, attempt } = props;

  if (nodeId === null || attempt === null) {
    return null;
  }

  const shown: AttemptCardProps = { ...props, nodeId, attempt };

  return (
    <section className={styles.attempts} aria-label={`${nodeId} attempts`}>
      <AttemptSelectorRow
        kind={props.kind}
        onKindChange={props.onKindChange}
        attempts={props.attempts}
        selectedIteration={attempt.iteration}
        onAttemptChange={props.onPickAttempt}
      />
      <AttemptCard {...shown} />
      <AttemptStart {...shown} />
    </section>
  );
}

type AttemptCardProps = AttemptInspectorProps & {
  nodeId: string;
  attempt: AssemblyRunNode;
};

/** What the attempt was started with: the floor's bag for a floor visit, the recorded dispatch input for one of Lore's own. */
function AttemptStart({ runId, attempt, inputs }: AttemptCardProps) {
  return (
    <>
      <NodeNeedsCard
        runId={runId}
        needs={attempt.needs ?? null}
        iteration={attempt.iteration}
      />
      <NodeInputCard
        inputs={inputs.filter((input) => input.iteration === attempt.iteration)}
      />
    </>
  );
}

/** The one card the selector asks for. Keyed on the run so switching attempts refilters the transcript already walked rather than walking it again. */
function AttemptCard(props: AttemptCardProps) {
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

/** An attempt with no Agent CR name never reached a pod — a service station, or a visit that failed before dispatch — so there are no logs to offer, and an empty panel would read as logs that failed to load. */
function PodLogsCard({ runId, attempt, engine }: AttemptCardProps) {
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
