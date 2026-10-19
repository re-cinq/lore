// When a step's visit opened and finished, and how long it took (run-viz FR4.1i).
import CollapsibleCard from "@/components/CollapsibleCard";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import {
  formatDuration,
  formatRelativeTime,
} from "@/lib/assembly-run-presenter";
import styles from "./AttemptCards.module.css";

export default function VisitTimingCard({
  attempt,
}: {
  attempt: AssemblyRunNode;
}) {
  const open = attempt.outcome === null;

  return (
    <CollapsibleCard title="Timing" defaultOpen>
      <dl className={styles.facts}>
        <dt>Opened</dt>
        <dd>{timeOf(attempt.startedAt)}</dd>
        <dt>Finished</dt>
        <dd>{timeOf(attempt.finishedAt)}</dd>
        <dt>Duration</dt>
        <dd>{open ? "running" : formatDuration(attempt.durationSeconds)}</dd>
      </dl>
    </CollapsibleCard>
  );
}

function timeOf(at: string | null | undefined) {
  if (!at) {
    return "—";
  }

  return (
    <time dateTime={at} title={at}>
      {formatRelativeTime(at)}
    </time>
  );
}
