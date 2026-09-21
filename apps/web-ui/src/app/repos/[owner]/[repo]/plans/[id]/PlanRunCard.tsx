import Link from "next/link";
import type { AssemblyRunNode } from "@/lib/assembly-run-rows";
import { planRunPhase } from "@/lib/plan-run-phase";
import DraftAgainButton from "./DraftAgainButton";
import styles from "./PlanRunCard.module.scss";

/** The plan's planning run, as the page summarizes it. */
export interface PlanRun {
  id: string;
  status: string;
  reason: string | null;
  prUrl: string | null;
  prNumber: number | null;
  nodes: readonly AssemblyRunNode[];
}

interface PlanRunCardProps {
  run: PlanRun | null;
  /** A fresh planning run, offered when there is none or the last one failed. */
  draftAgain: () => Promise<{ error?: string }>;
}

/** What the plan's run is doing, and where to look closer — the run page draws the line itself. */
export default function PlanRunCard({ run, draftAgain }: PlanRunCardProps) {
  if (!run) {
    return (
      <div className={`meta ${styles.summary}`}>
        <span>No planning run yet.</span>
        <DraftAgainButton draftAgain={draftAgain} />
      </div>
    );
  }
  const phase = planRunPhase(run, run.nodes);

  return (
    <div className={`meta ${styles.summary}`}>
      <span>{phase.text}</span>
      <Link href={`/assembly-runs/${run.id}`}>Open the run →</Link>
      {run.prUrl && <a href={run.prUrl}>Spec PR #{run.prNumber}</a>}
      {phase.tone === "failed" && <DraftAgainButton draftAgain={draftAgain} />}
    </div>
  );
}
