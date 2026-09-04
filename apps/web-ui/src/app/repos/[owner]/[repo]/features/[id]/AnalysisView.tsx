import { Alert } from "@/components/Alert";
import { SubmitButton } from "@/components/SubmitButton";
import styles from "./PlanningWizard.module.scss";
import GapSections, { type FeedbackState } from "./GapSections";
import FailureBlock from "./FailureBlock";
import { lineageLabel, rewindOptions } from "@/lib/round-picker";

/** Which earlier round the next one continues from. Rounds after the chosen one stay on record; they are simply not carried forward. */
function RewindPicker({
  rounds,
  continueFrom,
  disabled,
  onChange,
}: {
  rounds: ReturnType<typeof rewindOptions>;
  continueFrom: number | undefined;
  disabled: boolean;
  onChange: (iteration: number) => void;
}) {
  return (
    <label className={`meta ${styles.continueFrom}`}>
      Continue from{" "}
      <select
        value={continueFrom ?? rounds[0].iteration}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {rounds.map((r) => (
          <option key={r.iteration} value={r.iteration}>
            {lineageLabel(r) ? `${r.label} — ${lineageLabel(r)}` : r.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The two ways forward from an analysis, and the picker that decides which round the next one continues from. */
function RoundActions({
  pending,
  rounds,
  continueFrom,
  onRefine,
  onCreateSpecPr,
  onContinueFrom,
}: {
  pending: boolean;
  rounds: ReturnType<typeof rewindOptions>;
  continueFrom: number | undefined;
  onRefine: () => void;
  onCreateSpecPr: () => void;
  onContinueFrom: (iteration: number) => void;
}) {
  return (
    <div className={styles.actions}>
      <SubmitButton
        type="button"
        pending={pending}
        pendingLabel="Working…"
        onClick={onRefine}
      >
        Refine again
      </SubmitButton>
      <button
        type="button"
        className="button"
        disabled={pending}
        onClick={onCreateSpecPr}
      >
        Create the spec PR
      </button>
      {rounds.length > 1 && (
        <RewindPicker
          rounds={rounds}
          continueFrom={continueFrom}
          disabled={pending}
          onChange={onContinueFrom}
        />
      )}
    </div>
  );
}

/** What the author acts on between rounds: the analysis, the answer form, and the two ways forward. A failed latest round shows its banner ABOVE the preserved sections, so a fix-and-retry never costs the analysis. */
export function AnalysisView({
  iteration,
  failed,
  gap,
  failureReason,
  answers,
  run,
  pending,
  feedback,
  handlers,
  rounds,
  continueFrom,
  rewinding,
}: {
  iteration: number;
  failed: boolean;
  gap: Parameters<typeof GapSections>[0]["gap"] | null | undefined;
  failureReason: Parameters<typeof FailureBlock>[0]["failureReason"];
  answers: Parameters<typeof FailureBlock>[0]["answers"];
  run: Parameters<typeof FailureBlock>[0]["run"];
  pending: boolean;
  feedback: FeedbackState;
  handlers: {
    onChangeFeedback: (next: FeedbackState) => void;
    onCreateDraft: (title: string, prompt: string) => void;
    onRefine: () => void;
    onCreateSpecPr: () => void;
    onContinueFrom: (iteration: number) => void;
  };
  rounds: ReturnType<typeof rewindOptions>;
  continueFrom: number | undefined;
  rewinding: boolean;
}) {
  const {
    onChangeFeedback,
    onCreateDraft,
    onRefine,
    onCreateSpecPr,
    onContinueFrom,
  } = handlers;
  const failureBlock = (
    <FailureBlock
      iteration={iteration}
      failureReason={failureReason}
      answers={answers}
      run={run}
      pending={pending}
      onRetry={onRefine}
    />
  );

  // No analysis ever produced: pure failure (if the latest failed) or an empty state.
  if (!gap) {
    return failed ? (
      failureBlock
    ) : (
      <div className="spec-card">
        <Alert variant="secondary">
          Planning hasn&apos;t produced an analysis yet — it will appear here
          once the first round finishes.
        </Alert>
      </div>
    );
  }

  return (
    <div>
      {failed && <div className={styles.failureSlot}>{failureBlock}</div>}
      <GapSections
        gap={gap}
        feedback={feedback}
        onChange={onChangeFeedback}
        onCreateDraft={onCreateDraft}
      />
      <RoundActions
        pending={pending}
        rounds={rounds}
        continueFrom={continueFrom}
        onRefine={onRefine}
        onCreateSpecPr={onCreateSpecPr}
        onContinueFrom={onContinueFrom}
      />
      {rewinding && (
        <p className={`meta ${styles.rewindNote}`} role="status">
          This round continues round {continueFrom} — rounds after it stay on
          record but are not carried forward.
        </p>
      )}
    </div>
  );
}
