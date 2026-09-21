import Link from "next/link";
import RunVisualizationPanel from "@/app/assembly-runs/[id]/RunVisualizationPanel";
import CollapsibleCard from "@/components/CollapsibleCard";
import type { StatusTone } from "@/components/StatusPill";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRunNode } from "@/lib/assembly-run-rows";
import { planRunPhase, type PlanRunPhase } from "@/lib/plan-run-phase";
import styles from "./PlanRunCard.module.scss";

/** The plan's planning run, as the page draws it. */
export interface PlanRun {
  id: string;
  status: string;
  reason: string | null;
  repo: string;
  prUrl: string | null;
  prNumber: number | null;
  definition: AssemblyLineDefinition | null;
  nodes: readonly AssemblyRunNode[];
}

const PILLS: Record<PlanRunPhase["tone"], { label: string; tone: StatusTone }> =
  {
    working: { label: "Running", tone: "running" },
    waiting: { label: "Waiting", tone: "waiting" },
    failed: { label: "Failed", tone: "err" },
    done: { label: "Done", tone: "ok" },
  };

export default function PlanRunCard({ run }: { run: PlanRun | null }) {
  if (!run) {
    return <p className="meta">No planning run yet.</p>;
  }
  const phase = planRunPhase(run, run.nodes);

  return (
    <section className={styles.run}>
      <RunSummary run={run} phase={phase} />
      <RunGraphCard run={run} phase={phase} />
    </section>
  );
}

// The live graph, folded away while the plan waits on its people.
function RunGraphCard({ run, phase }: { run: PlanRun; phase: PlanRunPhase }) {
  return (
    <CollapsibleCard
      title="Planning run"
      status={PILLS[phase.tone]}
      defaultOpen={phase.tone !== "waiting"}
    >
      <RunVisualizationPanel
        runId={run.id}
        runStatus={run.status}
        definition={run.definition}
        nodes={run.nodes}
        repo={run.repo}
        reason={run.reason}
        prNumber={run.prNumber}
      />
    </CollapsibleCard>
  );
}

// What the run is doing, and where to look closer — kept outside the card's summary, where a click would fold the card instead of following the link.
function RunSummary({ run, phase }: { run: PlanRun; phase: PlanRunPhase }) {
  return (
    <p className={`meta ${styles.summary}`}>
      <span>{phase.text}</span>
      <Link href={`/assembly-runs/${run.id}`}>Open the run →</Link>
      {run.prUrl && <a href={run.prUrl}>Spec PR #{run.prNumber}</a>}
    </p>
  );
}
