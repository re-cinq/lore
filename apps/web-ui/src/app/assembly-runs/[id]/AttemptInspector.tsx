"use client";

// The center column (run-viz FR4.1f, FR4.1i): one attempt of the selected node at a time, and what that attempt can show depends on the kind of station that ran it. Prop-driven, no state or IO of its own (DDAU).
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import type { StepView } from "@/lib/step-presenter";
import type { TaskRuntimeEvent } from "@/lib/task-runtime";
import type { InspectorKind } from "@/lib/run-attempt-select";
import { attemptSections, type AttemptSections } from "@/lib/attempt-sections";
import { typeFamilyOf } from "@/lib/node-type-family";
import AgentAttemptCard from "./AgentAttemptCard";
import { AttemptSelectorRow } from "./AttemptSelectorRow";
import HumanVisitCard from "./HumanVisitCard";
import NodeEventsCard from "./NodeEventsCard";
import NodeInputCard, { type NodeInputView } from "./NodeInputCard";
import NodeModelCallsCard from "./NodeModelCallsCard";
import NodeNeedsCard from "./NodeNeedsCard";
import NodeOutcomeCard from "./NodeOutcomeCard";
import VisitTimingCard from "./VisitTimingCard";
import styles from "./RunVisualizationPanel.module.css";

export interface AttemptInspectorProps {
  runId: string;
  nodeId: string | null;
  /** The selected node's declared type; its family decides what an attempt can show. */
  nodeType?: string;
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
  const sections = attemptSections(typeFamilyOf(props.nodeType), attempt);
  const shown: ShownAttempt = { ...props, nodeId, attempt, sections };

  return (
    <section className={styles.attempts} aria-label={`${nodeId} attempts`}>
      <AttemptChoice {...shown} />
      <AttemptRecord {...shown} />
      <AttemptOutputs {...shown} />
      <AttemptStart {...shown} />
    </section>
  );
}

type ShownAttempt = AttemptInspectorProps & {
  nodeId: string;
  attempt: AssemblyRunNode;
  sections: AttemptSections;
};

/** The attempt select, and the Show select only where there is a transcript or a log to choose between. */
function AttemptChoice({ sections, ...props }: ShownAttempt) {
  const showChoice = sections.showSelect
    ? { kind: props.kind, onKindChange: props.onKindChange }
    : {};

  return (
    <AttemptSelectorRow
      {...showChoice}
      attempts={props.attempts}
      selectedIteration={props.attempt.iteration}
      onAttemptChange={props.onPickAttempt}
    />
  );
}

/** What happened in the attempt: an agent's transcript or logs, a service's or marker's outcome, a person's answer, and when. */
function AttemptRecord(props: ShownAttempt) {
  const { sections, attempt } = props;

  return (
    <>
      {sections.transcript ? <AgentAttemptCard {...props} /> : null}
      {sections.outcome ? <NodeOutcomeCard attempt={attempt} /> : null}
      {sections.human ? (
        <HumanVisitCard attempt={attempt} nodeType={props.nodeType} />
      ) : null}
      {sections.timing ? <VisitTimingCard attempt={attempt} /> : null}
    </>
  );
}

/** What the attempt made and set off: what it produced, the models it called, the events it handled and raised. */
function AttemptOutputs({ runId, attempt, sections }: ShownAttempt) {
  return (
    <>
      {sections.produced ? (
        <NodeNeedsCard
          runId={runId}
          title="Produced"
          needs={attempt.produced ?? null}
          iteration={attempt.iteration}
        />
      ) : null}
      {sections.modelCalls ? (
        <NodeModelCallsCard runId={runId} attempt={attempt} />
      ) : null}
      {sections.events ? (
        <NodeEventsCard runId={runId} attempt={attempt} />
      ) : null}
    </>
  );
}

/** What the attempt was started with: the floor's bag for a floor visit, the recorded dispatch input for one of Lore's own. */
function AttemptStart({ runId, attempt, inputs, sections }: ShownAttempt) {
  return (
    <>
      {sections.needs ? (
        <NodeNeedsCard
          runId={runId}
          needs={attempt.needs ?? null}
          iteration={attempt.iteration}
        />
      ) : null}
      {sections.input ? (
        <NodeInputCard
          inputs={inputs.filter(
            (input) => input.iteration === attempt.iteration,
          )}
        />
      ) : null}
    </>
  );
}
