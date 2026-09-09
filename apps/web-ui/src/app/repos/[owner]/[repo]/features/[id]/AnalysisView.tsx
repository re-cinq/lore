import { Alert } from "@/components/Alert";
import { SubmitButton } from "@/components/SubmitButton";
import styles from "./PlanningWizard.module.scss";
import GapSections, { type FeedbackState } from "./GapSections";
import FailureBlock from "./FailureBlock";
import { lineageLabel, rewindOptions } from "@/lib/round-picker";

interface RewindPickerProps {
  rounds: ReturnType<typeof rewindOptions>;
  continueFrom: number | undefined;
  disabled: boolean;
  onChange: (iteration: number) => void;
}

/** Which earlier round the next one continues from. Rounds after the chosen one stay on record; they are simply not carried forward. */
function RewindPicker(props: RewindPickerProps) {
  const { rounds, continueFrom, disabled, onChange } = props;

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

interface RoundActionsProps {
  pending: boolean;
  rounds: ReturnType<typeof rewindOptions>;
  continueFrom: number | undefined;
  onRefine: () => void;
  onCreateSpecPr: () => void;
  onContinueFrom: (iteration: number) => void;
}

/** The way OUT of the refine loop. Deliberately a plain button beside the refine action: creating the spec PR ends planning, and it should not look like one more iteration. */
function CreateSpecPrButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="button"
      disabled={disabled}
      onClick={onClick}
    >
      Create the spec PR
    </button>
  );
}

/** The refine action, which starts one more round on the same feature. */
function RefineButton({
  pending,
  onClick,
}: {
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <SubmitButton
      type="button"
      pending={pending}
      pendingLabel="Working…"
      onClick={onClick}
    >
      Refine again
    </SubmitButton>
  );
}

/** The two ways forward from an analysis, and the picker that decides which round the next one continues from. */
function RoundActions(props: RoundActionsProps) {
  const { pending, rounds, continueFrom } = props;

  return (
    <div className={styles.actions}>
      <RefineButton pending={pending} onClick={props.onRefine} />
      <CreateSpecPrButton disabled={pending} onClick={props.onCreateSpecPr} />
      {rounds.length > 1 && (
        <RewindPicker
          rounds={rounds}
          continueFrom={continueFrom}
          disabled={pending}
          onChange={props.onContinueFrom}
        />
      )}
    </div>
  );
}

/** What the author acts on between rounds: the analysis, the answer form, and the two ways forward. A failed latest round shows its banner ABOVE the preserved sections, so a fix-and-retry never costs the analysis. */
interface AnalysisViewProps {
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
}

/** No round has produced an analysis yet. Distinct from a FAILED round, which shows the failure instead — an author who sees this has nothing wrong to fix, only a round still to finish. */
function EmptyAnalysis() {
  return (
    <div className="spec-card">
      <Alert variant="secondary">
        Planning hasn&apos;t produced an analysis yet — it will appear here once
        the first round finishes.
      </Alert>
    </div>
  );
}

/** Says what a rewind DOES to the rounds after the chosen one: they stay on record but are not carried forward, which is the part an author cannot infer from the picker. */
function RewindNote({
  show,
  continueFrom,
}: {
  show: boolean;
  continueFrom: number | undefined;
}) {
  if (!show) {
    return null;
  }

  return (
    <p className={`meta ${styles.rewindNote}`} role="status">
      This round continues round {continueFrom} — rounds after it stay on record
      but are not carried forward.
    </p>
  );
}

type AnalysisBodyProps = Pick<
  AnalysisViewProps,
  "feedback" | "handlers" | "pending" | "rounds" | "continueFrom" | "rewinding"
> & {
  /** Non-optional here: the caller only renders this once it HAS an analysis. */
  gap: NonNullable<AnalysisViewProps["gap"]>;
  failureBlock: React.ReactNode;
};

/** The analysis itself: what the round found, what the author can say back, and what a rewind would do. Separate from AnalysisView, which decides WHETHER there is an analysis to show at all. */
function AnalysisBody(props: AnalysisBodyProps) {
  const { failureBlock, gap, feedback, handlers } = props;

  return (
    <div>
      {failureBlock ? (
        <div className={styles.failureSlot}>{failureBlock}</div>
      ) : null}
      <GapSections
        gap={gap}
        feedback={feedback}
        onChange={handlers.onChangeFeedback}
        onCreateDraft={handlers.onCreateDraft}
      />
      <AnalysisActions {...props} />
    </div>
  );
}

/** Both ways forward plus the note explaining what a rewind costs — one block, because an author reads the choice and its consequence together. */
function AnalysisActions(props: AnalysisBodyProps) {
  const { handlers } = props;

  return (
    <>
      <RoundActions
        pending={props.pending}
        rounds={props.rounds}
        continueFrom={props.continueFrom}
        onRefine={handlers.onRefine}
        onCreateSpecPr={handlers.onCreateSpecPr}
        onContinueFrom={handlers.onContinueFrom}
      />
      <RewindNote show={props.rewinding} continueFrom={props.continueFrom} />
    </>
  );
}

export function AnalysisView(props: AnalysisViewProps) {
  const { gap } = props;
  const failureBlock = props.failed ? <RoundFailure {...props} /> : null;

  // A failed round with no analysis still has something to say; a round that produced neither is simply not done.
  if (!gap) {
    return failureBlock ?? <EmptyAnalysis />;
  }

  return <AnalysisBody {...props} gap={gap} failureBlock={failureBlock} />;
}

/** The failure block for a round that did not finish, wired to retry through the same handler a refine uses. */
function RoundFailure(props: AnalysisViewProps) {
  return (
    <FailureBlock
      iteration={props.iteration}
      failureReason={props.failureReason}
      answers={props.answers}
      run={props.run}
      pending={props.pending}
      onRetry={props.handlers.onRefine}
    />
  );
}
