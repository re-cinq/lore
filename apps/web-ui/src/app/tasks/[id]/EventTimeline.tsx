import CollapsibleCard from "@/components/CollapsibleCard";
import { TimeAgo } from "@/components/TimeAgo";
import { formatEnumLabel } from "@/lib/enum-label";
import type { TaskRuntimeEvent } from "@/lib/task-runtime";
import styles from "./TaskDetailView.module.css";

/** One transition. The `from` status is shown only when there is one — the first event of a task comes from nothing, and an arrow pointing at a blank would read as missing data rather than as a beginning. */
function EventRow({ event }: { event: TaskRuntimeEvent }) {
  return (
    <div className={`version ${styles.event}`}>
      <span className={`op-badge op-${event.to_status}`}>
        {formatEnumLabel(event.to_status)}
      </span>
      {event.from_status && (
        <span className="meta"> ← {formatEnumLabel(event.from_status)}</span>
      )}
      <span className={`meta ${styles.eventTime}`}>
        <TimeAgo date={event.created_at} />
      </span>
      {event.metadata && (
        <pre className={styles.eventMeta}>
          {JSON.stringify(event.metadata, null, 2)}
        </pre>
      )}
    </div>
  );
}

export interface EventTimelineProps {
  events: TaskRuntimeEvent[];
}

/** Status-transition timeline (pipeline.task_events). Pure render. */
export default function EventTimeline({ events }: EventTimelineProps) {
  return (
    <CollapsibleCard
      title="Event Timeline"
      defaultOpen
      emptyState="No events recorded for this task."
    >
      {events.length === 0 ? null : (
        <div className="memory-list">
          {events.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </div>
      )}
    </CollapsibleCard>
  );
}
