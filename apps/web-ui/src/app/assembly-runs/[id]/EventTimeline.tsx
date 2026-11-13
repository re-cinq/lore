import CollapsibleCard from "@/components/CollapsibleCard";
import type { TaskRuntimeEvent } from "@/lib/task-runtime";

export interface EventTimelineProps {
  events: readonly TaskRuntimeEvent[];
}

export default function EventTimeline({ events }: EventTimelineProps) {
  return (
    <CollapsibleCard
      title="EventTimeline"
      defaultOpen
      emptyState="No status transitions recorded for this task."
    >
      {events.length === 0 ? null : <EventList events={events} />}
    </CollapsibleCard>
  );
}

function EventList({ events }: { events: readonly TaskRuntimeEvent[] }) {
  return (
    <ul>
      {events.map((event) => (
        <li key={event.id}>
          {event.from_status} → {event.to_status}
        </li>
      ))}
    </ul>
  );
}
