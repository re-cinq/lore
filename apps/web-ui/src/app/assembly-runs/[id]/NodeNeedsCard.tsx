// The bag as the pod saw it at start (run-viz FR4.4l): the floor brief's needs for one attempt, name → ref, each ref linked where it leads. A visit Lore's own engine walked recorded none, and shows no card.
import CollapsibleCard from "@/components/CollapsibleCard";
import NeedRef from "./NeedRef";
import styles from "./NodeNeedsCard.module.css";

interface NodeNeedsCardProps {
  runId: string;
  needs: Record<string, string> | null;
  iteration: number;
}

export default function NodeNeedsCard({
  runId,
  needs,
  iteration,
}: NodeNeedsCardProps) {
  if (needs === null) {
    return null;
  }

  return (
    <CollapsibleCard
      title="Needs"
      defaultOpen
      labels={[`attempt ${iteration}`]}
      emptyState="This attempt was handed nothing."
    >
      {needsList(runId, needs)}
    </CollapsibleCard>
  );
}

/** Null for no needs at all, so the card says so instead of drawing an empty list. */
function needsList(runId: string, needs: Record<string, string>) {
  const entries = Object.entries(needs);

  return entries.length > 0 ? (
    <NeedsList runId={runId} entries={entries} />
  ) : null;
}

function NeedsList({
  runId,
  entries,
}: {
  runId: string;
  entries: [string, string][];
}) {
  return (
    <dl className={styles.needs}>
      {entries.map(([name, value]) => (
        <div key={name} className={styles.need}>
          <dt>{name}</dt>
          <dd className={styles.mono}>
            <NeedRef runId={runId} value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
