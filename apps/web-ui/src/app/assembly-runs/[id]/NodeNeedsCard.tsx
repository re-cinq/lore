// The bag as the pod saw it at start (run-viz FR4.4l): the floor brief's needs for one attempt, name → ref. A visit Lore's own engine walked recorded none, and shows no card.
import CollapsibleCard from "@/components/CollapsibleCard";
import styles from "./NodeNeedsCard.module.css";

interface NodeNeedsCardProps {
  needs: Record<string, string> | null;
  iteration: number;
}

export default function NodeNeedsCard({
  needs,
  iteration,
}: NodeNeedsCardProps) {
  if (needs === null) {
    return null;
  }
  const entries = Object.entries(needs);

  return (
    <CollapsibleCard
      title="Needs"
      defaultOpen
      labels={[`attempt ${iteration}`]}
      emptyState="This attempt was handed nothing."
    >
      {entries.length > 0 ? <NeedsList entries={entries} /> : null}
    </CollapsibleCard>
  );
}

function NeedsList({ entries }: { entries: [string, string][] }) {
  return (
    <dl className={styles.needs}>
      {entries.map(([name, ref]) => (
        <div key={name} className={styles.need}>
          <dt>{name}</dt>
          <dd className={styles.mono}>{ref}</dd>
        </div>
      ))}
    </dl>
  );
}
