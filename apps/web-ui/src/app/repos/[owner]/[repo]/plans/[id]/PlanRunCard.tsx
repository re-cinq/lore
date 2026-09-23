import Link from "next/link";
import ConfirmedActionButton from "@/components/ConfirmedActionButton";
import type { AssemblyRunNode } from "@/lib/assembly-run-rows";
import { canRegenerate, planRunPhase } from "@/lib/plan-run-phase";
import styles from "./PlanRunCard.module.scss";

/** The plan's planning run, as the page summarizes it. */
export interface PlanRun {
  id: string;
  status: string;
  outcome: string | null;
  reason: string | null;
  prUrl: string | null;
  prNumber: number | null;
  nodes: readonly AssemblyRunNode[];
}

type DraftAgain = () => Promise<{ error?: string }>;

interface PlanRunCardProps {
  run: PlanRun | null;
  /** A fresh planning run, offered when there is none or the last one failed. */
  draftAgain: DraftAgain;
}

const REGENERATE = {
  title: "Regenerate the plan?",
  body: "This starts a new planning run. The agent drafts the plan again and can replace what its sections say.",
  confirmLabel: "Regenerate",
  tone: "danger",
} as const;

/** What the plan's run is doing, and where to look closer — the run page draws the line itself. */
export default function PlanRunCard({ run, draftAgain }: PlanRunCardProps) {
  if (!run) {
    return (
      <div className={`meta ${styles.summary}`}>
        <span>No planning run yet.</span>
        <RegeneratePlan draftAgain={draftAgain} />
      </div>
    );
  }
  const phase = planRunPhase(run, run.nodes);

  return (
    <div className={`meta ${styles.summary}`}>
      <span>{phase.text}</span>
      <RunLinks run={run} />
      {canRegenerate(run, run.nodes) && (
        <RegeneratePlan draftAgain={draftAgain} />
      )}
    </div>
  );
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
