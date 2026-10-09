// The bag as the pod saw it at start (run-viz FR4.4l): the floor brief's needs for one attempt, name → ref, each ref linked where it leads. A visit Lore's own engine walked recorded none, and shows no card.
import Link from "next/link";
import CollapsibleCard from "@/components/CollapsibleCard";
import { needLink } from "@/lib/need-link";
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

const BLOB_PREFIX_CHARS = 19;

/** The ref as a link when it leads somewhere: GitHub and URLs open a new tab, a blob stays in the app. A blob hash is shortened to read, with the whole hash on hover. */
function NeedRef({ runId, value }: { runId: string; value: string }) {
  const link = needLink(value, runId);

  if (link === null) {
    return value;
  }

  return link.external ? (
    <a href={link.href} target="_blank" rel="noreferrer">
      {value}
    </a>
  ) : (
    <Link href={link.href} title={value}>
      {value.slice(0, BLOB_PREFIX_CHARS)}…
    </Link>
  );
}
