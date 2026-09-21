import Link from "next/link";
import type { AssemblyRunNode } from "@/lib/assembly-run-rows";
import { planRunPhase } from "@/lib/plan-run-phase";
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

/** What the plan's run is doing, and where to look closer — the run page draws the line itself. */
export default function PlanRunCard({ run }: { run: PlanRun | null }) {
  if (!run) {
    return <p className="meta">No planning run yet.</p>;
  }

  return (
    <p className={`meta ${styles.summary}`}>
      <span>{planRunPhase(run, run.nodes).text}</span>
      <Link href={`/assembly-runs/${run.id}`}>Open the run →</Link>
      {run.prUrl && <a href={run.prUrl}>Spec PR #{run.prNumber}</a>}
    </p>
  );
}
