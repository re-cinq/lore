// The bag as the pod saw it at start (run-viz FR4.4l): the floor brief's needs for one attempt, name → ref, each ref shown the way a person reads it. A visit Lore's own engine walked recorded none, and shows no card.
import CollapsibleCard from "@/components/CollapsibleCard";
import ItemValue from "./ItemValue";
import { useBlobPreviews } from "./use-blob-previews";
import styles from "./NodeNeedsCard.module.css";

interface NodeNeedsCardProps {
  runId: string;
  needs: Record<string, string> | null;
  iteration: number;
  /** "Needs" by default; "Produced" lists what the visit reported it made, the refs linked the same way. */
  title?: string;
}

export default function NodeNeedsCard({
  runId,
  needs,
  iteration,
  title = "Needs",
}: NodeNeedsCardProps) {
  if (needs === null) {
    return null;
  }

  return (
    <CollapsibleCard
      title={title}
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

interface NeedsListProps {
  runId: string;
  entries: [string, string][];
}

function NeedsList({ runId, entries }: NeedsListProps) {
  const previews = useBlobPreviews(
    runId,
    entries.map(([, value]) => value),
  );

  return (
    <dl className={styles.needs}>
      {entries.map(([name, value]) => (
        <div key={name} className={styles.need}>
          <dt>{name}</dt>
          <dd>
            <ItemValue runId={runId} value={value} preview={previews[value]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
