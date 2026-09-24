import Link from "next/link";
import type { ReactNode } from "react";
import ConfirmedActionButton from "@/components/ConfirmedActionButton";
import type { AssemblyRunNode } from "@/lib/assembly-run-rows";
import type { PlanPageState } from "@/lib/plan-page-state";
import { canRegenerate, planRunPhase } from "@/lib/plan-run-phase";
import type { PlanActions } from "./plan-actions";
import ReopenPlanButton from "./ReopenPlanButton";
import styles from "./PlanRunCard.module.scss";

/** The plan's planning run, as the page summarizes it. */
export interface PlanRun {
  id: string;
  status: string;
  outcome: string | null;
  reason: string | null;
  prUrl: string | null;
  prNumber: number | null;
  /** The spec PR's title as GitHub reports it, or null when nobody could ask. */
  prTitle: string | null;
  /** The spec PR's review threads nobody resolved yet, or null when nobody could ask. */
  prUnresolvedThreads: number | null;
  /** The spec analysis's summary, which is its question while the line waits on the author. */
  specPlanSummary: string | null;
  nodes: readonly AssemblyRunNode[];
}

type DraftAgain = () => Promise<{ error?: string }>;

interface PlanRunCardProps {
  run: PlanRun | null;
  state: PlanPageState;
  /** A fresh planning run, offered when there is none or the last one failed. */
  draftAgain: DraftAgain;
  reopen: PlanActions["reopen"];
}

const REGENERATE = {
  title: "Regenerate the plan?",
  body: "This starts a new planning run. The agent drafts the plan again and can replace what its sections say.",
  confirmLabel: "Regenerate",
  tone: "danger",
} as const;

// Where the run's own phase does not say what the PLAN's people should do next.
const STATE_TEXT: Partial<Record<PlanPageState, string>> = {
  question: "Paused: the spec writing waits for your answer.",
  answering: "Paused: the spec writing waits for your answer.",
  reopened:
    "Reopened: refine or edit the plan, then approve it again to update the spec PR.",
  "spec-work-failed":
    "The spec work did not deliver. Retry it from the approved plan, or reopen the plan to change it first.",
};

/** What the plan's run is doing, and where to look closer — the run page draws the line itself. A question the spec work has for the author is quoted here, since answering it is the plan's next step: in the plan the line reopened, or, if that reopen never landed, with Reopen beside it. */
export default function PlanRunCard({
  run,
  state,
  draftAgain,
  reopen,
}: PlanRunCardProps) {
  const regenerate =
    state === "writing" && (!run || canRegenerate(run, run.nodes));

  return (
    <div className={`meta ${styles.summary}`}>
      <span>{summaryOf(run, state)}</span>
      {run && <RunLinks run={run} />}
      {regenerate && <RegeneratePlan draftAgain={draftAgain} />}
      <AuthorQuestion run={run} state={state} reopen={reopen} />
    </div>
  );
}

// The analysis's summary opens with its verdict word; the person reads the question after it.
const VERDICT_PREFIX = /^changes requested[.:]?\s*/i;

const QUESTION_STATES: ReadonlySet<PlanPageState> = new Set([
  "question",
  "answering",
]);

const QUESTION_TITLE = "The spec writer has a question for you";

const WHY_PAUSED =
  "You approved this plan, so an agent started turning it into spec files. Before writing them it checked the plan and found a decision it cannot make on its own, so it stopped and waits for your answer.";

const ANSWER_STEPS = [
  "Write your answer into the plan, in the section the question is about.",
  <>
    Click <strong>Approve plan</strong>. The agent reads your answer and goes on
    writing the specs.
  </>,
];

// Only a plan still approved needs the Reopen step; one its line reopened is already editable.
const FIRST_STEP: Partial<Record<PlanPageState, ReactNode>> = {
  question: (
    <>
      Click <strong>Reopen plan</strong>. This unlocks the approved plan so you
      can edit it again.
    </>
  ),
  answering: "The plan is already open again, so you can edit it.",
};

// Someone who never saw the spec step reads this cold: say what paused, quote the question, then the clicks that answer it.
function AuthorQuestion({
  run,
  state,
  reopen,
}: Pick<PlanRunCardProps, "run" | "state" | "reopen">) {
  if (!QUESTION_STATES.has(state)) {
    return null;
  }

  return (
    <section className={styles.question} aria-labelledby="plan-question-title">
      <h3 id="plan-question-title">{QUESTION_TITLE}</h3>
      <p>{WHY_PAUSED}</p>
      <QuestionQuote run={run} />
      <AnswerSteps state={state} />
      {state === "question" && (
        <ReopenPlanButton state="question" reopen={reopen} />
      )}
    </section>
  );
}

function AnswerSteps({ state }: { state: PlanPageState }) {
  return (
    <ol>
      {[FIRST_STEP[state], ...ANSWER_STEPS].map((step, index) => (
        <li key={index}>{step}</li>
      ))}
    </ol>
  );
}

function QuestionQuote({ run }: { run: PlanRun | null }) {
  const question = run?.specPlanSummary?.replace(VERDICT_PREFIX, "");

  return question ? <blockquote>{question}</blockquote> : null;
}

function summaryOf(run: PlanRun | null, state: PlanPageState): string {
  if (!run) {
    return "No planning run yet.";
  }

  return STATE_TEXT[state] ?? planRunPhase(run, run.nodes).text;
}

function RunLinks({ run }: { run: PlanRun }) {
  return (
    <>
      <Link className={styles.openRun} href={`/assembly-runs/${run.id}`}>
        Open the run →
      </Link>
      {run.prUrl && <a href={run.prUrl}>Spec PR #{run.prNumber}</a>}
    </>
  );
}

function RegeneratePlan({ draftAgain }: { draftAgain: DraftAgain }) {
  return (
    <div className={styles.regenerate}>
      <ConfirmedActionButton
        action={draftAgain}
        label="Regenerate plan"
        question={REGENERATE}
      />
    </div>
  );
}
