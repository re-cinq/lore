// Pure run timeline (lore/no-io-in-view) — Panel owns the moving `now` bound; each tick sits at its wall-clock fraction of [start, now].
import CollapsibleCard from "@/components/CollapsibleCard";
import type { TimelineEntry } from "@/lib/run-event-reducer";
import { eventTone, timeToFraction, timelineBounds } from "@/lib/run-timeline";
import styles from "./RunTimelineView.module.css";

export interface RunTimelineViewProps {
  ticks: readonly TimelineEntry[];
  runStartedAt: string | null;
  now: string;
  onSeek?: (id: string) => void;
}

/** One event on the rail. A seekable timeline renders buttons and an unseekable one renders spans — the same mark either way, but only one of them claims to be clickable, which is what a keyboard user goes by. */
function Tick({
  tick,
  bounds,
  onSeek,
}: {
  tick: RunTimelineViewProps["ticks"][number];
  bounds: ReturnType<typeof timelineBounds>;
  onSeek: RunTimelineViewProps["onSeek"];
}) {
  const attrs = {
    className: `${styles.tick} ${styles[eventTone(tick.eventType)]}`,
    "data-tone": eventTone(tick.eventType),
    "data-node": tick.nodeId,
    style: {
      ["--tick-left" as string]: `${timeToFraction(tick.createdAt, bounds.start, bounds.end) * 100}%`,
    },
    title: `${tick.nodeId} ${tick.eventType}`,
  };

  return onSeek ? (
    <button type="button" {...attrs} onClick={() => onSeek(tick.id)} />
  ) : (
    <span {...attrs} />
  );
}

function TimelineRail({
  ticks,
  runStartedAt,
  now,
  onSeek,
}: RunTimelineViewProps) {
  const bounds = timelineBounds(ticks, runStartedAt, now);

  return (
    <div className={styles.timeline}>
      <div className={styles.rail}>
        {ticks.map((tick) => (
          <Tick key={tick.id} tick={tick} bounds={bounds} onSeek={onSeek} />
        ))}
      </div>
    </div>
  );
}

export default function RunTimelineView(props: RunTimelineViewProps) {
  return (
    <CollapsibleCard
      title="Timeline"
      defaultOpen
      emptyState="No timeline activity yet."
    >
      {props.ticks.length === 0 ? null : <TimelineRail {...props} />}
    </CollapsibleCard>
  );
}
