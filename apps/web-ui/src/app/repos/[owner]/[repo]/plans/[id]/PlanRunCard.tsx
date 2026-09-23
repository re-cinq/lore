import Link from "next/link";
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
  question:
    "The spec work has a question for you: reopen the plan to answer it, then approve it again.",
  reopened:
    "Reopened: refine or edit the plan, then approve it again to update the spec PR.",
  "spec-work-failed":
    "The spec work did not deliver. Retry it from the approved plan, or reopen the plan to change it first.",
};

/** What the plan's run is doing, and where to look closer — the run page draws the line itself. A question the spec work has for the author is quoted here, with Reopen beside it, since answering it is the plan's next step. */
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
      {state === "question" && <AuthorQuestion run={run} reopen={reopen} />}
    </div>
  );
}

// The analysis's summary opens with its verdict word; the person reads the question after it.
const VERDICT_PREFIX = /^changes requested[.:]?\s*/i;

function AuthorQuestion({
  run,
  reopen,
}: {
  run: PlanRun | null;
  reopen: PlanActions["reopen"];
}) {
  const question = run?.specPlanSummary?.replace(VERDICT_PREFIX, "");

  return (
    <div className={styles.question}>
      {question ? <blockquote>{question}</blockquote> : null}
      <ReopenPlanButton state="question" reopen={reopen} />
    </div>
  );
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
