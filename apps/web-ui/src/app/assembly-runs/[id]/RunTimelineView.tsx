// Pure run timeline: lifecycle ticks in, a positioned tick strip out. No fetch,
// no EventSource, no timers, no Date.now — the Panel owns the moving `now` bound
// and passes it down (lore/no-io-in-view). Each tick sits at its wall-clock
// fraction of [start, now], so a node whose last tick lags far behind the now
// edge reads as stalled without a per-tool event stream.

import type { TimelineEntry } from "@/lib/run-event-reducer";
import { eventTone, timeToFraction, timelineBounds } from "@/lib/run-timeline";
import styles from "./RunTimelineView.module.css";

export interface RunTimelineViewProps {
  ticks: readonly TimelineEntry[];
  runStartedAt: string | null;
  now: string;
  onSeek?: (id: string) => void;
}

export default function RunTimelineView({
  ticks,
  runStartedAt,
  now,
  onSeek,
}: RunTimelineViewProps) {
  if (ticks.length === 0) {
    return <p className={styles.empty}>No timeline activity yet.</p>;
  }

  const bounds = timelineBounds(ticks, runStartedAt, now);

  return (
    <div className={styles.timeline}>
      <div className={styles.rail}>
        {ticks.map((tick) => {
          const left = `${timeToFraction(tick.createdAt, bounds.start, bounds.end) * 100}%`;
          const tone = eventTone(tick.eventType);
          const title = `${tick.nodeId} ${tick.eventType}`;

          return onSeek ? (
            <button
              key={tick.id}
              type="button"
              className={`${styles.tick} ${styles[tone]}`}
              data-tone={tone}
              data-node={tick.nodeId}
              style={{ ["--tick-left" as string]: left }}
              title={title}
              onClick={() => onSeek(tick.id)}
            />
          ) : (
            <span
              key={tick.id}
              className={`${styles.tick} ${styles[tone]}`}
              data-tone={tone}
              data-node={tick.nodeId}
              style={{ ["--tick-left" as string]: left }}
              title={title}
            />
          );
        })}
      </div>
    </div>
  );
}
