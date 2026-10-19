// A step a person answers (run-viz FR4.1i): whose move it is and why while it waits, who answered and when once it has, and a link to where the person acts when the station names its page.
import Link from "next/link";
import CollapsibleCard from "@/components/CollapsibleCard";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import { formatRelativeTime } from "@/lib/assembly-run-presenter";
import { humanStation } from "@/lib/human-station";
import { outcomePill } from "./NodeOutcomeCard";
import styles from "./AttemptCards.module.css";

interface HumanVisitCardProps {
  attempt: AssemblyRunNode;
  nodeType: string | undefined;
}

export default function HumanVisitCard({
  attempt,
  nodeType,
}: HumanVisitCardProps) {
  const station = humanStation(nodeType);

  return (
    <CollapsibleCard
      title={cardTitle(attempt, station?.label)}
      defaultOpen
      status={outcomePill(attempt.outcome)}
      actions={<OpenLink href={attempt.routeUrl} label={station?.openLabel} />}
    >
      {attempt.outcome === null ? (
        (station?.whyParked ?? null)
      ) : (
        <Answer attempt={attempt} />
      )}
    </CollapsibleCard>
  );
}

function cardTitle(
  attempt: AssemblyRunNode,
  waitingLabel: string | undefined,
): string {
  if (attempt.outcome !== null) {
    return "Answered";
  }

  return waitingLabel ?? "Waiting on a person";
}

/** Who reported it: a person, or the outside event that answered for one. */
function Answer({ attempt }: { attempt: AssemblyRunNode }) {
  const at = attempt.finishedAt;

  return (
    <p className={styles.answer}>
      Answered by {answererOf(attempt.worker)}
      {at ? (
        <>
          {" "}
          <time dateTime={at} title={at}>
            {formatRelativeTime(at)}
          </time>
        </>
      ) : null}
      .
    </p>
  );
}

export function answererOf(worker: string | null | undefined): string {
  if (!worker) {
    return "someone";
  }

  return worker.startsWith("event:")
    ? `the event ${worker.slice("event:".length)}`
    : worker;
}

/** In the card header, so it stops the click from folding the card. */
interface OpenLinkProps {
  href: string | null | undefined;
  label?: string;
}

function OpenLink({ href, label }: OpenLinkProps) {
  if (!href) {
    return null;
  }
  const shared = {
    className: "btn-secondary",
    onClick: stopFold,
    children: label ?? "Open",
  };

  return href.startsWith("/") ? (
    <Link href={href} {...shared} />
  ) : (
    <a href={href} target="_blank" rel="noreferrer" {...shared} />
  );
}

/** The link sits in the card's summary: without this the click also folds the card. */
function stopFold(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}
