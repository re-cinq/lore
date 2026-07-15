import { TimeAgo } from "@/components/TimeAgo";
import { formatEnumLabel } from "@/lib/enum-label";
import type { TaskRuntimeEvent } from "@/lib/task-runtime";
import styles from "./TaskDetailView.module.css";

/** Status-transition timeline (pipeline.task_events). Pure render. */
export default function EventTimeline({
  events,
}: {
  events: TaskRuntimeEvent[];
}) {
  return (
    <>
      <h2>Event Timeline</h2>
      {events.length === 0 ? (
        <p className="meta">No events recorded for this task.</p>
      ) : (
        <div className="memory-list">
          {events.map((e) => (
            <div key={e.id} className={`version ${styles.event}`}>
              <span className={`op-badge op-${e.to_status}`}>
                {formatEnumLabel(e.to_status)}
              </span>
              {e.from_status && (
                <span className="meta">
                  {" "}
                  ← {formatEnumLabel(e.from_status)}
                </span>
              )}
              <span className={`meta ${styles.eventTime}`}>
                <TimeAgo date={e.created_at} />
              </span>
              {e.metadata && (
                <pre className={styles.eventMeta}>
                  {JSON.stringify(e.metadata, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
