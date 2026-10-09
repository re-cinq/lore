// The center column's two choices (run-viz FR4.1f): what to show for the selected node, and which attempt of it. Plain selects wearing the settings page's form styling. Pure render.
import type { StepView } from "@/lib/step-presenter";
import type { InspectorKind } from "@/lib/run-attempt-select";
import styles from "./AttemptSelectorRow.module.css";

interface AttemptSelectorRowProps {
  kind: InspectorKind;
  onKindChange: (kind: InspectorKind) => void;
  attempts: readonly StepView[];
  selectedIteration: number;
  onAttemptChange: (iteration: number) => void;
}

export function AttemptSelectorRow(props: AttemptSelectorRowProps) {
  return (
    <div className={styles.row}>
      <KindSelect kind={props.kind} onKindChange={props.onKindChange} />
      <AttemptSelect
        attempts={props.attempts}
        selectedIteration={props.selectedIteration}
        onAttemptChange={props.onAttemptChange}
      />
    </div>
  );
}

const FIELD_CLASS = `task-form ${styles.field}`;

function KindSelect({
  kind,
  onKindChange,
}: Pick<AttemptSelectorRowProps, "kind" | "onKindChange">) {
  return (
    <label className={FIELD_CLASS}>
      Show
      <select
        value={kind}
        onChange={(event) => onKindChange(event.target.value as InspectorKind)}
      >
        <option value="transcript">Transcript</option>
        <option value="pods">Pod logs</option>
      </select>
    </label>
  );
}

function AttemptSelect({
  attempts,
  selectedIteration,
  onAttemptChange,
}: Omit<AttemptSelectorRowProps, "kind" | "onKindChange">) {
  return (
    <label className={FIELD_CLASS}>
      Attempt
      <select
        value={selectedIteration}
        onChange={(event) => onAttemptChange(Number(event.target.value))}
      >
        {attempts.map(attemptOption)}
      </select>
    </label>
  );
}

function attemptOption(step: StepView) {
  return (
    <option key={step.iteration} value={step.iteration}>
      {attemptOptionLabel(step)}
    </option>
  );
}

export function attemptOptionLabel(step: StepView): string {
  return `attempt ${step.iteration} · ${step.label}`;
}
