"use client";

// The floor events one attempt handled and raised (run-viz FR4.1i): what started it, what its worker claimed, what it reported and what its report set off. Each says whether the queue took it, and a link the page could only infer says so.
import CollapsibleCard from "@/components/CollapsibleCard";
import { StatusPill, type StatusTone } from "@/components/StatusPill";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import { formatRelativeTime } from "@/lib/assembly-run-presenter";
import { readVisitEvents, type VisitEvent } from "@/lib/visit-reads";
import { useVisitRead } from "./use-visit-read";
import styles from "./AttemptCards.module.css";

interface NodeEventsCardProps {
  runId: string;
  attempt: AssemblyRunNode;
}

export default function NodeEventsCard({
  runId,
  attempt,
}: NodeEventsCardProps) {
  const events = useVisitRead(
    readVisitEvents,
    runId,
    attempt.stationRunId,
    attempt.outcome ?? "open",
  );

  return <EventsView events={events} />;
}

export function EventsView({ events }: { events: readonly VisitEvent[] }) {
  if (events.length === 0) {
    return null;
  }

  return (
    <CollapsibleCard title="Events" defaultOpen labels={[`${events.length}`]}>
      <EventGroup
        title="Handled"
        events={events.filter((e) => e.direction === "handled")}
      />
      <EventGroup
        title="Raised"
        events={events.filter((e) => e.direction === "raised")}
      />
    </CollapsibleCard>
  );
}

function EventGroup({
  title,
  events,
}: {
  title: string;
  events: readonly VisitEvent[];
}) {
  return events.length === 0 ? null : (
    <section className={styles.group} aria-label={title}>
      <div className={styles.groupHead}>{title}</div>
      <ol className={styles.events}>
        {events.map((event) => (
          <EventItem key={event.id} event={event} />
        ))}
      </ol>
    </section>
  );
}

function EventItem({ event }: { event: VisitEvent }) {
  return (
    <li className={styles.event}>
      <span className={styles.mono}>{event.name}</span>
      <StatusPill {...queueState(event)} />
      {event.inferred ? <span className="meta">inferred</span> : null}
      <time
        className="meta"
        dateTime={event.created_at}
        title={event.created_at}
      >
        {formatRelativeTime(event.created_at)}
      </time>
      {event.last_error ? (
        <span className={styles.error}>{event.last_error}</span>
      ) : null}
      <PayloadFold payload={event.payload} />
    </li>
  );
}

function PayloadFold({ payload }: { payload: unknown }) {
  return (
    <details className={styles.payload}>
      <summary>payload</summary>
      <pre>{JSON.stringify(payload, null, 2)}</pre>
    </details>
  );
}

/** Where the queue left it: dead-lettered, retried after failing, taken, or still waiting. */
export function queueState(event: VisitEvent): {
  label: string;
  tone: StatusTone;
} {
  if (event.dead_at) {
    return { label: "dead", tone: "err" };
  }

  if (event.acked_at) {
    return { label: "handled", tone: "ok" };
  }

  return event.last_error
    ? { label: `failed ×${event.attempts}`, tone: "warn" }
    : { label: "queued", tone: "idle" };
}
